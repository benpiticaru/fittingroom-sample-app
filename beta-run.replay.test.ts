// @vitest-environment node
// FR-17 D9 (after FR-104's live-edit-run guard): the evidence of the recorded real fitting is synthetic, scrubbed, complete,
// and records the 1-minute load average at the start and end of every timing. The evidence checks skip until the run has
// produced `replay/beta-run.json` (an app path, so the export runs them too); one case outside that block ties the committed
// session to its evidence, so a session committed without it is red. The docs' numbers come from this file.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { tempDirs } from "@fitting-room/agent/testing";

const temp = tempDirs();
const APP = fileURLToPath(new URL(".", import.meta.url));
const EVIDENCE = join(APP, "replay", "beta-run.json");
const SESSION = join(APP, ".fitting-room", "sessions", "example-beta.json");
const OWNER_UTTERANCE = "add interactive sort functionality to each column";
// Generic service accounts (CI runners, containers) would match ordinary words in a log line; the run is recorded on the facilitator's own account.
const GENERIC_ACCOUNTS = new Set(["runner", "root", "node", "user", "ubuntu"]);

interface Timing { name: string; seconds: number; load1: number; load1End: number }
interface Pinned { utterance: string; pinId: string; status: "kept" | "not-kept" | "cancelled"; reason?: string; seconds: number; load1: number; load1End: number; phases: Timing[]; paths?: string[] }
interface Evidence {
  ticket: "FR-17"; recordedOn: string; site: "export";
  environment: { os: string; node: string; claudeCode: string; vite: string; agent: string; cpus: number };
  install: Timing; buildMuslin: Timing; promotion: Timing; pins: Pinned[];
  attempt: { seconds: number; load1: number; load1End: number };
  load: { note: string };
  commits: string[]; codeCommit: { paths: string[]; added: number; removed: number }; liveLines: string[];
}

/** Every way the evidence text fails the guard, as short labels; empty when it passes. `text` is the file as read. */
function problems(text: string): string[] {
  const out: string[] = [];
  const run = JSON.parse(text) as Evidence;
  if (run.environment.agent !== "claude") out.push("agent is not claude");
  const sort = run.pins.find((p) => p.utterance === OWNER_UTTERANCE);
  if (!sort || sort.status !== "kept") out.push("the owner's sort utterance is not a kept pin");
  if (/\/Users\/|\/home\/|\/private\/|\/var\/folders\/|\/tmp\/|[A-Za-z]:\\/.test(text)) out.push("machine path");
  const user = userInfo().username;
  if (user && !GENERIC_ACCOUNTS.has(user) && text.toLowerCase().includes(user.toLowerCase())) out.push("user name");
  for (const h of new Set([hostname(), hostname().split(".")[0]!])) if (h.length > 3 && text.toLowerCase().includes(h.toLowerCase())) out.push("host name");
  const home = process.env.HOME ?? homedir();
  if (home && home.length > 1 && text.includes(home)) out.push("home directory");
  const all: Timing[] = [run.install, run.buildMuslin, run.promotion, run.attempt as unknown as Timing, ...run.pins, ...run.pins.flatMap((p) => p.phases)];
  if (all.some((t) => typeof t.load1 !== "number" || typeof t.load1End !== "number")) out.push("a timing lacks its load at start or end");
  // Owner rule: timings under a 1-minute load of 15 or more are published only with a statement that they overstate.
  else if (all.some((t) => t.load1 >= 15 || t.load1End >= 15) && !/overstate/.test(run.load.note)) out.push("high load without the overstatement note");
  const code = run.commits.findIndex((c) => c === `code pin-${sort?.pinId.replace("pin-", "")}: ${OWNER_UTTERANCE}`);
  if (code < 0 || run.commits[code + 1] !== "record: live edit") out.push("commits lack the code pin then record: live edit");
  if (run.liveLines.length > 40) out.push("more than 40 live lines");
  return out;
}

describe("a committed session carries its evidence", () => {
  it("has replay/beta-run.json whenever .fitting-room/sessions/example-beta.json exists", () => {
    if (existsSync(SESSION)) expect(existsSync(EVIDENCE), "example-beta.json is committed without replay/beta-run.json").toBe(true);
  });
});

describe.skipIf(!existsSync(EVIDENCE))("the recorded beta run (FR-17 D9)", () => {
  let text = "";
  beforeAll(() => { text = readFileSync(EVIDENCE, "utf8"); });

  it("passes the guard: claude agent, the owner's phrase kept, no path or machine name, load on every timing, the code and record commits", () => {
    expect(problems(text)).toEqual([]);
  });

  it("holds no obvious identifier", async () => {
    const { assertNoObviousIdentifiers } = await import("@fitting-room/fixtures");
    expect(() => assertNoObviousIdentifiers(JSON.parse(text))).not.toThrow();
  });
});

describe("the guard bites on a synthetic evidence object", () => {
  const good = (): Evidence => {
    const t = (name: string): Timing => ({ name, seconds: 1, load1: 1, load1End: 1 });
    return {
      ticket: "FR-17", recordedOn: "2026-01-02", site: "export",
      environment: { os: "SYN os", node: "v20", claudeCode: "2.1.296", vite: "5", agent: "claude", cpus: 8 },
      install: t("install"), buildMuslin: t("build"), promotion: t("promotion"),
      pins: [{ utterance: OWNER_UTTERANCE, pinId: "pin-4", status: "kept", seconds: 5, load1: 1, load1End: 1, phases: [t("editing")], paths: ["src/A.tsx"] }],
      attempt: { seconds: 1, load1: 1, load1End: 1 }, load: { note: "" },
      commits: ["pin-4: sort", `code pin-4: ${OWNER_UTTERANCE}`, "record: live edit"],
      codeCommit: { paths: ["src/A.tsx"], added: 3, removed: 1 }, liveLines: [],
    };
  };
  it("accepts a clean object", () => {
    expect(problems(JSON.stringify(good()))).toEqual([]);
  });
  it("rejects a home path", () => {
    const e = good();
    e.liveLines = ["worktree /Users/someone/app"];
    expect(problems(JSON.stringify(e))).toContain("machine path");
  });
  it("rejects high load without the note, a missing load, and a wrong commit order", () => {
    const hot = good();
    hot.install.load1 = 20;
    expect(problems(JSON.stringify(hot))).toContain("high load without the overstatement note");
    const bare = JSON.parse(JSON.stringify(good()));
    delete bare.promotion.load1End;
    expect(problems(JSON.stringify(bare))).toContain("a timing lacks its load at start or end");
    const wrong = good();
    wrong.commits = [`code pin-4: ${OWNER_UTTERANCE}`, "pin-4: sort"];
    expect(problems(JSON.stringify(wrong))).toContain("commits lack the code pin then record: live edit");
  });
  it("reads a file the way the real check does", () => {
    const dir = temp.makeSync("fit-beta-run-");
    try {
      writeFileSync(join(dir, "beta-run.json"), JSON.stringify(good()));
      expect(problems(readFileSync(join(dir, "beta-run.json"), "utf8"))).toEqual([]);
    } finally { temp.cleanupSync(); }
  });
});
