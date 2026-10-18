/**
 * The recorded B7 script as the `git` agent reads it (FR-17).
 *
 * Purpose: the config the panel would show at each point of the five-utterance
 * recorded fitting (start, after each pin, after withdrawing pin-1), derived
 * with core's rule classifier so a real model's session can be cross-checked
 * against an independent reading. Route "/" is dressed as the sample config does.
 * Inputs: the sample app's Baseline. Output: utterances and seven configs.
 * Deterministic, no I/O. Every string here is synthetic.
 */
import {
  appendPin, classifyUtterance, isDressed, liveness, nextPinId, sessionConfig, sessionFiles, stamp,
  toFieldName, patchFor, withBefore, withdrawPin, withFile,
} from "@fitting-room/core";
import type { Baseline, Fitting, Pin } from "@fitting-room/core";
import { B7_UTTERANCES } from "./scenario.js";

const ROUTE = "/";
const SCREENS = { "/": { endpoints: ["jobs"] } };
const BUNDLE_KEYS = ["jobs"];
const SURFACE = "src/features/jobs/tableConfig.json";
const clock = (n: number): string => `2026-01-01T00:01:${String(n).padStart(2, "0")}Z`;

export function buildB7(baseline: Baseline): { utterances: string[]; configs: unknown[] } {
  const known = Object.keys(baseline.config.labels as Record<string, string>);
  const configs: unknown[] = [];
  let f: Fitting = {
    id: "fit-0b7e5a17", muslinBuild: "synthetic", app: { name: "sample-dispatch", screen: ROUTE }, fixtures: [...BUNDLE_KEYS],
    stakeholder: { role: "dispatcher" }, startedAt: clock(0), pins: [], transcript: [],
    branch: { name: "fitting/fit-0b7e5a17", base: "dev", worktree: ".worktrees/fitting-fit-0b7e5a17" },
  };
  const record = (): number => configs.push(structuredClone(sessionConfig(baseline, f.pins)));
  record();
  B7_UTTERANCES.forEach((text, i) => {
    const at = clock(i + 1);
    const id = nextPinId(f);
    const c = classifyUtterance(text, known);
    let pin: Pin = { id, at, utterance: text, kind: c.kind, scope: c.scope, summary: text };
    if (c.kind === "data-gap") pin.impliedField = { name: toFieldName(c.asked ?? text) };
    pin = stamp(pin, { id, at, utterance: text, context: { route: ROUTE, persona: "dispatcher", fixtures: [...BUNDLE_KEYS] } });
    const dressed = isDressed(ROUTE, SCREENS, BUNDLE_KEYS);
    if (pin.scope === "frontend") {
      const patch = patchFor(c, text, sessionFiles(baseline, f.pins).config);
      if (patch) pin.configPatch = patch;
    }
    pin = withBefore(withFile(pin, SURFACE), sessionFiles(baseline, f.pins).config);
    const lv = liveness(pin, { dressed, secondRound: false });
    pin.live = lv.live;
    if (lv.notLiveReason) pin.notLiveReason = lv.notLiveReason;
    f = appendPin(f, pin, {});
    record();
  });
  f = withdrawPin(f, "pin-1", clock(B7_UTTERANCES.length + 1));
  record();
  return { utterances: [...B7_UTTERANCES], configs };
}
