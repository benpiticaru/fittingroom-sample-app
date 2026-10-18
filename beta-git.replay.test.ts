// @vitest-environment node
// FR-17 B7: the five-pin script behind the `git` agent with live edit unavailable, in process. No model, no key, no network.
// The live-available outcome (the code pin kept and applied) is beta-git-live.replay.test.ts. Covers the outcome (spec 260), the branch transcript (SC10), --no-branch and SC11.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BetaServer, BetaServerOptions } from "./test-support/server";

// Each case drives a temp host through the in-process server; under machine load that exceeds the 5s default.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const appDir = fileURLToPath(new URL(".", import.meta.url));
const standalone = existsSync(join(appDir, ".fitting-room-export")); // FR-23 export has no packages/
const readJson = (rel: string) => JSON.parse(readFileSync(join(appDir, rel), "utf8"));
const CONFIG_REL = "src/features/jobs/tableConfig.json";
const OVERLAY_REL = "src/features/jobs/tableConfig.muslin.json";

let SAY: string[] = [];
const BASE_SAY = [
  "Put the technician right after the status, that's who I look for first.",
  "Flag any job with a part on backorder so I can chase it.",
  "A badge on the row is enough.",
  "Add a last visit date column",
];
const QUESTION = "Where does lastVisitDate come from, and is it in scope?";
const BRANCH = "fitting/fit-0b7e5a17";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Steps 1 to 7 of the script; returns the fitting id and each utterance response. */
async function dress(s: BetaServer): Promise<{ id: string; said: Json[] }> {
  const start = await s.call("POST", "/api/fittings", { role: "dispatcher", screen: "jobs", fixtures: [] });
  expect(start.status).toBe(200);
  const id = start.json.fitting.id as string;
  const said: Json[] = [];
  for (const text of SAY) {
    const r = await s.call("POST", `/api/fittings/${id}/utterances`, { text, route: "/" });
    expect(r.status, text).toBe(200);
    said.push(r.json);
  }
  expect((await s.call("DELETE", `/api/fittings/${id}/pins/pin-1`)).status).toBe(200);
  return { id, said };
}

/** The `git commit` calls' stdin, in order. */
const commitMessages = (s: BetaServer): string[] =>
  s.fake.calls.filter((c) => c.cmd === "git" && c.args.includes("commit")).map((c) => c.input ?? "");
const verbCalls = (s: BetaServer, verb: string) => s.fake.calls.filter((c) => c.cmd === "git" && c.args.includes(verb));

