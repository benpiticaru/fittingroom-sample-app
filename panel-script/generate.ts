/**
 * Builds the panel's acceptance script (FR-14) with core's real helpers.
 *
 * Purpose: replay SCENARIO the way the B4 utterances route would (spec line
 * 278), recording each request and the response the server would send, so the
 * panel can be tested without importing core at runtime.
 * Inputs: the sample app's committed Baseline. Output: a deterministic
 * PanelScript (clock 2026-01-01T00:00:<step>Z, no randomness, no I/O).
 * Run `npm run panel-script:generate` after changing the baseline or scenario.
 */
import {
  answerQuestion, appendPin, classifyUtterance, isDressed, liveness, nextPinId, recordQuestion,
  resolveQuestion, sessionConfig, sessionFiles, stamp, toFieldName, patchFor, withBefore, withdrawPin,
  withFile, WithdrawConflict,
} from "@fitting-room/core";
import type { Baseline, Fitting, Pin } from "@fitting-room/core";
import { buildB7 } from "./b7.js";
import { SCENARIO } from "./scenario.js";

export interface ScriptStep {
  action: "start" | "send" | "withdraw" | "resume";
  route?: string;
  text?: string;
  pinId?: string;
  request: { method: "GET" | "POST" | "DELETE"; path: string; body?: unknown };
  response: { status: number; body: unknown };
}

export interface PanelScript {
  $comment: string;
  synthetic: true;
  token: string;
  meta: { status: 200; body: { agent: string; modelBacked: boolean; remote: string | null; personas: string[]; personasDir: string; screens: string[]; personaInfo: Record<string, { displayName?: string; handle?: string; records: { key: string; count: number }[] }>; publisher: { name: "jira" | "github" | "none"; target: string | null } | null } };
  steps: ScriptStep[];
  expectedConfigs: unknown[];
  b7Prefix: { steps: 6; configs: 5 };
  resumeMidQuestion: ScriptStep;
  /** The recorded B7 script as the git agent reads it: five utterances and seven configs (FR-17). */
  b7: { utterances: string[]; configs: unknown[] };
}

const clock = (n: number): string => `2026-01-01T00:00:${String(n).padStart(2, "0")}Z`;
const DIRTY_ERROR = "commit refused: the fitting worktree has changes Fitting Room did not make";

