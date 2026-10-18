// FR-145 (R11 GD6): drives one data step and one gap render over HTTP, the way the panel does, against `fit serve --agent claude`.
// Usage: node drive-data.mjs <baseUrl> <outDir>. Plain Node, no workspace imports, so it also runs in the export.
// Importing this module runs nothing; only running it as a script does.
import { mkdir, writeFile } from "node:fs/promises";
import { loadavg } from "node:os";
import { fileURLToPath } from "node:url";

/**
 * The utterances, in order (synthetic, no host terms). The outcomes depend on the model's reply, so the driver throws
 * `diverged at pin <n>` rather than record a different one.
 * 1: an existing Job field the started persona's bundle cannot show (a data step; `dataNeeds` names it). Fallback wording: "Highlight jobs that need more than one part" (`parts`).
 * 2: a field `Job` lacks, asked for on the detail view, a non-table surface (a data-gap pin with `renderGap`).
 */
export const DATA_SCRIPT = [
  { text: "Show a small 'backordered' badge next to each part that is on backorder.", expect: "data-step", need: "parts[].onBackorder" }, // FR-145: replaced "Flag any job with a part on backorder" after two refused runs (a display rule the coding agent hard-coded)
  { text: "On the job detail, show the customer's loyalty tier", expect: "gap-render" },
];
const ROUTE = "/";
const CAP_MS = 20 * 60 * 1000;

const fail = (where, expected, got) => { throw new Error(`diverged at ${where}: expected ${expected}, got ${got}`); };
const short = (v) => { const s = JSON.stringify(v); return s && s.length > 160 ? `${s.slice(0, 157)}...` : s; };

/**
 * @param call (method, path, body?) => Promise<{ status, json }>
 * @param opts { poll: ms between `GET .../live` polls, capMs?: wait cap per live edit, role?: the persona the fitting starts as (default `planner`, the 2-row generated helper bundle that leaves `parts[].onBackorder` never true) }
 * @returns { fittingId, pins: [{ pinId, kind, status, paths, ... }], timings } or throws `diverged at <step>: expected <x>, got <y>`
 */
export async function driveData(call, { poll, capMs = CAP_MS, role = "planner" }) {
  const timings = { loadAtStart: loadavg()[0], loadAtEnd: 0, pins: [] };
  const ok = async (method, path, body, what) => {
    const r = await call(method, path, body);
    if (r.status !== 200) fail(what, "status 200", `${r.status} ${short(r.json?.error ?? r.json)}`);
    return r.json;
  };
  const started = await ok("POST", "/api/fittings", { role, screen: "jobs", fixtures: [] }, "start");
  const id = started.fitting.id;

  async function waitLive(pinId, n) {
    const t0 = Date.now();
    const load0 = loadavg()[0];
    for (;;) {
      const r = await call("GET", `/api/fittings/${id}/live`);
      if (r.status !== 200) fail(`live poll pin ${n}`, "status 200", String(r.status));
      if (r.json?.state === "idle" && r.json.last?.pinId === pinId) {
        timings.pins.push({ pinId, seconds: Math.round((Date.now() - t0) / 100) / 10, loadAtStart: load0, loadAtEnd: loadavg()[0] });
        return r.json.last;
      }
      if (Date.now() - t0 > capMs) fail(`live edit pin ${n}`, "idle within the cap", `state ${r.json?.state}`);
      await new Promise((res) => setTimeout(res, poll));
    }
  }

  const pins = [];
  for (const [i, step] of DATA_SCRIPT.entries()) {
    const n = i + 1;
    const r = await ok("POST", `/api/fittings/${id}/utterances`, { text: step.text, route: ROUTE }, `utterance ${n}`);
    if (r.status !== "pinned") fail(`pin ${n}`, "a pin", r.status ?? "no status");
    const p = r.pin;
    if (step.expect === "data-step") {
      if (p.kind === "data-gap" || !Array.isArray(p.dataNeeds) || p.dataNeeds.length === 0) fail(`pin ${n}`, `a code pin with dataNeeds (${step.need})`, `${p.kind}/${p.scope} dataNeeds ${short(p.dataNeeds)}`);
    } else if (p.kind !== "data-gap" || !p.impliedField || p.renderGap !== true) {
      fail(`pin ${n}`, "a data-gap pin with impliedField and renderGap", `${p.kind}/${p.scope} renderGap ${short(p.renderGap)}`);
    }
    if (!r.liveEdit) fail(`pin ${n}`, "a live edit starting", `${r.notLiveReason ?? "live"} ${short(r.liveEdit)}`);
    const last = await waitLive(p.id, n);
    if (last.status !== "kept") fail(`pin ${n}`, "kept", `${last.status}${last.reason ? ` ${last.reason}` : ""}`);
    const g = await ok("GET", `/api/fittings/${id}`, undefined, `read fitting after pin ${n}`);
    const rec = (g.fitting ?? g).pins?.find((x) => x.id === p.id)?.liveEdit;
    pins.push({
      pinId: p.id, kind: p.kind, step: step.expect, ...(p.dataNeeds ? { dataNeeds: p.dataNeeds } : {}), ...(p.renderGap ? { renderGap: true } : {}),
      status: last.status, paths: rec?.paths ?? [], ...(rec?.data ? { data: rec.data } : {}), ...(rec?.commit ? { commit: rec.commit } : {}), ...(rec?.ms !== undefined ? { ms: rec.ms } : {}),
    });
  }
  timings.loadAtEnd = loadavg()[0];
  return { fittingId: id, pins, timings };
}

async function main([base, outDir]) {
  if (!base || !outDir) { console.error("usage: node drive-data.mjs <baseUrl> <outDir>"); return 2; }
  const page = await (await fetch(`${base}/`)).text();
  const token = /<meta[^>]*name="fittingroom-token"[^>]*content="([^"]+)"/.exec(page)?.[1] ?? /content="([^"]+)"[^>]*name="fittingroom-token"/.exec(page)?.[1];
  if (!token) { console.error("no fittingroom-token meta tag on GET /"); return 2; }
  const host = new URL(base).host;
  const call = async (method, path, body) => {
    const headers = { host, "x-fittingroom-token": token, ...(method !== "GET" ? { "content-type": "application/json" } : {}) };
    const res = await fetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, json };
  };
  try {
    const out = await driveData(call, { poll: 1000 });
    await mkdir(outDir, { recursive: true });
    await writeFile(`${outDir}/data-run.json`, JSON.stringify(out, null, 2) + "\n");
    console.log(`recorded ${out.fittingId}`);
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