describe.skipIf(standalone)("beta replay behind the git agent", () => {
  let startBeta: (o: BetaServerOptions) => Promise<BetaServer>;
  let servers: BetaServer[] = [];
  beforeAll(async () => {
    ({ startBeta } = await import("./test-support/server"));
    const { CODE_PIN_UTTERANCE } = await import("./test-support/live-server");
    SAY = [...BASE_SAY, CODE_PIN_UTTERANCE];
  });
  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers = [];
  });
  const open = async (o: BetaServerOptions): Promise<BetaServer> => {
    const s = await startBeta(o);
    servers.push(s);
    return s;
  };

  it("live edit unavailable: five pins, the code pin recorded and blocked", async () => {
    const s = await open({ agent: "git" });
    const { id, said } = await dress(s);
    expect(said.map((r) => r.status)).toEqual(["pinned", "pinned", "pinned", "pinned", "pinned"]);
    const sub = await s.call("POST", `/api/fittings/${id}/submit`, {});
    expect(sub.json).toMatchObject({ pushed: true });
    const att = await s.call("POST", `/api/fittings/${id}/attempt`, {});
    expect(att.status).toBe(200);
    expect(att.json.attempt).toMatchObject({ outcome: "stopped", blockedOn: { name: "lastVisitDate" }, question: QUESTION, branch: BRANCH });
    expect(att.json.attempt.appliedPinIds).toEqual([]);
    expect([...att.json.attempt.blockedPinIds].sort()).toEqual(["pin-2", "pin-3", "pin-4", "pin-5"]);

    const f = await s.sessionOnDisk(id);
    const [p1, p2, p3, p4, p5] = f.pins;
    expect(f.pins.map((p) => p.utterance)).toEqual(SAY);
    expect(p1).toMatchObject({ id: "pin-1", kind: "layout", scope: "frontend", live: true });
    expect(p1!.withdrawnAt).toBeDefined();
    expect(p1!.configPatch).toMatchObject({ path: "columnOrder", file: CONFIG_REL });
    expect(p2).toMatchObject({ id: "pin-2", kind: "display-rule", live: false, notLiveReason: "needs code" });
    expect(p3).toMatchObject({ id: "pin-3", kind: "display-rule", live: false });
    expect(p4).toMatchObject({ id: "pin-4", kind: "data-gap", scope: "backend", live: true, impliedField: { name: "lastVisitDate" } });
    expect(p5).toMatchObject({ id: "pin-5", kind: "sort", scope: "frontend", live: false, notLiveReason: "needs code" });
    expect(p5!.configPatch).toBeUndefined();
    expect(said[4].liveEdit).toBeUndefined(); // no ServeDeps.live: live edit is disabled
    expect(p2!.withdrawnAt ?? p3!.withdrawnAt ?? p4!.withdrawnAt ?? p5!.withdrawnAt).toBeUndefined();
    expect(f.submittedAt).toBeDefined();
    expect(f.attempt).toMatchObject({ outcome: "stopped", blockedOn: { name: "lastVisitDate" } });

    const before = readFileSync(join(s.hostDir, ".fitting-room/sessions", `${id}.json`), "utf8");
    const pub = await s.call("POST", `/api/fittings/${id}/publish`, {});
    expect(pub.status).toBe(400);
    expect(pub.json.error).toMatch(/no tracker is configured/);
    expect(readFileSync(join(s.hostDir, ".fitting-room/sessions", `${id}.json`), "utf8")).toBe(before);
  });

  it("SC10 branch transcript: one commit per pin and the withdraw, files equal sessionFiles at each, one push", async () => {
    const { commitMessageFor, sessionFiles } = await import("@fitting-room/core");
    const { filesAtCommits } = await import("./test-support/branch-files");
    const s = await open({ agent: "git" });
    const { id } = await dress(s);
    expect((await s.call("POST", `/api/fittings/${id}/submit`, {})).status).toBe(200);
    expect((await s.call("POST", `/api/fittings/${id}/attempt`, {})).status).toBe(200);

    const pins = (await s.sessionOnDisk(id)).pins;
    const rest = commitMessages(s).filter((m) => !/^(submit:|attempt |resync:|record: attempt result|record: tracker ticket)/.test(m));
    const withdrawn = pins[0]!;
    const expected = [...pins.map((pin) => commitMessageFor({ kind: "pin", pin })), commitMessageFor({ kind: "withdraw", pin: withdrawn })];
    expect(rest).toEqual(expected);

    const baseline = { config: readJson(CONFIG_REL), overlay: readJson(OVERLAY_REL) };
    const live = (n: number, withdraw: boolean) => pins.slice(0, n).map((p) => (p.id === "pin-1" && !withdraw ? { ...p, withdrawnAt: undefined } : p));
    const text = (doc: unknown) => JSON.stringify(doc, null, 2) + "\n"; // commit-state's serializeJson
    const repoCfg = `examples/sample-app/${CONFIG_REL}`;
    const repoOverlay = `examples/sample-app/${OVERLAY_REL}`;
    const at = filesAtCommits(s.fake, BRANCH, [repoCfg, repoOverlay]);
    const pinCommits = at.filter((c) => !/^(submit:|attempt |resync:|record: )/.test(c.message));
    expect(pinCommits).toHaveLength(6);
    pinCommits.forEach((c, i) => {
      const want = sessionFiles(baseline, live(Math.min(i + 1, 5), i === 5));
      expect(c.files, c.message.split("\n")[0]).toEqual({ [repoCfg]: text(want.config), [repoOverlay]: text(want.overlay) });
    });
    // Review Focus 5: the withdraw drops pin 1's column move and keeps the data-gap placeholder.
    const last = JSON.parse(pinCommits[5]!.files[repoCfg]!);
    const afterPin4 = JSON.parse(pinCommits[3]!.files[repoCfg]!);
    expect(afterPin4.columnOrder.indexOf("technician")).toBe(2);
    expect(last.columnOrder).toEqual(baseline.config.columnOrder);
    expect(JSON.parse(pinCommits[5]!.files[repoOverlay]!).placeholderColumns.map((c: { name: string }) => c.name)).toContain("lastVisitDate");
    expect(pinCommits[5]!.message).toContain("Fitting-Withdraw");

    const pushes = verbCalls(s, "push");
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.args.slice(pushes[0]!.args.indexOf("push"))).toEqual(["push", "-u", "origin", BRANCH]);
  });

  it("--no-branch: no commit and no push before the attempt request", async () => {
    const s = await open({ agent: "git", noBranch: true });
    const { id } = await dress(s);
    const sub = await s.call("POST", `/api/fittings/${id}/submit`, {});
    expect(sub.json).toMatchObject({ pushed: false, reason: "no branch" });
    expect(verbCalls(s, "commit")).toEqual([]);
    expect(verbCalls(s, "push")).toEqual([]);
    expect((await s.sessionOnDisk(id)).branch).toBeUndefined();
  });

  it("SC11: the second utterance does not classify as authorization", async () => {
    const s = await open({ agent: "git" });
    const { said } = await dress(s);
    expect(said[1].pin.utterance).toBe(SAY[1]);
    expect(said[1].pin.kind).not.toBe("authorization");
    expect(said[1].pin.kind).toBe("display-rule");
  });
});
