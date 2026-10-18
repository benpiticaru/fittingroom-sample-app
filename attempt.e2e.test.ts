// @vitest-environment node
import { cp, readFile, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createGitAgent } from "@fitting-room/agent";
import { createFakeRunner, tempDirs } from "@fitting-room/agent/testing";
import type { Fitting } from "@fitting-room/core";

const APP = fileURLToPath(new URL(".", import.meta.url));
const SKIP = /^(node_modules|dist|dist-muslin|\.git|vendor|\.worktrees|\.fitting-room[\\/](sessions|baselines))([\\/]|$)/;
const temp = tempDirs();
afterAll(() => temp.cleanup());

describe("attempt on the sample app", () => {
  it("attempts the FR-8 example session through the sample app's real config", async () => {
    const fitting = JSON.parse(await readFile(join(APP, ".fitting-room/sessions/example-fitting.json"), "utf8")) as Fitting;
    const tmpRoot = await realpath(await temp.make("fit-e2e-"));
    const host = join(tmpRoot, "examples/sample-app");
    await cp(APP, host, { recursive: true, filter: (src) => !SKIP.test(relative(APP, src)) });
    const fake = await createFakeRunner(tmpRoot, {
      test: { code: 0, argv: ["npx", "vitest", "run", "--project", "sample-app", "--exclude", "**/*replay.test.ts", "--exclude", "**/*.live.test.ts"] },
    });
    const agent = createGitAgent({ runner: fake.runner, hooksDir: "/hooks-fr12", env: { PATH: "/bin" } });
    const r = await agent.attempt({ fitting, repoPath: host, baseBranch: "main" });
    expect(r).toMatchObject({ outcome: "stopped", blockedOn: { name: "warrantyStatus" }, blockedPinIds: ["pin-3", "pin-2"], appliedPinIds: ["pin-1"] });
    const testCall = fake.calls.find((c) => c.cmd === "npx")!;
    expect(testCall.args).toEqual(["vitest", "run", "--project", "sample-app", "--exclude", "**/*replay.test.ts", "--exclude", "**/*.live.test.ts"]);
    expect(testCall.cwd).toBe(join(tmpRoot, ".worktrees/fitting-fit-019a0c3e5f2a0b7c"));
    const adds = fake.calls.filter((c) => c.args.includes("add") && c.args.includes("--"));
    expect(adds.length).toBeGreaterThan(0);
    for (const c of adds) {
      expect(c.args.slice(-2)).toEqual([":(literal)examples/sample-app/src/features/jobs/tableConfig.json", ":(literal)examples/sample-app/src/features/jobs/tableConfig.muslin.json"]);
    }
  });
});
