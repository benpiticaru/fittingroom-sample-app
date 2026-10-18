// @vitest-environment node
// FR-17 Task 7: the panel fixture's b7 block against the committed real session. `b7.configs` comes from the rule classifier
// (the `git` agent's reading), the session from the model; neither is derived from the other, so equality here is a
// cross-check and a mismatch is a finding, never a regenerated expectation. Configs only (what the panel applies), never kinds.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL(".", import.meta.url));
const standalone = existsSync(join(appDir, ".fitting-room-export")); // FR-23 export has no packages/
// Built from segments: the FR-23 export scan rejects a literal packages/<name>/src path in any exported file.
const PANEL_SCRIPT = join(appDir, "..", "..", "packages", "panel", "src", "__fixtures__", "script.json");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe.skipIf(standalone)("the panel fixture's b7 configs equal the committed beta session", () => {
  const baseline = {
    config: readJson(join(appDir, "src/features/jobs/tableConfig.json")),
    overlay: readJson(join(appDir, "src/features/jobs/tableConfig.muslin.json")),
  };

  it("has seven configs: start, after each of the five pins, after the withdraw", () => {
    expect(readJson(PANEL_SCRIPT).b7.configs).toHaveLength(7);
  });

  it("each point equals sessionConfig over the first k committed pins (pin-1 withdrawn only at the last)", async () => {
    const { sessionConfig } = await import("@fitting-room/core");
    const { configs } = readJson(PANEL_SCRIPT).b7 as { configs: unknown[] };
    const pins = readJson(join(appDir, ".fitting-room", "sessions", "example-beta.json")).pins as Array<{ id: string; withdrawnAt?: string }>;
    expect(pins.map((p) => p.id)).toEqual(["pin-1", "pin-2", "pin-3", "pin-4", "pin-5"]);
    // The committed pin-1 carries withdrawnAt from the last step, which sessionFiles drops; clear it for the points before the withdraw.
    const before = pins.map((p) => (p.id === "pin-1" ? { ...p, withdrawnAt: undefined } : p));
    for (let k = 0; k <= 5; k++) {
      expect(configs[k], `config ${k}`).toEqual(sessionConfig(baseline, before.slice(0, k) as never));
    }
    expect(pins[0]!.withdrawnAt).toBeDefined();
    expect(configs[6], "config 6").toEqual(sessionConfig(baseline, pins as never));
  });
});
