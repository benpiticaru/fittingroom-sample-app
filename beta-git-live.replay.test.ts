// @vitest-environment node
// FR-17 Task 3b: the five-pin script behind the `git` agent with live edit on, in process. The code pin is live-edited
// (scripted coding agent) and kept, so Try it now counts it as applied (spec 281). No model, no key, no network.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BetaLive, startBetaLive, sortOnly } from "./test-support/live-server";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const appDir = fileURLToPath(new URL(".", import.meta.url));
const standalone = existsSync(join(appDir, ".fitting-room-export")); // FR-23 export has no packages/
const CONFIG_REL = "src/features/jobs/tableConfig.json";
const OVERLAY_REL = "src/features/jobs/tableConfig.muslin.json";
const SORT_PATH = "examples/sample-app/src/features/jobs/JobsTable.tsx";
const QUESTION = "Where does lastVisitDate come from, and is it in scope?";
const BASE_SAY = [
  "Put the technician right after the status, that's who I look for first.",
  "Flag any job with a part on backorder so I can chase it.",
  "A badge on the row is enough.",
  "Add a last visit date column",
];
const EXCLUDED = /^(submit:|attempt |resync:|record: attempt result|record: tracker ticket)/;

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(standalone)("beta replay behind the git agent, live edit on", () => {
  let mod: { CODE_PIN_UTTERANCE: string; startBetaLive: typeof startBetaLive; sortOnly: typeof sortOnly };
  let say: string[] = [];
  let apps: BetaLive[] = [];
  beforeAll(async () => {
    mod = await import("./test-support/live-server");
    say = [...BASE_SAY, mod.CODE_PIN_UTTERANCE];
  });
  afterEach(async () => {
    await Promise.all(apps.map((a) => a.close()));
    apps = [];
  });

  /** Start, the five utterances (waiting out each live edit), then the withdraw of pin 1. */
  async function dress(): Promise<{ a: BetaLive; id: string; said: Json[] }> {
    const a = await mod.startBetaLive({ agent: "git", script: await mod.sortOnly() });
    apps.push(a);
    const start = await a.call("POST", "/api/fittings", { role: "dispatcher", screen: "jobs", fixtures: [] });
    expect(start.status).toBe(200);
    const id = start.json.fitting.id as string;
    const said: Json[] = [];
    for (const text of say) {
      const r = await a.call("POST", `/api/fittings/${id}/utterances`, { text, route: "/" });
      expect(r.status, text).toBe(200);
      said.push(r.json);
      if (r.json.liveEdit) await a.waitIdle(id, r.json.pin.id);
    }
    expect((await a.call("DELETE", `/api/fittings/${id}/pins/pin-1`)).status).toBe(200);
    return { a, id, said };
  }

  it("five-pin outcome: the sort pin is live-edited and kept, so the attempt applies it and stops on the data gap", async () => {
    const { a, id, said } = await dress();
    expect(said.map((r) => r.pin.id)).toEqual(["pin-1", "pin-2", "pin-3", "pin-4", "pin-5"]);
    expect(said.map((r) => r.liveEdit)).toEqual([undefined, { state: "starting" }, { state: "starting" }, undefined, { state: "starting" }]);
    const f = await a.sessionOnDisk(id);
    const [p1, p2, p3, p4, p5] = f.pins;
    expect(f.pins.map((p) => p.utterance)).toEqual(say);
    expect(p1).toMatchObject({ kind: "layout", scope: "frontend", live: true });
    expect(p1!.withdrawnAt).toBeDefined();
    for (const p of [p2, p3]) {
      expect(p).toMatchObject({ kind: "display-rule", scope: "frontend", live: false, liveEdit: { status: "not-kept", reason: "no-change" } });
      expect(p!.configPatch).toBeUndefined();
    }
    expect(p4).toMatchObject({ kind: "data-gap", scope: "backend", live: true, impliedField: { name: "lastVisitDate" } });
    expect(p5).toMatchObject({ id: "pin-5", kind: "sort", scope: "frontend", live: true, liveEdit: { status: "kept", paths: [SORT_PATH] } });
    expect(p5!.configPatch).toBeUndefined();
    expect(p5!.liveEdit!.commit).toMatch(/^[0-9a-f]{40}$/);

    const sub = await a.call("POST", `/api/fittings/${id}/submit`, {});
    expect(sub.json).toMatchObject({ pushed: true });
    const tip = (await a.shas()).at(-1)!;
    expect(await a.remoteTip()).toBe(tip);

    const att = await a.call("POST", `/api/fittings/${id}/attempt`, {});
    expect(att.status).toBe(200);
    expect(att.json.attempt).toMatchObject({ outcome: "stopped", blockedOn: { name: "lastVisitDate" }, question: QUESTION, branch: a.branch, appliedPinIds: ["pin-5"] });
    expect([...att.json.attempt.blockedPinIds].sort()).toEqual(["pin-2", "pin-3", "pin-4"]);

    const before = JSON.stringify(await a.sessionOnDisk(id)) + (await a.messages()).length;
    const pub = await a.call("POST", `/api/fittings/${id}/publish`, {});
    expect(pub.status).toBe(400);
    expect(pub.json.error).toMatch(/no tracker is configured/);
    expect(JSON.stringify(await a.sessionOnDisk(id)) + (await a.messages()).length).toBe(before);
  });

  it("SC10 with live edit: pin, code and record commits in order, files equal sessionFiles, code paths equal liveEdit.paths", async () => {
    const { commitMessageFor, sessionFiles, activeFitting } = await import("@fitting-room/core");
    const { a, id } = await dress();
    expect((await a.call("POST", `/api/fittings/${id}/submit`, {})).status).toBe(200);
    expect((await a.call("POST", `/api/fittings/${id}/attempt`, {})).status).toBe(200);

    const f = await a.sessionOnDisk(id);
    const pins = f.pins;
    const messages = (await a.messages()).filter((m) => !EXCLUDED.test(m));
    // serve/live/record.ts names every active pin at the time of the record commit, in session order.
    const record = (upTo: number, withdrawn = false) =>
      commitMessageFor({ kind: "record", what: "live-edit", pinIds: activeFitting({ ...f, pins: pins.slice(0, upTo).map((p) => (p.id === "pin-1" && !withdrawn ? { ...p, withdrawnAt: undefined } : p)) }).pins.map((p) => p.id) });
    const expected = [
      commitMessageFor({ kind: "pin", pin: pins[0]! }),
      commitMessageFor({ kind: "pin", pin: pins[1]! }), record(2),
      commitMessageFor({ kind: "pin", pin: pins[2]! }), record(3),
      commitMessageFor({ kind: "pin", pin: pins[3]! }),
      commitMessageFor({ kind: "pin", pin: pins[4]! }), commitMessageFor({ kind: "code", pin: pins[4]! }), record(5),
      commitMessageFor({ kind: "withdraw", pin: pins[0]! }),
    ].map((m) => m.trim());
    expect(messages).toEqual(expected);

    // The two config files at each commit equal sessionFiles for the pins active then; code and record commits change neither.
    const { readFileSync } = await import("node:fs");
    const readJson = (rel: string) => JSON.parse(readFileSync(join(appDir, rel), "utf8"));
    const baseline = { config: readJson(CONFIG_REL), overlay: readJson(OVERLAY_REL) };
    const text = (doc: unknown) => JSON.stringify(doc, null, 2) + "\n";
    const repoCfg = `examples/sample-app/${CONFIG_REL}`;
    const repoOverlay = `examples/sample-app/${OVERLAY_REL}`;
    const shas = await a.shas();
    const all = await Promise.all(shas.map(async (sha) => ({ sha, files: await a.filesAt(sha, [repoCfg, repoOverlay]), msg: (await a.messages())[shas.indexOf(sha)]! })));
    const kept = all.filter((c) => !EXCLUDED.test(c.msg));
    expect(kept).toHaveLength(expected.length);
    const withPins = (n: number, withdrawn: boolean) => pins.slice(0, n).map((p) => (p.id === "pin-1" && !withdrawn ? { ...p, withdrawnAt: undefined } : p));
    const stateAt = [1, 2, 2, 3, 3, 4, 5, 5, 5, 5]; // pins applied at each expected commit
    kept.forEach((c, i) => {
      const want = sessionFiles(baseline, withPins(stateAt[i]!, i === 9));
      expect(c.files, c.msg.split("\n")[0]).toEqual({ [repoCfg]: text(want.config), [repoOverlay]: text(want.overlay) });
    });
    const codeIdx = expected.findIndex((m) => m.startsWith("code pin-5"));
    expect(await a.changedPaths(kept[codeIdx]!.sha)).toEqual([...pins[4]!.liveEdit!.paths!].sort());
    expect(kept[codeIdx]!.sha).toBe(pins[4]!.liveEdit!.commit);

    const pushes = a.calls.filter((c) => c.cmd === "git" && c.args.includes("push") && c.args.includes(a.branch));
    expect(pushes).toHaveLength(1);
  });

  it("Constraint A: the session, every commit message and the logs carry no obvious identifier", async () => {
    const { assertNoObviousIdentifiers } = await import("@fitting-room/fixtures");
    const { a, id } = await dress();
    expect((await a.call("POST", `/api/fittings/${id}/submit`, {})).status).toBe(200);
    expect((await a.call("POST", `/api/fittings/${id}/attempt`, {})).status).toBe(200);
    assertNoObviousIdentifiers({ session: await a.sessionOnDisk(id), commits: await a.messages(), logs: a.logs });
  });
});
