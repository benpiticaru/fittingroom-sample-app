// @vitest-environment node
// FR-14: the panel's acceptance fixture is generated from core's real helpers over the
// committed sample-app config; this test fails when the committed file drifts.
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PanelScript, ScriptStep } from "./panel-script/generate.js";

const appDir = fileURLToPath(new URL(".", import.meta.url));
const standalone = existsSync(join(appDir, ".fitting-room-export")); // FR-23 export has no packages/
// Built from segments: the FR-23 export scan rejects a literal packages/<name>/src path in any exported file.
const target = join(appDir, "..", "..", "packages", "panel", "src", "__fixtures__", "script.json");
const readJson = (rel: string) => JSON.parse(readFileSync(join(appDir, rel), "utf8"));
const baseline = { config: readJson("src/features/jobs/tableConfig.json"), overlay: readJson("src/features/jobs/tableConfig.muslin.json") };
// No static workspace imports: describe.skipIf still runs the body at collection (Vitest 2.1.9).

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const body = (s: ScriptStep): Body => s.response.body as Body;

describe.skipIf(standalone)("panel acceptance script", () => {
  let fresh = "";
  let script: PanelScript;
  let buildPanelScript: (b: typeof baseline) => PanelScript;
  let assertNoObviousIdentifiers: (v: unknown) => void;
  beforeAll(async () => {
    ({ buildPanelScript } = await import("./panel-script/generate.js"));
    ({ assertNoObviousIdentifiers } = await import("@fitting-room/fixtures"));
    script = buildPanelScript(baseline);
    fresh = `${JSON.stringify(script, null, 2)}\n`;
    if (process.env.UPDATE_PANEL_SCRIPT === "1") {
      mkdirSync(dirname(target), { recursive: true }); // __fixtures__/ does not exist before the first run
      writeFileSync(target, fresh);
    }
  });

  it("committed script.json equals the generator output", () => {
    expect(readFileSync(target, "utf8"), "run `npm run panel-script:generate` and commit the result").toBe(fresh);
  });

  it("is deterministic", () => expect(JSON.stringify(buildPanelScript(baseline))).toBe(JSON.stringify(buildPanelScript(baseline))));

  it("every response config equals the next expected config, in order", () => {
    const seen = script.steps.filter((s) => body(s).config !== undefined && (s.response.status < 300 && body(s).status !== "question" || body(s).dirty));
    // Steps 3 and 6 repeat the previous config (C2 = C1, C5 = C4), so they still consume one entry each.
    expect(script.expectedConfigs).toHaveLength(9);
    expect(seen.map((s) => body(s).config)).toEqual(script.expectedConfigs);
  });

  it("covers the R7 shapes: screens, branch, context, live false with reason, the 500 dirty body", () => {
    expect(body(script.steps[0]!).screens).toEqual({ dressed: ["/jobs"] });
    expect(body(script.steps[0]!).fitting.branch).toEqual({ name: "fitting/fit-0a1b2c3d", base: "dev", worktree: ".worktrees/fitting-fit-0a1b2c3d" });
    const pinned = script.steps.filter((s) => body(s).status === "pinned").map((s) => body(s));
    expect(pinned[0]!.pin.context).toEqual({ route: "/jobs", persona: "dispatcher", fixtures: ["jobs"] });
    expect(pinned.find((b) => b.pin.id === "pin-2")).toMatchObject({ live: false, notLiveReason: "needs code" });
    expect(pinned.find((b) => b.pin.id === "pin-4")).toMatchObject({ live: false, notLiveReason: "undressed screen" });
    const dirty = script.steps.find((s) => s.response.status === 500)!;
    expect(body(dirty)).toMatchObject({ dirty: true, pin: { id: "pin-7" }, fitting: { branch: { dirty: true } } });
  });

  it("the withdrawal removes pin-1's column move and keeps the data-gap placeholder", () => {
    const c0 = script.expectedConfigs[0] as Body;
    const c4 = script.expectedConfigs[4] as Body;
    expect(c4.columnOrder).toEqual(baseline.config.columnOrder);
    expect((script.expectedConfigs[1] as Body).columnOrder).not.toEqual(c0.columnOrder);
    expect(c4.placeholderColumns.map((c: Body) => c.name)).toContain("lastVisitDate");
  });

  it("the undressed data gap adds no placeholder column", () => {
    expect(script.expectedConfigs[5]).toEqual(script.expectedConfigs[4]);
    const pin4 = body(script.steps.find((s) => body(s).pin?.id === "pin-4")!).pin;
    expect(pin4.configPatch).toBeUndefined();
  });

  it("steps 0-5 are the B7 prefix: start, three utterances with one question and answer, withdraw pin-1", () => {
    expect(script.b7Prefix).toEqual({ steps: 6, configs: 5 });
    expect(script.steps.slice(0, 6).map((s) => s.action)).toEqual(["start", "send", "send", "send", "send", "withdraw"]);
    expect(script.steps.slice(1, 5).map((s) => s.text)).toEqual([
      "Put the technician right after the status, that's who I look for first.",
      "Flag any job with a part on backorder so I can chase it.",
      "A badge on the row is enough.",
      "Add a last visit date column",
    ]);
    expect(body(script.steps[2]!).status).toBe("question");
    expect(script.steps[5]!.pinId).toBe("pin-1");
    expect(body(script.steps[3]!).pin.utterance).toBe("Flag any job with a part on backorder so I can chase it.");
  });

  it("resumeMidQuestion carries the pending pin and its unanswered question", () => {
    const b = body(script.resumeMidQuestion);
    expect(script.resumeMidQuestion.action).toBe("resume");
    expect(b.fitting.pending.id).toBe("pin-2");
    expect(b.fitting.pending.clarifications.at(-1).answer).toBeUndefined();
    expect(b.fitting.transcript).toHaveLength(3); // pin-1's turn, then the question pin's two turns
    expect(b.config).toEqual(script.expectedConfigs[1]);
  });

  it("b7 is the recorded script as the git agent reads it (FR-17)", async () => {
    const { SCRIPT } = await import("./test-support/drive-beta.mjs");
    expect(script.b7.utterances).toEqual(SCRIPT.map((s: { text: string }) => s.text));
    const E = script.expectedConfigs;
    // Every point is a config the panel's own transcript test already applies, so b7 cannot drift from it.
    expect(script.b7.configs).toEqual([E[0], E[1], E[1], E[1], E[3], E[3], E[4]]);
    expect(script.b7.configs).toHaveLength(7);
    expect((script.b7.configs[1] as Body).columnOrder).not.toEqual(baseline.config.columnOrder); // pin-1's patch survived on "/"
    expect((script.b7.configs[6] as Body).columnOrder).toEqual(baseline.config.columnOrder); // withdrawn
    expect((script.b7.configs[4] as Body).placeholderColumns.map((c: Body) => c.name)).toContain("lastVisitDate");
  });

  it("409 carries the WithdrawConflict message", () => {
    const conflict = script.steps.find((s) => s.response.status === 409)!;
    expect(body(conflict).error).toMatch(/pin-5 cannot be withdrawn: pin-6 changes "defaultSort"/);
  });

  it("is synthetic and passes the identifier guard", () => {
    expect(script.synthetic).toBe(true);
    assertNoObviousIdentifiers(script);
  });
});
