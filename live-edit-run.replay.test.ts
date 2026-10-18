// @vitest-environment node
// FR-104 (spec Revision 10, LE7, AC3): the evidence of the recorded real run is synthetic, scrubbed, complete, and
// records the 1-minute load average at the start and end of every timed step (owner decision 2026-10-14: the run was
// taken under load from unrelated work, which the evidence and the walkthrough must say). The walkthrough (docs/live-edit-fitting.md, Measured) publishes these numbers.
import { readFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertNoObviousIdentifiers } from "@fitting-room/fixtures";

const APP = fileURLToPath(new URL(".", import.meta.url));
const text = readFileSync(join(APP, "replay/live-edit-run.json"), "utf8");
// Generic service accounts (CI runners, containers) would match ordinary words in a log line; the run is recorded on
// the facilitator's own account, which is the one this check exists for.
const GENERIC_ACCOUNTS = new Set(["runner", "root", "node", "user", "ubuntu"]);

interface Timing { name: string; seconds: number; load1: number; load1End: number }
interface Pinned { utterance: string; pinId: string; status: "kept" | "not-kept" | "cancelled"; reason?: string; seconds: number; load1: number; load1End: number; target: string; met: boolean; phases: Timing[]; paths?: string[] }
interface Evidence {
  ticket: "FR-104"; recordedOn: string; site: "export" | "self-host";
  environment: { os: string; node: string; claudeCode: string; vite: string; agent: string; cpus: number };
  install: Timing; promotion: Timing; pins: Pinned[]; earlierAttempts: Pinned[]; back: { pinIds: string[]; outcome: string; seconds: number; load1: number; load1End: number };
  load: { gate: string; note: string };
  forwarding: { staticBeforePromotion: boolean; htmlFromDevServer: boolean; tokenMeta: boolean; hmrConnected: boolean; hmrUpdateDuringEdit: boolean; editedSourceServed: boolean; revertedSourceServed: boolean };
  commits: string[]; liveLines: string[];
}
const run = JSON.parse(text) as Evidence;

describe("the recorded live edit run (FR-104)", () => {
  it("is the ticket's utterance, run with the default agent", () => {
    expect(run.pins[0]).toMatchObject({ utterance: "add sort functionality to each column", pinId: "pin-1" });
    expect(run.environment.agent).toBe("git");
  });

  it("holds no obvious identifier and no machine path", () => {
    expect(() => assertNoObviousIdentifiers(run)).not.toThrow();
    expect(text).not.toMatch(/\/Users\/|\/home\/|\/private\/|\/var\/folders\/|\/tmp\/|[A-Za-z]:\\/);
  });

  it("holds no user name, host name or home directory of the machine running this test (r2)", () => {
    const user = userInfo().username;
    if (user && !GENERIC_ACCOUNTS.has(user)) expect(text.toLowerCase(), "user name").not.toContain(user.toLowerCase());
    for (const h of new Set([hostname(), hostname().split(".")[0]!])) {
      if (h.length > 3) expect(text.toLowerCase(), "host name").not.toContain(h.toLowerCase());
    }
    const home = process.env.HOME ?? homedir();
    if (home && home.length > 1) expect(text, "home directory").not.toContain(home);
  });

  it("records the load at the start and end of every timing, and says so when it was high", () => {
    const pinned = [...run.pins, ...run.earlierAttempts];
    const all: Timing[] = [run.install, run.promotion, run.back as Timing, ...pinned, ...pinned.flatMap((p) => p.phases)];
    for (const t of all) {
      expect(typeof t.load1).toBe("number");
      expect(typeof t.load1End).toBe("number");
    }
    // Owner rule: timings under a 1-minute load of 15 or more are published only with a statement that they overstate.
    if (all.some((t) => t.load1 >= 15 || t.load1End >= 15)) expect(run.load.note).toMatch(/overstate/);
  });

  it("proves forwarding against the real Vite (FR-101 carried note)", () => {
    expect(run.forwarding).toEqual({ staticBeforePromotion: true, htmlFromDevServer: true, tokenMeta: true, hmrConnected: true, hmrUpdateDuringEdit: true, editedSourceServed: true, revertedSourceServed: true });
  });

  it("states each target honestly: met is measured seconds within the target", () => {
    // A change that was not kept never showed, so it cannot meet a target that is about showing a change.
    for (const p of [...run.pins, ...run.earlierAttempts]) expect(p.met, p.utterance).toBe(p.status === "kept" && p.seconds <= (p.pinId === "pin-1" ? 240 : 180));
  });

  it("records the branch the run made", () => {
    expect(run.commits[0]).toMatch(/^pin-1: add sort functionality to each column/);
    if (run.pins[0]!.status === "kept") expect(run.commits).toEqual(expect.arrayContaining([expect.stringMatching(/^code pin-1: /), "record: live edit", expect.stringMatching(/^revert pin-1: /)]));
    expect(run.liveLines.length).toBeLessThanOrEqual(40);
  });
});
