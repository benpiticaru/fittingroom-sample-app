// @vitest-environment node
// FR-104 (spec Revision 10, LE7): live edit on the sample app, in process. `fit serve`'s kernel over a system-git copy of
// this app, its own liveEdit config, a scripted coding agent and check, and the real LocalLiveRuntime over a scripted dev
// server: promote and keep, check-failed, write-set and Stop. Back and the cascade are in live-edit-back.replay.test.ts.
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { hang, type DelegateScript } from "@fitting-room/agent/testing";
import { CHECK_ARGV, DEV_PORT, HOST_REL, SORT, STICKY, STICKY_UTTERANCE, TABLE, edit, pass, UTTERANCE, assertRecordingsSynthetic, begin, cleanupLiveApps, idle, liveApp, session, statusOf, subjects, tableNow, until, utter } from "./replay/live-kit";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
afterAll(cleanupLiveApps);

const AGENT_ENV = /^(?:PATH|HOME|TMPDIR|LANG|USER|LOGNAME|ANTHROPIC_\w+|CLAUDE_CODE_\w+)$/;
const HOST_ENV = /^(?:PATH|HOME|TMPDIR|LANG|NODE_ENV)$/;
const outside = (env: Record<string, string> | undefined, allowed: RegExp): string[] => Object.keys(env ?? {}).filter((k) => !allowed.test(k));

