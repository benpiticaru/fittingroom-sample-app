// @vitest-environment node
// FR-17 Task 6: the committed real session, replayed. The model side is the committed recordings (recordingTransport as
// ServeDeps.modelFetch), the coding agent and the check are replayScript's scripts, everything else is the production path
// in process. The session the replay writes must equal the one the real run wrote (normalised), the branch must read as
// the SC10 transcript, and nothing may reach the network. No model, no key.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fitting } from "@fitting-room/core";
import type { BetaLive } from "./test-support/live-server";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const appDir = fileURLToPath(new URL(".", import.meta.url));
const standalone = existsSync(join(appDir, ".fitting-room-export")); // FR-23 export has no packages/
// Found by segments (the export check forbids a literal monorepo path in this app).
const BETA_DIR = join(appDir, "..", "..", "packages", "agent", "src", "__fixtures__", "claude", "beta");
const PANEL_SCRIPT = join(appDir, "..", "..", "packages", "panel", "src", "__fixtures__", "script.json");
const SESSION = join(appDir, ".fitting-room", "sessions", "example-beta.json");
const CONFIG_REL = "examples/sample-app/src/features/jobs/tableConfig.json";
const OVERLAY_REL = "examples/sample-app/src/features/jobs/tableConfig.muslin.json";
const EXCLUDED = /^(submit:|attempt |resync:|record: attempt result|record: tracker ticket)/;

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe.skipIf(standalone)("the claude beta replay reproduces the committed session", () => {
  let apps: BetaLive[] = [];
  const committed = (): Fitting => readJson(SESSION);
  const recordings = () => readdirSync(BETA_DIR).filter((f) => f.endsWith(".json")).sort().map((f) => readJson(join(BETA_DIR, f)) as { role: string; response: { status: number; body: unknown } });

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("global fetch reached"); });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(apps.map((a) => a.close()));
    apps = [];
  });

  /** Drives the recorded script against a fresh server; `publish` starts it with the GitHub tracker. */
  async function replay(publish?: { tracker: "github"; repo: string }) {
    const { driveBeta, SCRIPT } = await import("./test-support/drive-beta.mjs");
    const { startBetaLive } = await import("./test-support/live-server");
    const { recordingTransport } = await import("./test-support/transport");
    const { replayScript } = await import("./test-support/replay-script");
    const r = replayScript(committed(), SCRIPT);
    const transport = recordingTransport(recordings());
    const app = await startBetaLive({ agent: "claude", transport, script: r.delegate, check: r.check, ...(publish ? { publish } : {}) });
    apps.push(app);
    const out = await driveBeta(app.call, { b7Configs: readJson(PANEL_SCRIPT).b7.configs, poll: 5 });
    return { app, transport, out };
  }

  it("reproduces the committed session: pins, live edits, attempt, turns; the global fetch is never reached", async () => {
    const { normalize } = await import("./test-support/normalize");
    const { app, transport, out } = await replay();
    const f = await app.sessionOnDisk(out.fittingId);
    expect(normalize(f)).toEqual(normalize(committed()));
    expect(transport.served()).toBe(recordings().length);
    const dir = join(app.hostDir, ".fitting-room", "sessions", out.fittingId, "turns");
    const turns = readdirSync(dir).map((n) => readJson(join(dir, n)) as { role: string });
    expect(turns.some((t) => t.role === "fallback")).toBe(false);
    const recordedEdits = committed().pins.filter((p) => p.liveEdit).length;
    expect(turns.filter((t) => t.role === "live-edit")).toHaveLength(recordedEdits);
    expect(turns.filter((t) => t.role !== "live-edit")).toHaveLength(recordings().length);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("the code pin is kept and applied; no pin pends or asks; the attempt stops on the data gap", async () => {
    const { normalize } = await import("./test-support/normalize");
    const { app, out } = await replay();
    const f = await app.sessionOnDisk(out.fittingId);
    const want = committed();
    const byId = (s: Fitting, id: string) => s.pins.find((p) => p.id === id)!;
    expect(byId(f, "pin-5")).toMatchObject({ utterance: "add interactive sort functionality to each column", kind: "sort", scope: "frontend", live: true, liveEdit: { status: "kept" } });
    expect(byId(f, "pin-2")).toMatchObject({ kind: "display-rule", scope: "frontend" });
    expect(byId(f, "pin-2").configPatch).toBeUndefined();
    expect(byId(f, "pin-2").clarifications).toBeUndefined();
    expect(byId(f, "pin-3").utterance).toBe("A badge on the row is enough.");
    for (const id of ["pin-2", "pin-3"]) {
      expect(byId(f, id).kind).toBe(byId(want, id).kind);
      const { status, reason } = byId(want, id).liveEdit!;
      expect(byId(f, id).liveEdit).toMatchObject({ status, ...(reason !== undefined ? { reason } : {}) });
    }
    expect(f.pins.some((p) => p.clarifications || p.id === "pending")).toBe(false);
    const att = out.attempt.attempt;
    expect(att).toMatchObject({ outcome: "stopped", blockedOn: { name: "lastVisitDate" }, question: "Where does lastVisitDate come from, and is it in scope?" });
    expect(att.appliedPinIds).toContain("pin-5");
    expect(normalize({ ...f, attempt: att })).toEqual(normalize({ ...f, attempt: { ...want.attempt!, branch: `fitting/${out.fittingId}` } }));
  });

  it("SC10 (D10): pin, code and record commits in order, the config files unchanged by code and record commits, one attempt record", async () => {
    const { commitMessageFor, activeFitting } = await import("@fitting-room/core");
    const { app, out } = await replay();
    const pins = committed().pins;
    const f = { ...committed() };
    const kept = (n: number) => pins[n - 1]!.liveEdit?.status === "kept";
    // serve/live/record.ts names every active pin at record time, in session order (pin-1 is withdrawn only at the end).
    const record = (upTo: number) => commitMessageFor({ kind: "record", what: "live-edit", pinIds: activeFitting({ ...f, pins: pins.slice(0, upTo).map((p) => (p.id === "pin-1" ? { ...p, withdrawnAt: undefined } : p)) }).pins.map((p) => p.id) });
    const expected: string[] = [];
    pins.forEach((p, i) => {
      expected.push(commitMessageFor({ kind: "pin", pin: p }));
      if (p.liveEdit) {
        if (kept(i + 1)) expected.push(commitMessageFor({ kind: "code", pin: p }));
        expected.push(record(i + 1));
      }
    });
    expected.push(commitMessageFor({ kind: "withdraw", pin: pins[0]! }));
    const all = await app.messages();
    expect(all.filter((m) => !EXCLUDED.test(m))).toEqual(expected.map((m) => m.trim()));
    expect(all.some((m) => m.startsWith("record: clarifying question"))).toBe(false);
    expect(all.filter((m) => m.startsWith("record: attempt result"))).toHaveLength(1);
    expect(all.at(-1)!.startsWith("record: attempt result")).toBe(true);

    // The two config files at a code or record commit equal those at the commit before; a code commit's paths equal liveEdit.paths.
    const shas = await app.shas();
    const files = await Promise.all(shas.map((sha) => app.filesAt(sha, [CONFIG_REL, OVERLAY_REL])));
    all.forEach((m, i) => {
      if (/^(code pin-|record: )/.test(m)) expect(files[i], m.split("\n")[0]).toEqual(files[i - 1]);
    });
    for (const p of pins) {
      if (p.liveEdit?.status !== "kept") continue;
      const i = all.findIndex((m) => m.startsWith(`code ${p.id}:`));
      expect(shas[i]).toBe((await app.sessionOnDisk(out.fittingId)).pins.find((x) => x.id === p.id)!.liveEdit!.commit);
      expect(await app.changedPaths(shas[i]!)).toEqual(p.liveEdit.paths!.map((x) => `examples/sample-app/${x}`).sort());
    }
  });

  it("publish with no tracker: 400, and the session file is byte-identical (D1)", async () => {
    const { app, out } = await replay();
    const path = join(app.hostDir, ".fitting-room", "sessions", `${out.fittingId}.json`);
    const before = readFileSync(path, "utf8");
    const pub = await app.call("POST", `/api/fittings/${out.fittingId}/publish`, {});
    expect(pub.status).toBe(400);
    expect(pub.json.error).toMatch(/no tracker is configured/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("publish with github: the ticket is recorded, one record commit, the branch pushed after it (D1, #95)", async () => {
    const { app, out } = await replay({ tracker: "github", repo: "example/muslin" });
    const tipBefore = await app.remoteTip();
    const pub = await app.call("POST", `/api/fittings/${out.fittingId}/publish`, {});
    // Status and reason first, so a push that timed out under load reads as that, not as a bare pushed:false.
    expect(pub.status, `publish answered ${pub.status}: ${JSON.stringify(pub.json)}`).toBe(200);
    expect(pub.json.reason, `publish did not push: ${pub.json.reason}`).toBeUndefined();
    expect(pub.json).toMatchObject({ pushed: true });
    const f = await app.sessionOnDisk(out.fittingId);
    expect(f.ticket).toEqual({ tracker: "github", url: "https://github.com/example/muslin/issues/1", id: "1" });
    const all = await app.messages();
    expect(all.filter((m) => m.startsWith("record: tracker ticket"))).toHaveLength(1);
    expect(all.at(-1)!.startsWith("record: tracker ticket")).toBe(true);
    const tip = (await app.shas()).at(-1)!;
    expect(await app.remoteTip()).toBe(tip);
    expect(tip).not.toBe(tipBefore);
  });
});
