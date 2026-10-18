// @vitest-environment node
// FR-145: the data step / gap render driver against a fake `call` (the way beta-driver.replay.test.ts fakes the server).
import { describe, expect, it } from "vitest";
import { DATA_SCRIPT, driveData } from "./test-support/drive-data.mjs";

type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; json: unknown }>;
const DATA_PIN = { id: "pin-1", kind: "display-rule", scope: "frontend", dataNeeds: ["parts[].onBackorder"] };
const GAP_PIN = { id: "pin-2", kind: "data-gap", scope: "backend", impliedField: { name: "loyaltyTier" }, renderGap: true };

/** A fake server: utterance k answers `pins[k-1]`; the live poll reports it kept; the fitting carries its record. */
function fake(pins: Record<string, unknown>[], starts: unknown[] = []) {
  let k = 0, last = "";
  const call: Call = async (method, path, body) => {
    if (method === "POST" && path === "/api/fittings") { starts.push(body); return { status: 200, json: { fitting: { id: "fit-0a1b2c3d" } } }; }
    if (method === "POST" && path.endsWith("/utterances")) { const pin = pins[k++]!; last = pin.id as string; return { status: 200, json: { status: "pinned", pin, liveEdit: { state: "starting" } } }; }
    if (path.endsWith("/live")) return { status: 200, json: { state: "idle", last: { pinId: last, status: "kept" } } };
    return { status: 200, json: { fitting: { pins: [{ id: "pin-1", liveEdit: { paths: ["src/features/jobs/JobsTable.tsx"], data: { files: ["supervisor/jobs.json"], records: 2 }, commit: "abc1234", ms: 4200 } }, { id: "pin-2", liveEdit: { paths: ["src/features/jobs/JobDetail.tsx"], commit: "def5678", ms: 5100 } }] } } };
  };
  return call;
}

describe("driveData", () => {
  it("starts as supervisor and returns one entry per kept pin", async () => {
    const starts: unknown[] = [];
    const r = await driveData(fake([DATA_PIN, GAP_PIN], starts), { poll: 1 });
    expect(starts).toEqual([{ role: "planner", screen: "jobs", fixtures: [] }]);
    expect(r.fittingId).toBe("fit-0a1b2c3d");
    expect(r.pins.map((p: { step: string; status: string }) => [p.step, p.status])).toEqual([["data-step", "kept"], ["gap-render", "kept"]]);
    expect(r.pins[0]).toMatchObject({ dataNeeds: ["parts[].onBackorder"], data: { records: 2 }, commit: "abc1234" });
    expect(r.pins[1]).toMatchObject({ renderGap: true, paths: ["src/features/jobs/JobDetail.tsx"] });
    expect(DATA_SCRIPT).toHaveLength(2);
  });
  it("throws diverged at pin 1 when utterance 1 draws no dataNeeds", async () => {
    await expect(driveData(fake([{ id: "pin-1", kind: "display-rule", scope: "frontend" }, GAP_PIN]), { poll: 1 })).rejects.toThrow("diverged at pin 1");
  });
  it("throws diverged at pin 2 when the gap pin lacks renderGap", async () => {
    await expect(driveData(fake([DATA_PIN, { ...GAP_PIN, renderGap: undefined }]), { poll: 1 })).rejects.toThrow("diverged at pin 2");
  });
});