export function buildPanelScript(baseline: Baseline): PanelScript {
  const { fittingId: id, bundleKeys, screens, persona, configSurface } = SCENARIO;
  const knownFields = Object.keys(baseline.config.labels as Record<string, string>);
  const base = `/api/fittings/${id}`;
  const steps: ScriptStep[] = [];
  const expectedConfigs: unknown[] = [];
  const config = (f: Fitting) => sessionConfig(baseline, f.pins);
  const record = (c: unknown) => expectedConfigs.push(structuredClone(c));
  const dressedRoutes = () => Object.keys(screens).filter((r) => isDressed(r, screens, bundleKeys));

  let f: Fitting = {
    id, muslinBuild: "synthetic", app: { name: "sample-dispatch", screen: SCENARIO.start.screen },
    fixtures: [...bundleKeys], stakeholder: { role: SCENARIO.start.role }, startedAt: clock(0), pins: [], transcript: [],
    branch: { name: `fitting/${id}`, base: "dev", worktree: `.worktrees/fitting-${id}` },
  };
  steps.push({
    action: "start",
    request: { method: "POST", path: "/api/fittings", body: SCENARIO.start },
    response: { status: 200, body: { fitting: f, config: config(f), screens: { dressed: dressedRoutes() } } },
  });
  record(config(f));

  /** The FacilitatorAgent.pin shape: classification of the given words. */
  const agentPinFor = (text: string, pinId: string, at: string, ask?: string): Pin => {
    const c = classifyUtterance(text, knownFields);
    const pin: Pin = { id: pinId, at, utterance: text, kind: c.kind, scope: c.scope, summary: text };
    if (c.kind === "data-gap") pin.impliedField = { name: toFieldName(c.asked ?? text) };
    if (ask) pin.clarifications = [{ question: ask }];
    return pin;
  };

  const send = (n: number, s: { route: string; text: string; ask?: string; dirty?: true }): void => {
    const at = clock(n);
    const request = { method: "POST" as const, path: `${base}/utterances`, body: { text: s.text, route: s.route } };
    let pin: Pin;
    let secondRound = false;
    let skipTurn = false;
    let route = s.route;
    if (f.pending) {
      const answered = answerQuestion(f, s.text, at);
      const pending = answered.pending;
      route = pending.context!.route;
      const resolved = resolveQuestion(answered.fitting, pending, agentPinFor(pending.utterance, pending.id, pending.at), { allowPatch: true });
      f = resolved.fitting;
      pin = resolved.pin;
      secondRound = resolved.secondRound;
      skipTurn = true;
    } else {
      const pid = nextPinId(f);
      pin = stamp(agentPinFor(s.text, pid, at, s.ask), {
        id: pid, at, utterance: s.text, context: { route, persona, fixtures: [...bundleKeys] },
      });
      if (s.ask) {
        f = recordQuestion(f, pin);
        steps.push({ action: "send", route: s.route, text: s.text, request, response: { status: 200, body: { status: "question", question: s.ask } } });
        return;
      }
    }
    const dressed = isDressed(route, screens, bundleKeys);
    if (!dressed) delete pin.configPatch;
    else if (pin.scope === "frontend" && !pin.configPatch) {
      const patch = patchFor(classifyUtterance(pin.utterance, knownFields), pin.utterance, sessionFiles(baseline, f.pins).config);
      if (patch) pin.configPatch = patch;
    }
    pin = withBefore(withFile(pin, configSurface), sessionFiles(baseline, f.pins).config);
    const lv = liveness(pin, { dressed, secondRound });
    pin.live = lv.live;
    if (lv.notLiveReason) pin.notLiveReason = lv.notLiveReason;
    f = appendPin(f, pin, skipTurn ? { skipTurn } : {});
    const cfg = config(f);
    record(config(f));
    const response = s.dirty
      ? { status: 500, body: { error: DIRTY_ERROR, dirty: true, pin, config: cfg, fitting: { ...f, branch: { ...f.branch!, dirty: true } } } }
      : { status: 200, body: { status: "pinned", pin, config: cfg, live: lv.live, ...(lv.notLiveReason ? { notLiveReason: lv.notLiveReason } : {}) } };
    steps.push({ action: "send", route: s.route, text: s.text, request, response });
  };

  const withdraw = (n: number, pinId: string): void => {
    const request = { method: "DELETE" as const, path: `${base}/pins/${pinId}` };
    try {
      f = withdrawPin(f, pinId, clock(n));
    } catch (e) {
      if (!(e instanceof WithdrawConflict)) throw e;
      steps.push({ action: "withdraw", pinId, request, response: { status: 409, body: { error: e.message } } });
      return;
    }
    record(config(f));
    steps.push({ action: "withdraw", pinId, request, response: { status: 200, body: { config: config(f) } } });
  };

  let resumeMidQuestion: ScriptStep | undefined;
  SCENARIO.steps.forEach((s, i) => {
    const n = i + 1;
    if (s.kind === "send") send(n, s);
    else withdraw(n, s.pinId);
    if (n === 2) {
      resumeMidQuestion = {
        action: "resume",
        request: { method: "GET", path: base },
        response: { status: 200, body: { fitting: f, config: config(f), screens: { dressed: dressedRoutes() } } },
      };
    }
  });

  return {
    $comment: "Generated by examples/sample-app/panel-script/generate.ts; run npm run panel-script:generate",
    synthetic: true,
    token: SCENARIO.token,
    meta: { status: 200, body: { ...SCENARIO.meta } },
    steps,
    expectedConfigs,
    b7Prefix: { steps: 6, configs: 5 },
    resumeMidQuestion: resumeMidQuestion!,
    b7: buildB7(baseline),
  };
}
