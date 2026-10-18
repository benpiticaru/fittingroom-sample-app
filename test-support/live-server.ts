import { cp, readFile, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { DelegateScript, LiveCall } from "@fitting-room/agent/testing";
import type { Fitting } from "@fitting-room/core";
import { withFakeGh } from "./gh-exec.js";
import { FITTING_ID, SAMPLE_TEST_ARGV, SKIP, TOKEN } from "./server.js";

const APP = fileURLToPath(new URL("..", import.meta.url));
const HOST_REL = "examples/sample-app";
const DEV_PORT = 5199;

/**
 * The code pin's utterance in the recorded script: the owner's verbatim phrase, a rule `sort` pin that needs code since
 * FR-126, so live edit can change it.
 */
export const CODE_PIN_UTTERANCE = "add interactive sort functionality to each column";

export interface BetaLiveOptions {
  agent: "git" | "claude";
  /** The model side for `claude` (`ServeDeps.modelFetch`); never `ServeDeps.fetch`. */
  transport?: (url: string, init: RequestInit) => Promise<Response>;
  /** The scripted coding agent, given the brief on stdin. */
  script: (input: string) => DelegateScript;
  /** The check (the host's tests) a live edit and the attempt run; default: exit 0. A failing one is a `check-failed` verdict. */
  check?: DelegateScript;
  publish?: { tracker: "github"; repo: string };
}

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface BetaLive {
  call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }>;
  hostDir: string;
  worktree: string;
  branch: string;
  calls: LiveCall[];
  logs: string[];
  sessionOnDisk(id: string): Promise<Fitting>;
  /** Poll `GET .../live` until idle with `last.pinId === pinId`. */
  waitIdle(id: string, pinId: string): Promise<Json>;
  /** Every commit message on the fitting branch since main, oldest first. */
  messages(): Promise<string[]>;
  /** The branch's commit shas since main, oldest first. */
  shas(): Promise<string[]>;
  /** Text of `paths` (repo-relative) as `sha` holds them. */
  filesAt(sha: string, paths: string[]): Promise<Record<string, string>>;
  changedPaths(sha: string): Promise<string[]>;
  remoteTip(): Promise<string>;
  /** Point the temp repo's origin at `url`, through the harness's own git env (never the ambient GIT_DIR). */
  setOrigin(url: string): Promise<void>;
  close(): Promise<void>;
}

/** The scripted coding agent the replays share: the sort pin's brief gets the sort edit, every other brief changes nothing. */
export async function sortOnly(): Promise<(input: string) => DelegateScript> {
  const { SORT, noEdit } = await import("../replay/live-kit.js");
  return (input) => (input.includes(CODE_PIN_UTTERANCE) ? SORT : noEdit);
}

/**
 * `fit serve`'s kernel in process with live edit on, over a system-git copy of the sample app and a local bare remote.
 * No `agentFactory`: the default factory builds the agent, so its `liveEdit` runs the production way. Workspace-only
 * modules load dynamically so importing this file in the standalone export cannot throw.
 */
