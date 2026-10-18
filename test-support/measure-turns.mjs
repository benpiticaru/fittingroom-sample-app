// FR-145 (R11 GD6): sums model turn files into calls, failures, tokens, wall clock and cost, by label (the record's `pin`) and by role.
// CLI: node measure-turns.mjs <turnsDir> [<inUsdPerMTok> <outUsdPerMTok>]  prints JSON (prices default to PRICES). Plain Node, no workspace imports.
// Importing this module runs nothing; only running it as a script does.
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** The price table the published run is costed with (owner, 2026-10-17): the model the sample app runs, US$ per million tokens. */
export const PRICES = { model: "claude-sonnet-5-5", inUsdPerMTok: 2, outUsdPerMTok: 10, source: "owner, 2026-10-17" };

const zero = () => ({ calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, ms: 0, usd: 0 });

/**
 * @param records turn records (`fitting-room/turn@1`)
 * @param prices { inUsdPerMTok, outUsdPerMTok }
 * A turn with no `response.body.usage` (fallback, error, omitted body) counts as a call with zero tokens; `failed` counts
 * turns with an `error` or a status other than 200. `ms` is absent on a fallback turn and counts as 0. `usd` is tokens x price, exactly.
 */
export function summarizeTurns(records, prices) {
  const byLabel = {}, byRole = {}, total = zero();
  const add = (bucket, r) => {
    const u = r.response?.body?.usage;
    const inT = Number.isFinite(u?.input_tokens) ? u.input_tokens : 0;
    const outT = Number.isFinite(u?.output_tokens) ? u.output_tokens : 0;
    bucket.calls += 1;
    if (r.error !== undefined || (r.response !== undefined && r.response.status !== 200)) bucket.failed += 1;
    bucket.inputTokens += inT;
    bucket.outputTokens += outT;
    bucket.ms += Number.isFinite(r.ms) ? r.ms : 0;
    bucket.usd = (bucket.inputTokens * prices.inUsdPerMTok + bucket.outputTokens * prices.outUsdPerMTok) / 1e6;
  };
  for (const r of records) {
    add((byLabel[r.pin] ??= zero()), r);
    add((byRole[r.role] ??= zero()), r);
    add(total, r);
  }
  return { byLabel, byRole, total };
}

async function main([dir, inP = PRICES.inUsdPerMTok, outP = PRICES.outUsdPerMTok]) {
  if (!dir || !Number.isFinite(Number(inP)) || !Number.isFinite(Number(outP))) { console.error("usage: node measure-turns.mjs <turnsDir> [<inUsdPerMTok> <outUsdPerMTok>]"); return 2; }
  const names = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const records = await Promise.all(names.map(async (f) => JSON.parse(await readFile(`${dir}/${f}`, "utf8"))));
  console.log(JSON.stringify(summarizeTurns(records, { inUsdPerMTok: Number(inP), outUsdPerMTok: Number(outP) }), null, 2));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
