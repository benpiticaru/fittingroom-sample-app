// @vitest-environment node
// FR-36 Task 6: the sample-app fitting through `fit serve --proxy`. The muslin is built once, hashed into a manifest at a temp repo's HEAD,
// served by a loopback static "image", and the real CLI proxies it. Loopback only; no container engine, no model, no key.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer, get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const appDir = fileURLToPath(new URL(".", import.meta.url));
const standalone = existsSync(join(appDir, ".fitting-room-export")); // FR-23 export has no packages/
const MANIFEST = "/__fittingroom/manifest.json";
const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

async function list(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await list(root, abs)));
    else out.push("/" + relative(root, abs).split(sep).join("/"));
  }
  return out;
}

const request = (url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> =>
  new Promise((resolve, reject) => {
    get(url, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });

describe.skipIf(standalone)("the sample-app fitting through fit serve --proxy", () => {
  const closers: Array<() => Promise<void> | void> = [];
  afterAll(async () => {
    for (const c of closers.reverse()) await c();
  });

  it("serves the image's files and records a fitting that stays on its branch", async () => {
    const { tempDirs, removeTempDir } = await import("@fitting-room/agent/testing");
    const { run } = await import("@fitting-room/cli");
    const { SKIP } = await import("./test-support/server");
    const { SCRIPT } = await import("./test-support/drive-beta.mjs");
    const errs: string[] = [];
    const temps = tempDirs();
    const root = await temps.make("fit-proxy-flow-");
    closers.push(() => removeTempDir(root));

    // The host checkout: a copy of the sample app, one commit, an isolated git environment (no GIT_*).
    const repo = join(root, "repo");
    await cp(appDir, repo, { recursive: true, filter: (src) => !SKIP.test(relative(appDir, src)) });
    const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: root, XDG_CONFIG_HOME: root, LC_ALL: "C" };
    const git = (...a: string[]): string => {
      const r = spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@localhost", "-c", "commit.gpgsign=false", ...a], { cwd: repo, env, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    await writeFile(join(repo, ".gitignore"), `${await readFile(join(repo, ".gitignore"), "utf8")}.worktrees/\n`);
    git("init", "-q", "-b", "main");
    git("add", ".");
    git("commit", "-qm", "base");
    const rev = git("rev-parse", "HEAD");

    // The image: the sample app's muslin build, its manifest at that commit, served from memory.
    const out = join(root, "muslin");
    const built = await run(["muslin", "build", "--manifest", "--revision", rev, "--out", out], { cwd: appDir, env, stdout: { write: () => undefined }, stderr: { write: (c: string) => void errs.push(c) } });
    if (built !== 0) throw new Error(`fit muslin build --manifest failed: ${errs.join("")}`);
    const files = (await list(out)).filter((p) => p !== MANIFEST).sort();
    const bodies = new Map<string, Buffer>();
    for (const p of files) bodies.set(p, await readFile(join(out, p)));
    const manifest = await readFile(join(out, MANIFEST));
    const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
    const image: Server = createServer((req, res) => {
      const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
      const body = path === MANIFEST ? manifest : bodies.get(path);
      if (!body) return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": path === MANIFEST ? "application/json" : (types[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream") });
      res.end(body);
    });
    await new Promise<void>((r) => image.listen(0, "127.0.0.1", r));
    closers.push(() => new Promise<void>((r) => { image.closeAllConnections(); image.close(() => r()); }));
    const imagePort = (image.address() as AddressInfo).port;

    // fit serve --proxy, in process, on a free loopback port.
    const lines: string[] = [];
    const before = new Set(process.listeners("SIGINT"));
    const done = run(["serve", "--proxy", `http://127.0.0.1:${imagePort}`, "--port", "0", "--agent", "git"], {
      cwd: repo,
      env,
      stdout: { write: (c: string) => void lines.push(...c.split("\n").filter(Boolean)) },
      stderr: { write: (c: string) => void errs.push(c) },
    });
    let url: string | undefined;
    for (let i = 0; i < 400 && !url; i++) {
      url = /^Fitting Room: (http:\/\/\S+)/.exec(lines.find((l) => l.startsWith("Fitting Room: ")) ?? "")?.[1];
      if (!url) await new Promise((r) => setTimeout(r, 25));
    }
    if (!url) throw new Error(`fit serve --proxy did not start: ${errs.join("")}`);
    try {
      expect(lines.find((l) => l.startsWith("Fitting Room proxy:"))).toContain(`revision ${rev} (from the manifest), base main`);

      const nav = await request(`${url}/`, { "sec-fetch-mode": "navigate" });
      expect(nav.status).toBe(200);
      const html = nav.body.toString("utf8");
      const token = /name="fittingroom-token" content="([0-9a-f]{64})"/.exec(html)?.[1];
      expect(token).toBeDefined();
      expect(String(nav.headers["content-security-policy"])).toContain("frame-ancestors 'self'; connect-src 'self' blob:");

      for (const p of files) {
        const r = await request(url + encodeURI(p));
        expect(r.status, p).toBe(200);
        if (p === "/index.html") expect(r.body.toString("utf8")).toContain('name="fittingroom-token"');
        else expect(sha(r.body), p).toBe(sha(bodies.get(p)!));
      }

      const call = async (method: string, path: string, body?: unknown) => {
        const r = await fetch(url + path, { method, headers: { "x-fittingroom-token": token!, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        return { status: r.status, json: (await r.json()) as any, headers: r.headers }; // eslint-disable-line @typescript-eslint/no-explicit-any
      };
      expect((await call("GET", "/api/meta")).json.build.sha).toBe(rev);

      const start = await call("POST", "/api/fittings", { role: "dispatcher", screen: "jobs", fixtures: [] });
      expect(start.status).toBe(200);
      expect(start.headers.get("clear-site-data")).toBe('"storage"');
      const id = start.json.fitting.id as string;
      for (const s of SCRIPT) expect((await call("POST", `/api/fittings/${id}/utterances`, { text: s.text, route: "/" })).status, s.text).toBe(200);

      const submit = await call("POST", `/api/fittings/${id}/submit`, {});
      expect(submit.status).toBe(200);
      expect(submit.json).toMatchObject({ pushed: false, reason: "no remote" });

      const session = JSON.parse(await readFile(join(repo, ".fitting-room", "sessions", `${id}.json`), "utf8")) as { transcript: Array<{ who: string; text: string }> };
      const said = session.transcript.filter((t) => t.who === "stakeholder").map((t) => t.text);
      for (const s of SCRIPT) expect(said).toContain(s.text);
    } finally {
      // Call fit serve's own SIGINT listener directly: emitting the signal would also run signal-exit's listeners (Vitest's), which may kill the worker.
      const mine = process.listeners("SIGINT").filter((l) => !before.has(l));
      expect(mine.length).toBeGreaterThan(0);
      for (const l of mine) (l as () => void)();
      await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error("fit serve did not close within 15s")), 15_000))]);
    }
  });
});
