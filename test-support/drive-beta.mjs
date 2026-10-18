// FR-17 Task 5: drives the recorded beta fitting over HTTP, the way the panel does, and refuses a run that diverges.
// Usage: node drive-beta.mjs <baseUrl> <outDir> <panelScriptPath>   (the panel script is the panel's generated fixture,
// a JSON file whose `b7.configs` array holds the seven configs the recorded script must produce). Plain Node, no TypeScript, no workspace imports, so it also runs in the export.
// Importing this module runs nothing; only running it as a script does.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadavg } from "node:os";
import { fileURLToPath } from "node:url";

/**
 * The utterances, in order. Every one must draw a pin, never a question (D4 point 1): `displayRule` marks the one that
 * must be a needs-code display rule, `code` the owner's code pin that must be kept.
 */
export const SCRIPT = [
  { text: "Put the technician right after the status, that's who I look for first." },
  { text: "Flag any job with a part on backorder so I can chase it.", displayRule: true },
  { text: "A badge on the row is enough." }, // its own pin
  { text: "Add a last visit date column" },
  { text: "add interactive sort functionality to each column", code: true }, // the owner's phrase, verbatim
];
const ROUTE = "/";
const CAP_MS = 20 * 60 * 1000;
// Verdicts a display-rule pin's live edit may end with (D4 point 6); the code pin must be kept (point 5). The
// "the check changed ..." form of check-failed is a refusal the replay cannot reproduce; the `GET .../live` record has
// no `detail`, so that form is rejected later, from the saved session and by the replay script.
const REPLAYABLE = new Set(["kept", "not-kept/question", "not-kept/no-change", "not-kept/check-failed"]);

const fail = (where, expected, got) => { throw new Error(`diverged at ${where}: expected ${expected}, got ${got}`); };
const short = (v) => { const s = JSON.stringify(v); return s.length > 160 ? `${s.slice(0, 157)}...` : s; };

/** The first top-level key of a config that differs, as `key <expected> vs <got>`; empty when equal. */
function configDiff(want, got) {
  if (JSON.stringify(want) === JSON.stringify(got)) return "";
  const keys = new Set([...Object.keys(want ?? {}), ...Object.keys(got ?? {})]);
  for (const k of keys) {
    if (JSON.stringify(want?.[k]) !== JSON.stringify(got?.[k])) return `${k} ${short(want?.[k])} vs ${short(got?.[k])}`;
  }
  return "different";
}

