// @vitest-environment node
// FR-104 (spec Revision 10, LE7): the sample app turns live edit on with its muslin seam protected.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LIVE_EDIT_DEFAULTS, matchWriteSet, parseFittingroomConfig, type LiveChange, type WriteSetRules } from "@fitting-room/agent";

const APP = fileURLToPath(new URL(".", import.meta.url));
const cfg = parseFittingroomConfig(JSON.parse(readFileSync(join(APP, ".fitting-room/config.json"), "utf8")));
// The production seam, the replacement, the merged config, the fixture client and the descriptor.
const SEAM = ["src/api/client.ts", "src/muslin/client.ts", "src/muslin/config.ts", "src/muslin/fixture-client.ts", "src/muslin/descriptor.json"];
const m = cfg.muslin;

/** The rules the transaction builds for this app (host-relative paths, so hostRel is empty). */
const rules = (protect: readonly string[]): WriteSetRules => ({
  hostRel: "", writeSet: cfg.liveEdit.writeSet, protect, personas: m.personas,
  ...(m.configSurface ? { configSurface: m.configSurface } : {}), ...(m.overlay ? { overlay: m.overlay } : {}),
  ...(m.fixtures ? { fixtures: m.fixtures } : {}), ...(m.buildFlag ? { buildFlag: m.buildFlag } : {}),
});
const comment = (path: string): LiveChange => ({ path, status: "modified", added: ["// SYN note"], removed: [] });

describe("the sample app's liveEdit config", () => {
  it("turns live edit on, protects the seam, passes USER and LOGNAME, and keeps every other default", () => {
    expect(cfg.liveEdit).toEqual({
      ...LIVE_EDIT_DEFAULTS, enabled: true, checkCommand: cfg.attempt.testCommand, protect: ["src/api/client.ts", "src/muslin/**"], agentEnv: ["USER", "LOGNAME"],
    });
    expect(cfg.liveEdit.devCommand).toBe("npm run dev:muslin -- --host 127.0.0.1 --port {port} --strictPort");
  });

  it("refuses an edit to any seam file, and only because of protect", () => {
    for (const p of SEAM) {
      expect(matchWriteSet([comment(p)], rules(cfg.liveEdit.protect)), p).toMatchObject({ ok: false, reason: "write-set", rule: 2, path: p });
      expect(matchWriteSet([comment(p)], rules([])), p).toEqual({ ok: true });
    }
  });

  it("refuses a production edit that imports the muslin side, by rule 5 (the alias seam has no build flag left)", () => {
    const change: LiveChange = {
      path: "src/features/jobs/JobsTable.tsx", status: "modified",
      added: ['import { muslinConfig } from "../../muslin/config";'], removed: [],
    };
    expect(matchWriteSet([change], rules(cfg.liveEdit.protect))).toMatchObject({ ok: false, reason: "write-set", rule: 5, why: expect.stringContaining("a line imports the muslin side") });
  });

  it("promotes through dev:muslin, which runs the cli's built entry with --host/--port/--strictPort passed through", () => {
    const scripts = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(cfg.liveEdit.devCommand).toMatch(/^npm run dev:muslin -- /);
    // The standalone export rewrites the script to the plain command (its cli ships with a dist, so the bin links).
    const standalone = existsSync(join(APP, ".fitting-room-export"));
    expect(scripts["dev:muslin"]).toBe(standalone ? "fit muslin dev" : "tsc -b ../../packages/cli && node ../../packages/cli/dist/index.js muslin dev");
    expect(cfg.liveEdit.devCommand).toContain("--host 127.0.0.1 --port {port} --strictPort");
  });

  it("leaves the jobs feature writable and keeps fixtures, personas and tests out", () => {
    expect(matchWriteSet([comment("src/features/jobs/JobsTable.tsx")], rules(cfg.liveEdit.protect))).toEqual({ ok: true });
    for (const p of ["src/fixtures/dispatcher.ts", "src/fixtures/personas/dispatcher/jobs.json", "src/features/jobs/JobsTable.test.tsx"]) {
      expect(matchWriteSet([comment(p)], rules(cfg.liveEdit.protect)), p).toMatchObject({ ok: false, rule: 2 });
    }
  });
});
