// @vitest-environment node
// FR-145 (spec Revision 11, GD6): the evidence of the recorded generated-data run is synthetic, scrubbed and
// internally consistent; the committed generated bundles are the ones the owner approved; the hand-written
// dispatcher bundle is untouched. The walkthrough (docs/generated-data-fitting.md) publishes these numbers.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { approvalLine, dataCoverage, type DataBundle } from "@fitting-room/core";
import { assertGeneratedSafe, assertNoObviousIdentifiers, assertPersonaBundle, type EntityGraph, type PersonaBundle } from "@fitting-room/fixtures";
import { describe, expect, it } from "vitest";
import { PRICES } from "./test-support/measure-turns.mjs";

const APP = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string): Buffer => readFileSync(join(APP, rel));
const text = read("replay/generated-run.json").toString("utf8");
// Generic service accounts (CI runners, containers) would match ordinary words; the run is recorded on the facilitator's own account.
const GENERIC_ACCOUNTS = new Set(["runner", "root", "node", "user", "ubuntu"]);

interface Usage { calls: number; failed: number; inputTokens: number; outputTokens: number; ms: number; usd: number }
interface Run { run: number; fittingId: string; request: string; callsByRole: Record<string, number>; byRole: Record<string, Usage>; apiCalls: number; inputTokens: number; outputTokens: number; ms: number; usd: number; liveEditSeconds: number; status: string; reason: string; failingTests: string }
interface Evidence {
  environment: { model: string; claudeCode: string; cpus: number };
  prices: { model: string; inUsdPerMTok: number; outUsdPerMTok: number; source: string };
  generation: { seed: number; rows: number; byLabel: Record<string, Usage>; total: Usage; wallClockSeconds: number; load1: number; load1End: number; approvedDigest: string };
  review: { minutes: number; decision: string; notes: string };
  planner: { summary: Usage; approval: string; approvedDigest: string };
  dataStepRuns: Run[];
  totals: { generation: Usage; planner: Usage; dataStepRuns: { apiCalls: number; inputTokens: number; outputTokens: number; usd: number }; afterGeneration: { apiCalls: number; inputTokens: number; outputTokens: number; usd: number }; all: { apiCalls: number; inputTokens: number; outputTokens: number; usd: number } };
  earlierRuns: string[];
  mergeBack: { simulated: boolean; how: string; refusal: string; refusalExit: number; digestBefore: string; digestAfter: string; reapprove: string; startAfter: string; startAfterExit: number };
  deferred: { ticket: string; blockedBy: string; items: string[] };
}
const run = JSON.parse(text) as Evidence;
const usd = (i: number, o: number): number => Math.round(((i * run.prices.inUsdPerMTok + o * run.prices.outUsdPerMTok) / 1e6) * 1e6) / 1e6;

/** The approval digest as `fit fixtures approve` computes it (bundleDigest in the cli package): name, NUL, bytes, NUL per `*.json`, in name order. */
function digestOf(role: string): string {
  const dir = join("src/fixtures/personas", role);
  const h = createHash("sha256");
  for (const name of ["jobs.json", "user.json"]) h.update(name).update("\0").update(read(join(dir, name))).update("\0");
  return `sha256:${h.digest("hex")}`;
}
const bundleOf = (role: string): PersonaBundle => ({
  name: role,
  user: JSON.parse(read(`src/fixtures/personas/${role}/user.json`).toString("utf8")),
  data: { jobs: JSON.parse(read(`src/fixtures/personas/${role}/jobs.json`).toString("utf8")) },
});
const graph = JSON.parse(read(".fitting-room/data/entities.json").toString("utf8")) as EntityGraph;
const generation = JSON.parse(read(".fitting-room/data/generation.json").toString("utf8")) as { approvals: Record<string, { digest: string }> };