/** FNV-1a screen key as the snapshot route expects it (the same algorithm as the core's `screenKey`). */
function screenKeyOf(route) {
  let h = 0x811c9dc5;
  for (let i = 0; i < route.length; i++) { h ^= route.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  const slug = route.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "root";
  return `${slug}-${h.toString(16).padStart(8, "0")}`;
}

/** A structural snapshot of `/` shaped like the snapshot schema: structure only, no text values. */
const SNAPSHOT = {
  version: 1,
  screen: ROUTE,
  root: { tag: "main", children: [{ tag: "table", role: "table", children: [{ tag: "thead", children: [{ tag: "tr", children: [{ tag: "th", columnKey: "reference", label: "Job" }, { tag: "th", columnKey: "status", label: "Status" }] }] }] }] },
};

/**
 * @param call (method, path, body?) => Promise<{ status, json }>
 * @param opts { b7Configs: object[7] (start, after each of the five pins, after the withdraw), poll: ms between `GET .../live` polls, capMs?: live-edit wait cap }
 * @returns { fittingId, attempt (the full response body), timings } or throws `diverged at <step>: expected <x>, got <y>`
 */
export async function driveBeta(call, { b7Configs, poll, capMs = CAP_MS }) {
  const timings = { liveEdits: [], attemptSeconds: 0, loadAtStart: loadavg()[0], loadAtEnd: 0 };
  const ok = async (method, path, body, what) => {
    const r = await call(method, path, body);
    if (r.status !== 200) fail(what, "status 200", `${r.status} ${short(r.json?.error ?? r.json)}`);
    return r.json;
  };
  const checkConfig = (k, got) => {
    const d = configDiff(b7Configs[k], got);
    if (d) fail(`config ${k}`, "the panel fixture's b7 config", d);
  };

  const started = await ok("POST", "/api/fittings", { role: "dispatcher", screen: "jobs", fixtures: [] }, "start");
  const id = started.fitting.id;
  checkConfig(0, started.config);

  async function waitLive(pin) {
    const t0 = Date.now();
    const load0 = loadavg()[0];
    for (;;) {
      const r = await call("GET", `/api/fittings/${id}/live`);
      if (r.status !== 200) fail(`live poll ${pin.id}`, "status 200", String(r.status));
      if (r.json?.state === "idle" && r.json.last?.pinId === pin.id) {
        const { status, reason } = r.json.last;
        timings.liveEdits.push({ pinId: pin.id, status, ...(reason ? { reason } : {}), seconds: Math.round((Date.now() - t0) / 100) / 10, loadAtStart: load0, loadAtEnd: loadavg()[0] });
        return { status, reason };
      }
      if (Date.now() - t0 > capMs) fail(`live edit ${pin.id}`, "idle within the cap", `state ${r.json?.state}`);
      await new Promise((res) => setTimeout(res, poll));
    }
  }

  for (const [i, step] of SCRIPT.entries()) {
    const n = i + 1;
    const r = await ok("POST", `/api/fittings/${id}/utterances`, { text: step.text, route: ROUTE }, `utterance ${n}`);
    const got = r.status === "question" ? "question" : "pin";
    if (got !== "pin") fail(`utterance ${n}`, "pin", got); // the script holds no answer for a question (D4 point 1)
    const p = r.pin;
    if (step.displayRule) {
      // D4 point 1: a frontend display rule with no patch, needing code, with a live edit starting.
      if (p.kind !== "display-rule" || p.scope !== "frontend" || p.configPatch !== undefined || r.notLiveReason !== "needs code" || r.liveEdit?.state !== "starting") {
        fail(`utterance ${n}`, "a frontend display rule with no configPatch, needing code, live edit starting", `${p.kind}/${p.scope}${p.configPatch ? " with a patch" : ""} ${r.notLiveReason ?? "live"} ${short(r.liveEdit)}`);
      }
    }
    if (step.code) {
      // D4 point 5: a sort pin, frontend, no patch, needs code, live edit starting.
      if (p.kind !== "sort" || p.scope !== "frontend" || p.configPatch !== undefined) fail(`utterance ${n}`, "a frontend sort pin with no configPatch", `${p.kind}/${p.scope}${p.configPatch ? " with a patch" : ""}`);
      if (r.notLiveReason !== "needs code" || r.liveEdit?.state !== "starting") fail(`utterance ${n}`, "needs code with a live edit starting", `${r.notLiveReason ?? "live"} ${short(r.liveEdit)}`);
    }
    checkConfig(n, r.config); // reply k against b7Configs[k]
    if (r.liveEdit) {
      const v = await waitLive(p);
      const key = v.reason ? `${v.status}/${v.reason}` : v.status;
      if (step.code ? key !== "kept" : !REPLAYABLE.has(key)) fail(`live edit ${p.id}`, step.code ? "kept" : [...REPLAYABLE].join(" | "), `${v.status}${v.reason ? ` ${v.reason}` : ""}`);
    }
  }

  const w = await ok("DELETE", `/api/fittings/${id}/pins/pin-1`, undefined, "withdraw pin-1");
  checkConfig(6, w.config);

  await ok("PUT", `/api/fittings/${id}/snapshots/${screenKeyOf(ROUTE)}`, SNAPSHOT, "snapshot");
  const sub = await ok("POST", `/api/fittings/${id}/submit`, {}, "submit");
  if (sub.pushed !== true) fail("submit", "pushed true", `${sub.pushed}${sub.reason ? ` ${short(sub.reason)}` : ""}`); // D4 point 4a
  const t0 = Date.now();
  const att = await ok("POST", `/api/fittings/${id}/attempt`, {}, "attempt");
  timings.attemptSeconds = Math.round((Date.now() - t0) / 100) / 10;
  const a = att.attempt;
  if (a?.outcome !== "stopped" || a.blockedOn?.name !== "lastVisitDate") fail("attempt", "stopped on lastVisitDate", `${a?.outcome} on ${a?.blockedOn?.name}`);
  if (!Array.isArray(a.appliedPinIds) || !a.appliedPinIds.includes("pin-5")) fail("attempt", "pin-5 (the code pin) in appliedPinIds", short(a.appliedPinIds));
  timings.loadAtEnd = loadavg()[0];
  return { fittingId: id, attempt: att, timings };
}

async function main([base, outDir, scriptPath]) {
  if (!base || !outDir || !scriptPath) { console.error("usage: node drive-beta.mjs <baseUrl> <outDir> <panelScriptPath>"); return 2; }
  const { b7 } = JSON.parse(await readFile(scriptPath, "utf8"));
  if (!Array.isArray(b7?.configs) || b7.configs.length !== 7) { console.error("the panel script has no b7 block of seven configs"); return 2; }
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
    const { fittingId, attempt, timings } = await driveBeta(call, { b7Configs: b7.configs, poll: 1000 });
    await mkdir(outDir, { recursive: true });
    await writeFile(`${outDir}/attempt.json`, JSON.stringify(attempt, null, 2) + "\n");
    await writeFile(`${outDir}/timings.json`, JSON.stringify(timings, null, 2) + "\n");
    console.log(`recorded ${fittingId}`);
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
