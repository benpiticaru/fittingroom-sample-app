// @vitest-environment node
// FR-17 Task 5 step 2: the recording driver against the in-process server (the `claude` agent over a scripted model transport and
// a scripted coding agent). It must pass a good session and name where a diverging one left the script (D4, Review Focus 1 and 6).
import { existsSync, readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BetaLive } from "./test-support/live-server";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const appDir = fileURLToPath(new URL(".", import.meta.url));
const standalone = existsSync(join(appDir, ".fitting-room-export")); // FR-23 export has no packages/
// The panel's generated fixture, found by segments (the export check forbids a literal monorepo path in this app).
const PANEL_SCRIPT = join(appDir, "..", "..", "packages", "panel", "src", "__fixtures__", "script.json");

const COLUMNS = ["reference", "status", "technician", "priority", "customerName", "openedYear", "slaHoursRemaining"];
const reply = (input: Record<string, unknown>, n: number) => ({
  response: { status: 200, body: { id: `msg_synthetic_drv_${n}`, type: "message", role: "assistant", model: "m-synthetic", content: [{ type: "tool_use", id: `toolu_synthetic_drv_${n}`, name: "record_pin", input }], stop_reason: "tool_use", usage: { input_tokens: 0, output_tokens: 0 } } },
});
const LAYOUT = (after = COLUMNS) => reply({ kind: "layout", scope: "frontend", summary: "Technician moved to directly after Status", configPatch: { path: "columnOrder", after } }, 1);
const FLAG = reply({ kind: "display-rule", scope: "frontend", summary: "Flag jobs that have a part on backorder" }, 2);
const QUESTION = reply({ kind: "display-rule", scope: "frontend", summary: "Flag jobs that have a part on backorder", clarifications: [{ question: "Should a backordered job get a badge on its row, or also move to the top?" }] }, 2);
const BADGE = reply({ kind: "display-rule", scope: "frontend", summary: "Badge on the row for jobs with a part on backorder" }, 3);
const BADGE_PATCHED = reply({ kind: "display-rule", scope: "frontend", summary: "Badge on the row", configPatch: { path: "displayRules", after: [{ field: "slaHoursRemaining", when: "negative", style: "overdue" }, { field: "priority", when: "high", style: "badge" }] } }, 3);
const GAP = reply({ kind: "data-gap", scope: "backend", summary: "Last visit date column requested; not in the data today", impliedField: { name: "lastVisitDate", typeHint: "date" } }, 4);
const SORT_PIN = reply({ kind: "sort", scope: "frontend", summary: "Sort each column when its header is clicked" }, 5);
const GOOD = () => [LAYOUT(), FLAG, BADGE, GAP, SORT_PIN];