describe("the recorded generated-data run (FR-145)", () => {
  it("holds no obvious identifier and no machine path", () => {
    expect(() => assertNoObviousIdentifiers(run)).not.toThrow();
    expect(text).not.toMatch(/\/Users\/|\/home\/|\/private\/|\/var\/folders\/|\/tmp\/|[A-Za-z]:\\/);
    const review = read(".fitting-room/data/review.md").toString("utf8");
    expect(() => assertNoObviousIdentifiers({ review })).not.toThrow();
    expect(review).not.toMatch(/\/Users\/|\/home\/|\/private\/|\/var\/folders\/|\/tmp\/|[A-Za-z]:\\/);
  });

  it("holds no user name, host name or home directory of the machine running this test", () => {
    const user = userInfo().username;
    if (user && !GENERIC_ACCOUNTS.has(user)) expect(text.toLowerCase(), "user name").not.toContain(user.toLowerCase());
    for (const h of new Set([hostname(), hostname().split(".")[0]!])) {
      if (h.length > 3) expect(text.toLowerCase(), "host name").not.toContain(h.toLowerCase());
    }
    const home = process.env.HOME ?? homedir();
    if (home && home.length > 1) expect(text, "home directory").not.toContain(home);
  });

  it("holds no raw API id", () => {
    expect(text).not.toMatch(/\b(msg|toolu)_/);
  });

  it("states the environment, the price table and the review", () => {
    expect(run.environment).toMatchObject({ model: "claude-sonnet-5-5", claudeCode: "2.1.302", cpus: 14 });
    expect(run.prices).toEqual({ model: PRICES.model, inUsdPerMTok: PRICES.inUsdPerMTok, outUsdPerMTok: PRICES.outUsdPerMTok, source: PRICES.source });
    expect(run.review).toMatchObject({ minutes: 3, decision: "approved", notes: "Looks right. Completed jobs with backordered parts are odd." });
    expect(run.generation).toMatchObject({ seed: 390309489, rows: 25, wallClockSeconds: 14.59 });
    expect(run.planner.approval).toMatch(/no separate timed review/);
  });

  it("recomputes every usd from the stored prices and tokens", () => {
    const all: Usage[] = [...Object.values(run.generation.byLabel), run.generation.total, run.planner.summary, ...run.dataStepRuns.flatMap((r) => Object.values(r.byRole))];
    for (const u of all) expect(u.usd).toBe(usd(u.inputTokens, u.outputTokens));
    for (const r of run.dataStepRuns) expect(r.usd, `run ${r.run}`).toBe(usd(r.inputTokens, r.outputTokens));
    expect(run.generation.total.usd).toBe(usd(run.generation.total.inputTokens, run.generation.total.outputTokens));
  });

  it("sums: totals equal the parts", () => {
    const labels = Object.values(run.generation.byLabel);
    for (const k of ["calls", "inputTokens", "outputTokens", "ms"] as const) expect(run.generation.total[k], k).toBe(labels.reduce((s, u) => s + u[k], 0));
    for (const r of run.dataStepRuns) {
      const roles = Object.values(r.byRole);
      expect(r.apiCalls).toBe(roles.reduce((s, u) => s + u.calls, 0));
      expect(r.apiCalls).toBe(Object.values(r.callsByRole).reduce((s, n) => s + n, 0));
      expect(r.inputTokens).toBe(roles.reduce((s, u) => s + u.inputTokens, 0));
      expect(r.outputTokens).toBe(roles.reduce((s, u) => s + u.outputTokens, 0));
      expect(r.ms).toBe(roles.reduce((s, u) => s + u.ms, 0));
    }
    const t = run.totals;
    const runs = { apiCalls: 0, inputTokens: 0, outputTokens: 0 };
    for (const r of run.dataStepRuns) { runs.apiCalls += r.apiCalls; runs.inputTokens += r.inputTokens; runs.outputTokens += r.outputTokens; }
    expect(t.dataStepRuns).toEqual({ ...runs, usd: usd(runs.inputTokens, runs.outputTokens) });
    const after = { apiCalls: runs.apiCalls + run.planner.summary.calls, inputTokens: runs.inputTokens + run.planner.summary.inputTokens, outputTokens: runs.outputTokens + run.planner.summary.outputTokens };
    expect(t.afterGeneration).toEqual({ ...after, usd: usd(after.inputTokens, after.outputTokens) });
    const everything = { apiCalls: after.apiCalls + run.generation.total.calls, inputTokens: after.inputTokens + run.generation.total.inputTokens, outputTokens: after.outputTokens + run.generation.total.outputTokens };
    expect(t.all).toEqual({ ...everything, usd: usd(everything.inputTokens, everything.outputTokens) });
    expect(t.generation).toEqual(run.generation.total);
    expect(t.planner).toEqual(run.planner.summary);
  });

  it("records three data step runs, each refused by the host's own check", () => {
    expect(run.dataStepRuns.map((r) => r.fittingId)).toEqual(["fit-01a14a4eafe8413e", "fit-01a14a81ec9c7405", "fit-01a14a90132561a1"]);
    for (const r of run.dataStepRuns) {
      expect(r.status, `run ${r.run}`).toBe("not-kept");
      expect(r.reason, `run ${r.run}`).toBe("check-failed");
      expect(r.failingTests.length).toBeGreaterThan(0);
    }
    expect(run.dataStepRuns[2]!.request).not.toBe(run.dataStepRuns[0]!.request);
  });

  it("names the earlier runs without publishing their numbers", () => {
    expect(run.earlierRuns).toHaveLength(2);
    for (const line of run.earlierRuns) expect(line).not.toMatch(/\d[\d,.]*\s*(tokens|s\b|ms|USD|\$)|\$\s*\d/i);
  });

  it("defers what no kept edit could show, to FR-176 behind FR-175", () => {
    expect(run.deferred).toMatchObject({ ticket: "FR-176", blockedBy: "FR-175" });
    expect(run.deferred.items.length).toBeGreaterThan(0);
  });
});

