/**
 * Test support for the live-edit replays (FR-104, spec Revision 10 LE7). This app is copied into a temp system-git repo
 * at examples/sample-app and served in process by `fit serve`'s kernel with live edit on. git is real (createLiveRunner,
 * the FR-100 follow-up); the coding agent and the check are scripts a test sets per step; the dev server is a scripted
 * long process behind the real LocalLiveRuntime, configured from the copied app's own .fitting-room/config.json.
 */
import { cp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { FittingBranch, LocalLiveRuntime, createGitAgent, parseFittingroomConfig } from "@fitting-room/agent";
import { createFakeSpawnLong, createLiveRepo, createLiveRunner, tempDirs, type DelegateScript, type FakeLong, type LiveRepo, type LiveRunner } from "@fitting-room/agent/testing";
import { createServer, type FitServer, type ServeDeps } from "@fitting-room/cli/serve";
import { assertNoObviousIdentifiers } from "@fitting-room/fixtures";

export const APP = fileURLToPath(new URL("..", import.meta.url));
export const HOST_REL = "examples/sample-app";
export const ID = "fit-0a1b2c3d";
export const DEV_PORT = 5199;
export const TABLE = "src/features/jobs/JobsTable.tsx";
export const UTTERANCE = "add sort functionality to each column";
export const STICKY_UTTERANCE = "make the table headers sticky";
export const CHECK_ARGV = ["npx", "vitest", "run", "--project", "sample-app", "--exclude", "**/*replay.test.ts", "--exclude", "**/*.live.test.ts"];
const TOKEN = "synthetic-token-0104";
const SKIP = /^(node_modules|dist|dist-muslin|\.git|vendor|\.worktrees|\.fitting-room[\\/](sessions|baselines))([\\/]|$)/;

export const pass: DelegateScript = async () => ({ code: 0, stdout: "SYN check passed" });
export const noEdit: DelegateScript = async () => ({ code: 0, stdout: "SYN nothing to change" });

/** A scripted agent edit: replace `from` once in a host-relative file of the worktree; throws when the anchor is gone. */
export function edit(from: string, to: string, path = TABLE): DelegateScript {
  return async ({ cwd }) => {
    const abs = join(cwd, HOST_REL, path);
    const text = await readFile(abs, "utf8");
    if (!text.includes(from)) throw new Error(`the scripted edit no longer applies to ${path}`);
    await writeFile(abs, text.replace(from, to));
    return { code: 0, stdout: "SYN edit made" };
  };
}
/** Pin 1's change: a sort hook on every column header. */
export const SORT = edit("data-column-key={c}>", 'data-column-key={c} aria-sort="none">');
/** A later change to the same header line, so reverting SORT underneath it conflicts. */
export const STICKY = edit('scope="col" data-column-key={c}', 'scope="col" className="sticky" data-column-key={c}');

export interface LiveBody { state: string; last?: { pinId: string; status: string; reason?: string } }
export interface Reply { status: number; json: any; text: string } // eslint-disable-line @typescript-eslint/no-explicit-any
export interface LiveApp {
  server: FitServer; repo: LiveRepo; live: LiveRunner; long: FakeLong; logs: string[];
  hostDir: string; worktree: string; baseTable: string;
  /** What the scripted coding agent and check do on their next run. */
  agent: DelegateScript; check: DelegateScript;
  /** Let the scripted dev server answer its readiness probe (only matters with `devGate`). */
  devReady(): void;
  call(method: string, path: string, body?: unknown): Promise<Reply>;
}

const temp = tempDirs();
const cleanups: Array<() => Promise<unknown>> = [];
/** Close every server's live mode, then remove every temp dir (call from `afterAll`). */
export async function cleanupLiveApps(): Promise<void> {
  for (const f of cleanups.splice(0)) await f();
}

export async function liveApp(o: { devGate?: boolean } = {}): Promise<LiveApp> {
  const stage = await realpath(await temp.make("fit-le7-"));
  cleanups.push(() => temp.cleanup());
  await cp(APP, join(stage, HOST_REL), { recursive: true, filter: (src) => !SKIP.test(relative(APP, src)) });
  const repo = await createLiveRepo(stage, HOST_REL, { gitignore: ["node_modules/", "dist-muslin/", "**/.fitting-room/sessions/*.local.json"] });
  cleanups.push(() => repo.cleanup());
  // The facilitator's environment: USER and LOGNAME must reach the coding agent (agentEnv); GH_TOKEN must reach nothing.
  const env = { ...repo.env, USER: "syn-facilitator", LOGNAME: "syn-facilitator", GH_TOKEN: "syn-not-passed" };
  const cfg = parseFittingroomConfig(JSON.parse(await readFile(join(repo.hostDir, ".fitting-room/config.json"), "utf8"))).liveEdit;
  const logs: string[] = [];
  let ready = !o.devGate;
  const app = { agent: noEdit, check: pass, logs } as LiveApp;
  const live = createLiveRunner({ delegate: (x) => app.agent(x), check: { argv: CHECK_ARGV, run: (x) => app.check(x) } });
  const long = createFakeSpawnLong((p) => p.emit("SYN dev server ready"));
  const liveDeps: NonNullable<ServeDeps["live"]> = {
    availability: { available: true, version: "2.1.296" },
    promote: { ok: true },
    makeRuntime: (r) => new LocalLiveRuntime({
      worktreeRoot: r.worktreeRoot, hostDir: r.hostDir, repoRoot: r.repoRoot, config: cfg, env, runner: live.runner,
      spawnLong: long.spawnLong, probe: async () => (ready ? 200 : undefined), freePort: async () => DEV_PORT, log: (l) => logs.push(l), pollMs: 5,
    }),
  };
  const agent = createGitAgent({ runner: live.runner, env, log: (l) => logs.push(l) });
  const server = createServer({
    cwd: repo.hostDir, exec: live.runner, env, token: TOKEN, staticDir: join(repo.hostDir, "dist-muslin"), agentName: "git",
    agentFactory: () => agent, port: 4400, base: "main", newId: () => ID, now: () => new Date(Date.UTC(2026, 0, 2)),
    err: (l) => logs.push(l), live: liveDeps,
  });
  cleanups.unshift(() => server.live.close());
  return Object.assign(app, {
    server, repo, live, long, hostDir: repo.hostDir, worktree: join(repo.repoRoot, ".worktrees", `fitting-${ID}`),
    baseTable: await readFile(join(repo.hostDir, TABLE), "utf8"),
    devReady: () => { ready = true; },
    async call(method: string, path: string, body?: unknown): Promise<Reply> {
      const headers: Record<string, string> = { host: "127.0.0.1:4400", "x-fittingroom-token": TOKEN };
      if (method !== "GET") headers["content-type"] = "application/json";
      const res = await server.handle({ method, url: path, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = typeof res.body === "string" ? res.body : Buffer.from(res.body).toString("utf8");
      let json: unknown;
      try { json = JSON.parse(text); } catch { json = undefined; }
      return { status: res.status, json, text };
    },
  });
}

export async function begin(app: LiveApp): Promise<string> {
  const r = await app.call("POST", "/api/fittings", { role: "dispatcher", screen: "jobs", fixtures: [] });
  if (r.status !== 200) throw new Error(`start failed: ${r.text}`);
  return r.json.fitting.id as string;
}
export const utter = (app: LiveApp, id: string, text: string): Promise<Reply> => app.call("POST", `/api/fittings/${id}/utterances`, { text, route: "/" });

/** Poll `GET .../live` every 25 ms until `want` holds (60 s cap). */
export async function until(app: LiveApp, id: string, want: (b: LiveBody) => boolean): Promise<LiveBody> {
  for (let i = 0; i < 2400; i++) {
    const b = (await app.call("GET", `/api/fittings/${id}/live`)).json as LiveBody;
    if (want(b)) return b;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`live state never matched for ${id}`);
}
export const idle = (app: LiveApp, id: string, pinId: string): Promise<LiveBody> => until(app, id, (b) => b.state === "idle" && b.last?.pinId === pinId);

const fbOf = (app: LiveApp): FittingBranch => new FittingBranch({ runner: app.live.runner, env: app.repo.env });
async function messages(app: LiveApp, n: number): Promise<string[]> {
  const fb = fbOf(app);
  const out: string[] = [];
  let sha: string | undefined = await fb.live.head(app.worktree);
  while (sha && out.length < n) {
    const c = await fb.live.readCommit(app.worktree, sha);
    out.push(c.message);
    sha = c.parents[0];
  }
  return out;
}
export const subjects = async (app: LiveApp, n: number): Promise<string[]> => (await messages(app, n)).map((m) => m.split("\n")[0]!);
export const statusOf = (app: LiveApp): Promise<unknown[]> => fbOf(app).status(app.worktree);
export const tableNow = (app: LiveApp): Promise<string> => readFile(join(app.worktree, HOST_REL, TABLE), "utf8");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const session = async (app: LiveApp, id: string): Promise<any> => JSON.parse(await readFile(join(app.hostDir, ".fitting-room/sessions", `${id}.json`), "utf8"));

/** Constraint A over everything the run recorded: session, turn files, every commit message, every log line. */
export async function assertRecordingsSynthetic(app: LiveApp, id: string): Promise<number> {
  const dir = join(app.hostDir, ".fitting-room/sessions", id, "turns");
  const names = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json"));
  const turns = await Promise.all(names.map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8")) as unknown));
  assertNoObviousIdentifiers({ session: await session(app, id), turns, commits: await messages(app, 200), logs: app.logs });
  return turns.length;
}
