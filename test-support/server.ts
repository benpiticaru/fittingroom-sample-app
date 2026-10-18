import { cp, readFile, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { FakeOptions, FakeRunner } from "@fitting-room/agent/testing";
import type { Fitting } from "@fitting-room/core";
import { withFakeGh } from "./gh-exec.js";

const APP = fileURLToPath(new URL("..", import.meta.url));

/** What a temp host must not carry over: installs, builds, git data, per-machine sessions and baselines. */
export const SKIP = /^(node_modules|dist|dist-muslin|\.git|vendor|\.worktrees|\.fitting-room[\\/](sessions|baselines))([\\/]|$)/;

/** The sample app's own `attempt.testCommand`, tokenized (the fake matches the exact argv). */
export const SAMPLE_TEST_ARGV = ["npx", "vitest", "run", "--project", "sample-app", "--exclude", "**/*replay.test.ts", "--exclude", "**/*.live.test.ts"];

export const FITTING_ID = "fit-0b7e5a17";
export const TOKEN = "synthetic-token-0017";

export interface BetaServerOptions {
  agent: "git";
  /** `fit serve --no-branch`: no fitting branch, so no commit or push. */
  noBranch?: boolean;
  /** `--publish github --publish-repo <repo>`, with a fake `gh` that files issue 1. */
  publish?: { tracker: "github"; repo: string };
  /** Overrides the fake runner's test option (default: exit 0 on the sample testCommand). */
  test?: FakeOptions["test"];
}

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface BetaServer {
  call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }>;
  fake: FakeRunner;
  hostDir: string;
  sessionOnDisk(id: string): Promise<Fitting>;
  close(): Promise<void>;
}

/**
 * An in-process `fit serve` over a temp copy of the sample app, with a fake git/npm/gh runner.
 * The workspace-only modules load dynamically so importing this file in the standalone export cannot throw.
 */
export async function startBeta(o: BetaServerOptions): Promise<BetaServer> {
  const { createFakeRunner, tempDirs } = await import("@fitting-room/agent/testing");
  const { createServer } = await import("@fitting-room/cli");
  const temp = tempDirs();
  const root = await realpath(await temp.make("fit-beta-"));
  const hostDir = join(root, "examples/sample-app");
  await cp(APP, hostDir, { recursive: true, filter: (src) => !SKIP.test(relative(APP, src)) });
  const fake = await createFakeRunner(root, { test: o.test ?? { code: 0, argv: SAMPLE_TEST_ARGV } });
  const exec = o.publish ? withFakeGh(fake.runner, o.publish.repo) : fake.runner;
  let tick = 0;
  const server = createServer({
    cwd: hostDir,
    exec,
    env: { PATH: "/bin" },
    token: TOKEN,
    staticDir: join(hostDir, "static"),
    agentName: o.agent,
    port: 4400,
    ...(o.noBranch ? { noBranch: true } : { base: "main" }),
    ...(o.publish ? { publish: o.publish.tracker, publishRepo: o.publish.repo } : {}),
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)),
    newId: () => FITTING_ID,
    err: () => {},
  });
  return {
    fake,
    hostDir,
    async call(method, path, body) {
      const headers: Record<string, string> = { host: "127.0.0.1:4400", "x-fittingroom-token": TOKEN };
      if (method === "POST" || method === "DELETE") headers["content-type"] = "application/json";
      const res = await server.handle({ method, url: path, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const text = typeof res.body === "string" ? res.body : Buffer.from(res.body).toString("utf8");
      let json: Json;
      try { json = JSON.parse(text); } catch { json = undefined; }
      return { status: res.status, json };
    },
    async sessionOnDisk(id) {
      return JSON.parse(await readFile(join(hostDir, ".fitting-room", "sessions", `${id}.json`), "utf8")) as Fitting;
    },
    close: () => temp.cleanup(),
  };
}