describe.skipIf(standalone)("driveBeta against the in-process server", () => {
  let apps: BetaLive[] = [];
  afterEach(async () => {
    await Promise.all(apps.map((a) => a.close()));
    apps = [];
  });

  /** Runs the driver over a fresh server; the scripted coding agent is picked by the brief's own Utterance line. */
  async function drive(replies: ReturnType<typeof GOOD>, o: { sort?: "edit" | "none"; flagCheckFails?: boolean; brokenRemote?: boolean } = {}) {
    const { driveBeta, SCRIPT } = await import("./test-support/drive-beta.mjs");
    const { startBetaLive } = await import("./test-support/live-server");
    const { recordingTransport } = await import("./test-support/transport");
    const { SORT, noEdit, TABLE, HOST_REL } = await import("./replay/live-kit");
    const text = (pred: (s: { code?: boolean; displayRule?: boolean }) => boolean) => SCRIPT.find(pred)!.text as string;
    const code = text((s) => !!s.code);
    const flag = text((s) => !!s.displayRule);
    let failed = false;
    const script = (input: string) => {
      const said = (u: string) => input.split("\n").includes(`Utterance: ${u}`);
      if (said(code)) return o.sort === "none" ? noEdit : SORT;
      // A change the check then rejects: the pin ends not-kept/check-failed, which the driver accepts (D4 point 6).
      if (said(flag) && o.flagCheckFails) return async ({ cwd }: { cwd: string }) => { await appendFile(join(cwd, HOST_REL, TABLE), "// SYN flag edit\n"); return { code: 0, stdout: "SYN edit made" }; };
      return noEdit;
    };
    const check = o.flagCheckFails ? async () => (failed ? { code: 0, stdout: "SYN check passed" } : ((failed = true), { code: 1, stdout: "SYN check failed: one synthetic test" })) : undefined;
    const transport = recordingTransport(replies);
    const app = await startBetaLive({ agent: "claude", transport, script, ...(check ? { check } : {}) });
    apps.push(app);
    if (o.brokenRemote) {
      // Through the harness's git env: a bare nodeRunner inherits GIT_DIR under a pre-push hook and rewrote this repo's origin.
      await app.setOrigin(join(app.hostDir, "missing-remote.git"));
    }
    const b7Configs = JSON.parse(readFileSync(PANEL_SCRIPT, "utf8")).b7.configs;
    return { app, transport, run: () => driveBeta(app.call, { b7Configs, poll: 5 }) };
  }

  it("passes a good session: five pins, the code pin kept and applied, the attempt stopped on the data gap", async () => {
    const { app, transport, run } = await drive(GOOD(), { sort: "edit" });
    const out = await run();
    expect(out.attempt.attempt).toMatchObject({ outcome: "stopped", blockedOn: { name: "lastVisitDate" } });
    expect(out.attempt.attempt.appliedPinIds).toContain("pin-5");
    expect(transport.served()).toBe(5);
    const f = await app.sessionOnDisk(out.fittingId);
    expect(f.pins.find((p) => p.id === "pin-5")).toMatchObject({ utterance: "add interactive sort functionality to each column", kind: "sort", liveEdit: { status: "kept" } });
    expect(f.pins.some((p) => p.clarifications || p.id === "pending")).toBe(false);
    expect(out.timings.liveEdits.map((l: { pinId: string }) => l.pinId)).toEqual(["pin-2", "pin-3", "pin-5"]);
    expect(out.timings.liveEdits.at(-1)).toMatchObject({ status: "kept", loadAtStart: expect.any(Number), loadAtEnd: expect.any(Number) });
    expect(await app.remoteTip()).toBeTruthy(); // Submit pushed the branch (D4 point 4a)
  });

  it("names the utterance when the second reply is a question, not a pin", async () => {
    const { run } = await drive([LAYOUT(), QUESTION, BADGE, GAP, SORT_PIN], { sort: "edit" });
    await expect(run()).rejects.toThrow("diverged at utterance 2: expected pin, got question");
  });

  it("names the config when the first reply's patch moves a different column", async () => {
    const other = [...COLUMNS];
    other.splice(1, 0, other.splice(3, 1)[0]!); // priority right after reference instead of technician after status
    const { run } = await drive([LAYOUT(other), FLAG, BADGE, GAP, SORT_PIN], { sort: "edit" });
    await expect(run()).rejects.toThrow(/diverged at config 1: expected the panel fixture's b7 config, got columnOrder/);
  });

  it("names the config when the third reply patches displayRules on an existing column", async () => {
    const { run } = await drive([LAYOUT(), FLAG, BADGE_PATCHED, GAP, SORT_PIN], { sort: "edit" });
    await expect(run()).rejects.toThrow(/diverged at config 3: expected the panel fixture's b7 config, got displayRules/);
  });

  it("names the live edit when the code pin's coding agent changes nothing", async () => {
    const { run } = await drive(GOOD(), { sort: "none" });
    await expect(run()).rejects.toThrow("diverged at live edit pin-5: expected kept, got not-kept no-change");
  });

  it("accepts pin-2 ending not-kept/check-failed and records it (D4 point 6)", async () => {
    const { app, run } = await drive(GOOD(), { sort: "edit", flagCheckFails: true });
    const out = await run();
    expect(out.timings.liveEdits[0]).toMatchObject({ pinId: "pin-2", status: "not-kept", reason: "check-failed" });
    const f = await app.sessionOnDisk(out.fittingId);
    expect(f.pins.find((p) => p.id === "pin-2")?.liveEdit).toMatchObject({ status: "not-kept", reason: "check-failed", detail: expect.stringContaining("SYN check failed") });
  });

  it("names the submit when the push fails (an unreachable origin, D4 point 4a)", async () => {
    const { run } = await drive(GOOD(), { sort: "edit", brokenRemote: true });
    await expect(run()).rejects.toThrow(/diverged at submit: expected pushed true, got false/);
  });
});