describe("live edit on the sample app (replay)", () => {
  it("promotes on the first code pin, keeps the change, and serves the dev build from then on", async () => {
    const app = await liveApp({ devGate: true });
    app.agent = SORT;
    const id = await begin(app);
    const r = await utter(app, id, UTTERANCE);
    expect(r.status).toBe(200);
    expect(r.json.liveEdit).toEqual({ state: "starting" });
    await until(app, id, (b) => b.state === "promoting");
    expect(app.server.live.forwardPort()).toBeUndefined();
    expect(await app.server.live.liveBuild()).toBeUndefined();
    app.devReady();
    expect(await idle(app, id, "pin-1")).toEqual({ state: "idle", last: { pinId: "pin-1", status: "kept" } });
    expect(app.server.live.forwardPort()).toBe(DEV_PORT);
    expect(await app.server.live.liveBuild()).toMatchObject({ live: true });

    // The runtime ran this app's own commands: the install at the worktree root, dev:muslin in the host dir.
    expect(app.live.calls.find((c) => c.cmd === "npm" && c.args.join(" ") === "ci")?.cwd).toBe(app.worktree);
    expect(app.long.calls).toHaveLength(1);
    expect(app.long.calls[0]).toMatchObject({ cmd: "npm", args: ["run", "dev:muslin", "--", "--host", "127.0.0.1", "--port", String(DEV_PORT), "--strictPort"], cwd: join(app.worktree, HOST_REL) });
    expect(app.long.calls[0]!.env?.NODE_ENV).toBe("development");
    expect(outside(app.long.calls[0]!.env, HOST_ENV)).toEqual([]);

    // The coding agent: confined to this app's write set, the utterance on stdin, only its allowlisted environment.
    const claude = app.live.calls.find((c) => c.cmd === "claude" && c.args.includes("-p"))!;
    expect(claude.args).toEqual(expect.arrayContaining(["--no-session-persistence", "--restricted", `Read,Glob,Grep,Edit(${HOST_REL}/src/**),Write(${HOST_REL}/src/**)`]));
    expect(claude.input).toContain(UTTERANCE);
    expect(claude.env).toMatchObject({ USER: "syn-facilitator", LOGNAME: "syn-facilitator" });
    expect(outside(claude.env, AGENT_ENV)).toEqual([]);

    // The check is the attempt's testCommand at the worktree root, minimal environment.
    const check = app.live.calls.find((c) => c.cmd === "npx")!;
    expect([check.cmd, ...check.args]).toEqual(CHECK_ARGV);
    expect(check.cwd).toBe(app.worktree);
    expect(outside(check.env, HOST_ENV)).toEqual([]);

    // One code commit of the one source path, then the record; the pin is a live sort pin.
    expect(await subjects(app, 3)).toEqual(["record: live edit", expect.stringMatching(/^code pin-1: add sort functionality/), expect.stringMatching(/^pin-1: /)]);
    expect(await tableNow(app)).toContain('aria-sort="none"');
    expect(await statusOf(app)).toEqual([]);
    expect((await session(app, id)).pins[0]).toMatchObject({ kind: "sort", scope: "frontend", live: true, liveEdit: { status: "kept", paths: [`${HOST_REL}/${TABLE}`] } });
    expect(await assertRecordingsSynthetic(app, id)).toBeGreaterThan(0);
  });

  it("a failing check restores the screen, records check-failed, and the next change still runs", async () => {
    const app = await liveApp();
    const id = await begin(app);
    app.agent = SORT;
    app.check = async () => ({ code: 1, stdout: "SYN 1 test failed" });
    await utter(app, id, UTTERANCE);
    expect((await idle(app, id, "pin-1")).last).toMatchObject({ status: "not-kept", reason: "check-failed" });
    expect(await tableNow(app)).toBe(app.baseTable);
    expect(await statusOf(app)).toEqual([]);
    expect((await session(app, id)).pins[0]).toMatchObject({ live: false, notLiveReason: "needs code", liveEdit: { status: "not-kept", reason: "check-failed" } });
    expect(await subjects(app, 2)).toEqual(["record: live edit", expect.stringMatching(/^pin-1: /)]);
    // Not out-of-sync: the next code pin in the same fitting is kept.
    app.agent = STICKY;
    app.check = pass;
    await utter(app, id, STICKY_UTTERANCE);
    expect((await idle(app, id, "pin-2")).last).toMatchObject({ status: "kept" });
    expect(await tableNow(app)).toContain('className="sticky"');
    await assertRecordingsSynthetic(app, id);
  });

  it("refuses the muslin seam and a muslin import as write-set, and the check never runs", async () => {
    const app = await liveApp();
    const id = await begin(app);
    const cases: Array<[string, DelegateScript, RegExp]> = [
      [STICKY_UTTERANCE, edit("export class HttpClient", "// SYN retry note\nexport class HttpClient", "src/api/client.ts"), /liveEdit\.protect glob src\/api\/client\.ts/],
      ["show the sort direction in each header", edit("export const muslinClient", "// SYN note\nexport const muslinClient", "src/muslin/fixture-client.ts"), /liveEdit\.protect glob src\/muslin\/\*\*/],
      [UTTERANCE, edit("function cellValue(", 'import { muslinConfig } from "../../muslin/config";\nfunction cellValue(', "src/features/jobs/JobsTable.tsx"), /imports the muslin side/],
    ];
    for (const [i, [text, script, why]] of cases.entries()) {
      app.agent = script;
      await utter(app, id, text);
      expect((await idle(app, id, `pin-${i + 1}`)).last, text).toMatchObject({ status: "not-kept", reason: "write-set" });
      expect((await session(app, id)).pins[i].liveEdit.detail, text).toMatch(why);
      expect(await statusOf(app), text).toEqual([]);
    }
    expect(await tableNow(app)).toBe(app.baseTable);
    expect(app.live.calls.filter((c) => c.cmd === "npx")).toEqual([]);
    await assertRecordingsSynthetic(app, id);
  });

  it("Stop cancels a running edit, restores the worktree, and every other change waits meanwhile", async () => {
    const app = await liveApp();
    const id = await begin(app);
    app.agent = async (x) => { await SORT(x); return hang(x); };
    await utter(app, id, UTTERANCE);
    await until(app, id, (b) => b.state === "editing");
    const blocked = await utter(app, id, STICKY_UTTERANCE);
    expect(blocked.status).toBe(409);
    expect(blocked.json).toEqual({ error: "live-edit-running" });
    expect((await app.call("POST", `/api/fittings/${id}/live/stop`, {})).status).toBe(202);
    expect((await idle(app, id, "pin-1")).last).toMatchObject({ status: "cancelled" });
    expect(await tableNow(app)).toBe(app.baseTable);
    expect(await statusOf(app)).toEqual([]);
    expect((await session(app, id)).pins[0]).toMatchObject({ live: false, notLiveReason: "needs code", liveEdit: { status: "cancelled" } });
    expect((await subjects(app, 1))[0]).toBe("record: live edit");
    await assertRecordingsSynthetic(app, id);
  });
});
