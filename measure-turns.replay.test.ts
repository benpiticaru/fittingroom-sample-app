// @vitest-environment node
// FR-145: the turn summariser. Calls with no usage are counted, never dropped and never a crash (plan Review Focus 2).
import { describe, expect, it } from "vitest";
import { PRICES, summarizeTurns } from "./test-support/measure-turns.mjs";
import config from "./.fitting-room/config.json";

const turn = (o: Record<string, unknown>) => ({ schema: "fitting-room/turn@1", fitting: "fit-0a1b2c3d", pin: "pin-1", n: 1, agent: "claude", role: "first-pass", at: "2026-01-01T00:00:00.000Z", ...o });
const ok = (inT: number, outT: number, ms: number, role = "first-pass") => turn({ role, ms, response: { status: 200, body: { usage: { input_tokens: inT, output_tokens: outT } } } });

describe("summarizeTurns", () => {
  it("prices the model the sample app runs at the owner's table ($2 / $10 per MTok)", () => {
    expect(PRICES).toMatchObject({ model: "claude-sonnet-5-5", inUsdPerMTok: 2, outUsdPerMTok: 10 });
    expect(config.providers.claude.model).toBe(PRICES.model);
  });
  const records = [ok(100, 20, 400), ok(50, 10, 600), turn({ error: "network", ms: 0 })];
  it("sums a label's calls, failures, tokens and ms, and prices them exactly", () => {
    const s = summarizeTurns(records, PRICES);
    expect(s.byLabel["pin-1"]).toMatchObject({ calls: 3, failed: 1, inputTokens: 150, outputTokens: 30, ms: 1000 });
    expect(s.byLabel["pin-1"]!.usd).toBe((150 * 2 + 30 * 10) / 1e6);
    expect(s.total).toEqual(s.byLabel["pin-1"]);
  });
  it("splits a data turn from a first-pass turn on the same pin", () => {
    const s = summarizeTurns([ok(100, 20, 400), ok(70, 5, 900, "data")], PRICES);
    expect(s.byRole["data"]).toMatchObject({ calls: 1, inputTokens: 70, outputTokens: 5, ms: 900 });
    expect(s.byRole["first-pass"]).toMatchObject({ calls: 1, inputTokens: 100 });
    expect(Object.keys(s.byLabel)).toEqual(["pin-1"]);
  });
  it("counts a fallback, an omitted body and a body with no usage as zero-token calls", () => {
    const s = summarizeTurns([turn({ role: "fallback", error: "timeout" }), turn({ response: { status: 200 }, omitted: { reason: "too large", bytes: 9 } }), turn({ response: { status: 200, body: "<html>" } })], PRICES);
    expect(s.total).toMatchObject({ calls: 3, inputTokens: 0, outputTokens: 0, ms: 0, usd: 0, failed: 1 });
  });
});