describe("the committed generated bundles (FR-145)", () => {
  it.each(["supervisor", "planner"])("%s passes the persona and generated-data guards", (role) => {
    const bundle = bundleOf(role);
    expect(() => assertPersonaBundle(bundle)).not.toThrow();
    expect(() => assertGeneratedSafe(bundle, { graph })).not.toThrow();
    expect(bundle.user.meta?.source).toBe("generated");
  });

  it("the approval digests in generation.json match the committed bundles and the evidence", () => {
    expect(generation.approvals.supervisor!.digest).toBe(digestOf("supervisor"));
    expect(generation.approvals.planner!.digest).toBe(digestOf("planner"));
    expect(run.generation.approvedDigest).toBe(generation.approvals.supervisor!.digest);
    expect(run.planner.approvedDigest).toBe(generation.approvals.planner!.digest);
    expect(Object.keys(bundleOf("supervisor").data.jobs!.data as object)).toHaveLength(run.generation.rows);
  });

  it("the planner bundle leaves parts[].onBackorder uncovered, the supervisor bundle covers it (why the data step used the planner)", () => {
    const need = ["parts[].onBackorder"];
    const cover = (role: string) => dataCoverage({ name: role, data: bundleOf(role).data } as unknown as DataBundle, ["jobs"], need);
    expect(cover("planner")).toEqual([expect.objectContaining({ path: need[0], covered: false, reason: "never-true" })]);
    expect(cover("supervisor")).toEqual([{ path: need[0], covered: true }]);
  });

  it("the hand-written dispatcher bundle is byte-identical (git blob hashes pinned)", () => {
    const blob = (rel: string): string => {
      const b = read(rel);
      return createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
    };
    expect(blob("src/fixtures/personas/dispatcher/jobs.json")).toBe("0f6cb8a99c640658f47d7b0f33dcfabe23bba4e1");
    expect(blob("src/fixtures/personas/dispatcher/user.json")).toBe("1fe7301fda314a0646dc20c314328b7c5b063a4d");
  });
});

describe("the merge-back and re-approve, shown without a kept edit (FR-145)", () => {
  it("is simulated: the recorded plan was applied by core outside a live edit", () => {
    expect(run.mergeBack.simulated).toBe(true);
    expect(run.mergeBack.how).toMatch(/applyDataPlan outside a live edit/);
  });

  it("the refusal is the exact line core builds, and the fix is approve then a clean Start", () => {
    expect(run.mergeBack.refusal).toBe(approvalLine({ unapproved: [], changed: ["planner"] }));
    expect(run.mergeBack.refusalExit).toBe(1);
    expect(run.mergeBack.digestBefore).toBe(run.planner.approvedDigest);
    expect(run.mergeBack.digestAfter).not.toBe(run.mergeBack.digestBefore);
    expect(run.mergeBack.reapprove).toBe(`approved planner ${run.mergeBack.digestAfter}`);
    expect(run.mergeBack.startAfter).toMatch(/^Started fit-[0-9a-f]+ /);
    expect(run.mergeBack.startAfterExit).toBe(0);
  });
});
