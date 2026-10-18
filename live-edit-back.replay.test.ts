// @vitest-environment node
// FR-104 (spec Revision 10, LE7): Back and the cascade on a kept code change, on the sample app, in process
// (the rig is replay/live-kit.ts; promote, keep, check-failed, write-set and Stop are in live-edit.replay.test.ts).
import { afterAll, describe, expect, it, vi } from "vitest";
import { SORT, STICKY, STICKY_UTTERANCE, UTTERANCE, assertRecordingsSynthetic, begin, cleanupLiveApps, idle, liveApp, statusOf, subjects, tableNow, utter, type LiveApp } from "./replay/live-kit";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
afterAll(cleanupLiveApps);

async function kept(app: LiveApp, id: string, pinId: string, text: string): Promise<void> {
  await utter(app, id, text);
  expect((await idle(app, id, pinId)).last, text).toMatchObject({ status: "kept" });
}

describe("Back on a kept code change (replay)", () => {
  it("reverts the change in one revert commit and withdraws the pin", async () => {
    const app = await liveApp();
    const id = await begin(app);
    app.agent = SORT;
    await kept(app, id, "pin-1", UTTERANCE);
    const r = await app.call("DELETE", `/api/fittings/${id}/pins/pin-1`);
    expect(r.status).toBe(200);
    expect(r.json.fitting.pins[0]).toMatchObject({ withdrawnAt: expect.any(String), liveEdit: { status: "reverted" } });
    expect((await subjects(app, 1))[0]).toMatch(/^revert pin-1: add sort functionality/);
    expect(await tableNow(app)).toBe(app.baseTable);
    expect(await statusOf(app)).toEqual([]);
    await assertRecordingsSynthetic(app, id);
  });

  it("a later change on the same line answers revert-conflict; the cascade reverts both, newest first", async () => {
    const app = await liveApp();
    const id = await begin(app);
    app.agent = SORT;
    await kept(app, id, "pin-1", UTTERANCE);
    app.agent = STICKY;
    await kept(app, id, "pin-2", STICKY_UTTERANCE);
    const both = await tableNow(app);
    const plain = await app.call("DELETE", `/api/fittings/${id}/pins/pin-1`);
    expect(plain.status).toBe(409);
    expect(plain.json).toMatchObject({ error: "revert-conflict", later: ["pin-2"], reverted: [] });
    expect(await tableNow(app)).toBe(both);
    expect(await statusOf(app)).toEqual([]);
    const cascade = await app.call("DELETE", `/api/fittings/${id}/pins/pin-1?cascade=1`);
    expect(cascade.status).toBe(200);
    expect((cascade.json.fitting.pins as Array<{ liveEdit: { status: string } }>).map((p) => p.liveEdit.status)).toEqual(["reverted", "reverted"]);
    expect((await subjects(app, 2)).map((s) => s.split(":")[0])).toEqual(["revert pin-1", "revert pin-2"]);
    expect(await tableNow(app)).toBe(app.baseTable);
    expect(await statusOf(app)).toEqual([]);
    await assertRecordingsSynthetic(app, id);
  });
});