export async function startBetaLive(o: BetaLiveOptions): Promise<BetaLive> {
  const { LocalLiveRuntime, nodeRunner, parseFittingroomConfig } = await import("@fitting-room/agent");
  const { createFakeSpawnLong, createLiveRepo, createLiveRunner, disableAutoMaintenance, tempDirs } = await import("@fitting-room/agent/testing");
  const { createServer } = await import("@fitting-room/cli/serve");
  const temp = tempDirs();
  const stage = await realpath(await temp.make("fit-beta-live-"));
  let made: Awaited<ReturnType<typeof createLiveRepo>> | undefined;
  const remote = join(stage, "remote.git");
  const git = async (cwd: string, ...args: string[]): Promise<string> => {
    const r = await nodeRunner("git", args, { cwd, env: made!.env });
    if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout;
  };
  try {
    await cp(APP, join(stage, HOST_REL), { recursive: true, filter: (src) => !SKIP.test(relative(APP, src)) });
    made = await createLiveRepo(stage, HOST_REL, { gitignore: ["node_modules/", "dist-muslin/", "**/.fitting-room/sessions/*.local.json"] });
    await git(stage, "init", "-q", "--bare", remote);
    await disableAutoMaintenance(remote, made.env);
    await git(made.repoRoot, "remote", "add", "origin", remote);
    await git(made.repoRoot, "push", "-q", "-u", "origin", "main");
  } catch (e) {
    // Setup failed before the caller holds a close(): remove both temp dirs here.
    await temp.cleanup();
    await made?.cleanup();
    throw e;
  }
  const repo = made;

  const env: Record<string, string> = { ...repo.env, USER: "syn-facilitator", LOGNAME: "syn-facilitator", GH_TOKEN: "syn-not-passed", ...(o.agent === "claude" ? { ANTHROPIC_API_KEY: "syn-key-do-not-echo-0017" } : {}) };
  const cfg = parseFittingroomConfig(JSON.parse(await readFile(join(repo.hostDir, ".fitting-room/config.json"), "utf8"))).liveEdit;
  const logs: string[] = [];
  const live = createLiveRunner({ delegate: (x) => o.script(x.input)(x), check: { argv: SAMPLE_TEST_ARGV, run: o.check ?? (async () => ({ code: 0, stdout: "SYN check passed" })) } });
  const long = createFakeSpawnLong((p) => p.emit("SYN dev server ready"));
  const liveDeps = {
    availability: { available: true as const, version: "2.1.296" },
    promote: { ok: true as const },
    makeRuntime: (r: { worktreeRoot: string; hostDir: string; repoRoot: string }) => new LocalLiveRuntime({
      worktreeRoot: r.worktreeRoot, hostDir: r.hostDir, repoRoot: r.repoRoot, config: cfg, env, runner: live.runner,
      spawnLong: long.spawnLong, probe: async () => 200, freePort: async () => DEV_PORT, log: (l: string) => logs.push(l), pollMs: 5,
    }),
  };
  const exec = o.publish ? withFakeGh(live.runner, o.publish.repo) : live.runner;
  const server = createServer({
    cwd: repo.hostDir, exec, env, token: TOKEN, staticDir: join(repo.hostDir, "dist-muslin"), agentName: o.agent, port: 4400, base: "main",
    ...(o.publish ? { publish: o.publish.tracker, publishRepo: o.publish.repo } : {}),
    ...(o.transport ? { modelFetch: o.transport } : {}),
    newId: () => FITTING_ID, now: () => new Date(Date.UTC(2026, 0, 2)), err: (l: string) => logs.push(l), live: liveDeps,
  });
  const branch = `fitting/${FITTING_ID}`;
  const worktree = join(repo.repoRoot, ".worktrees", `fitting-${FITTING_ID}`);
  const call: BetaLive["call"] = async (method, path, body) => {
    const headers: Record<string, string> = { host: "127.0.0.1:4400", "x-fittingroom-token": TOKEN };
    if (method !== "GET") headers["content-type"] = "application/json";
    const res = await server.handle({ method, url: path, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = typeof res.body === "string" ? res.body : Buffer.from(res.body).toString("utf8");
    let json: Json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, json };
  };
  return {
    call, hostDir: repo.hostDir, worktree, branch, calls: live.calls, logs,
    sessionOnDisk: async (id) => JSON.parse(await readFile(join(repo.hostDir, ".fitting-room", "sessions", `${id}.json`), "utf8")) as Fitting,
    async waitIdle(id, pinId) {
      for (let i = 0; i < 2400; i++) {
        const b = (await call("GET", `/api/fittings/${id}/live`)).json;
        if (b?.state === "idle" && b.last?.pinId === pinId) return b;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`live state never went idle for ${pinId}`);
    },
    messages: async () => (await git(worktree, "log", "--reverse", "--format=%B%x00", `main..${branch}`)).split("\0").map((m) => m.trim()).filter((m) => m !== ""),
    shas: async () => (await git(worktree, "rev-list", "--reverse", `main..${branch}`)).split("\n").filter((l) => l !== ""),
    async filesAt(sha, paths) {
      return Object.fromEntries(await Promise.all(paths.map(async (p) => [p, await git(worktree, "show", `${sha}:${p}`)] as const)));
    },
    changedPaths: async (sha) => (await git(worktree, "show", "--name-only", "--format=", sha)).split("\n").filter((l) => l !== "").sort(),
    remoteTip: async () => (await git(remote, "rev-parse", branch)).trim(),
    async setOrigin(url) { await git(repo.hostDir, "remote", "set-url", "origin", url); },
    async close() {
      // A test that throws early (a divergence) can leave a background live edit committing; let it
      // settle before the repo goes, or rm races git (ENOTEMPTY on .git/objects). Capped at 60 s, well
      // below the 120 s hookTimeout, so teardown still runs when a live edit is stuck.
      for (let i = 0; i < 2400; i++) {
        const r = await call("GET", `/api/fittings/${FITTING_ID}/live`);
        if (r.status !== 200 || r.json?.state === "idle" || r.json?.state === undefined) break;
        await new Promise((res) => setTimeout(res, 25));
      }
      await server.live.close();
      await temp.cleanup();
      await repo.cleanup();
    },
  };
}
