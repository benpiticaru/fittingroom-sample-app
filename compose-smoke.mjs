#!/usr/bin/env node
// Engine-backed smoke for the compose demo (FR-35): node compose-smoke.mjs [docker|podman]. Exit 0 on pass, 1 with one sentence.
// Builds both images, serves on 127.0.0.1:8080, makes one fitting, checks the branch, the revision and the start time.
// It uses its own compose project (fr-smoke, so its own fitting-repo volume, never the demo's) and, when it ends, deletes that
// project and the two :local demo images (the next `up --build` rebuilds them). Base images stay. Not run by `npm test`.
import { spawn, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";

const engine = process.argv[2] ?? "docker";
const cwd = dirname(fileURLToPath(import.meta.url));
const URL_ = "http://127.0.0.1:8080";
const TAGS = ["fittingroom-sample-app-muslin:local", "fittingroom-demo:local"];
const UTTERANCE = "Put the technician right after the status, that's who I look for first.";
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

/** @param {string} msg */
const fail = (msg) => { throw new Error(msg); };
/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {Record<string, string>} [extra]
 */
function run(cmd, args, extra = {}) {
  return spawnSync(cmd, args, { cwd, env: { ...env, ...extra }, encoding: "utf8" });
}

/** @param {string} rev @param {string[]} args */
const compose = (rev, args) => run(engine, ["compose", "-p", "fr-smoke", ...args], { REV: rev });

/** @returns {Promise<string | undefined>} the index.html body once the proxy answers 200 */
async function index() {
  try {
    const r = await fetch(`${URL_}/index.html`, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(2000) });
    return r.status === 200 ? await r.text() : undefined;
  } catch {
    return undefined;
  }
}

/** @param {number} everyMs @param {number} limitMs @returns {Promise<string | undefined>} */
async function waitForIndex(everyMs, limitMs) {
  const t0 = Date.now();
  for (;;) {
    const html = await index();
    if (html !== undefined) return html;
    if (Date.now() - t0 > limitMs) return undefined;
    await sleep(everyMs);
  }
}

/** Compressed size of an image as `save` streams it, in bytes. @param {string} tag */
function compressedSize(tag) {
  return new Promise((resolve, reject) => {
    const p = spawn(engine, ["save", tag], { cwd, env });
    const gz = createGzip();
    let n = 0;
    gz.on("data", (c) => { n += c.length; });
    let code = /** @type {number | null} */ (null);
    let ended = false;
    const done = () => {
      if (!ended || code === null) return;
      if (code === 0) resolve(n);
      else reject(new Error(`${engine} save ${tag} exited ${code}.`));
    };
    gz.on("end", () => { ended = true; done(); });
    p.on("close", (c) => { code = c ?? 1; done(); });
    p.on("error", reject);
    p.stdout.pipe(gz);
  });
}

/** @param {string} token @param {string} method @param {string} path @param {unknown} [body] */
async function api(token, method, path, body) {
  const r = await fetch(URL_ + path, { method, headers: { "x-fittingroom-token": token, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: /** @type {any} */ (await r.json()) };
}

let built = false; // cleanup only after the preflight refusals, so a refused start touches nothing
async function main() {
  if ((await index()) !== undefined) fail("Stop the running demo first: it holds port 8080.");
  const rev = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  if (run("git", ["status", "--porcelain"]).stdout.trim() !== "") fail("Build from a clean checkout: git status shows changes.");
  built = true;
  const t0 = Date.now();
  if (compose(rev, ["build"]).status !== 0) fail("The image build failed: run the compose build by hand to see why.");
  const sizes = await Promise.all(TAGS.map(compressedSize));
  TAGS.forEach((t, i) => console.log(`${t}: ${(sizes[i] / 2 ** 20).toFixed(1)} MiB compressed`));
  if (sizes[1] >= 120 * 2 ** 20) fail("fittingroom-demo:local is 120 MiB or more compressed.");

  if (compose(rev, ["up", "-d"]).status !== 0) fail("compose up failed.");
  const html = await waitForIndex(500, 180_000);
  if (html === undefined) fail("The fitting did not answer on 127.0.0.1:8080 within 180 s.");
  console.log(`build to first 200: ${((Date.now() - t0) / 1000).toFixed(0)} s (warm layer cache makes this optimistic)`);
  const token = /name="fittingroom-token" content="([^"]+)"/.exec(html)?.[1] ?? fail("index.html has no fittingroom-token meta.");
  if ((await api(token, "GET", "/api/meta")).json.build?.sha !== rev) fail("meta.build.sha is not the checkout's HEAD.");

  const start = await api(token, "POST", "/api/fittings", { role: "dispatcher", screen: "jobs", fixtures: [] });
  if (start.status !== 200) fail(`Starting a fitting answered ${start.status}.`);
  const id = start.json.fitting.id;
  if ((await api(token, "POST", `/api/fittings/${id}/utterances`, { text: UTTERANCE, route: "/" })).status !== 200) fail("The utterance was refused.");
  const submit = await api(token, "POST", `/api/fittings/${id}/submit`, {});
  if (submit.status !== 200 || submit.json.pushed !== false || submit.json.reason !== "no remote") fail("Submit did not answer pushed:false, no remote.");

  if (compose(rev, ["exec", "-T", "fittingroom", "sh", "-c", "for c in python python3 go; do command -v $c && exit 1; done; exit 0"]).status !== 0) fail("The Fitting Room image carries Python or Go (or exec failed).");
  const ahead = compose(rev, ["exec", "-T", "fittingroom", "git", "-C", "/repo", "rev-list", "--count", `${rev}..refs/heads/fitting/${id}`]);
  if (ahead.status !== 0 || !(Number(ahead.stdout.trim()) >= 1)) fail(`Branch fitting/${id} has no commit past ${rev.slice(0, 7)} in the volume.`);
  if (!compose(rev, ["logs", "fittingroom"]).stdout.includes(`revision ${rev} (from the manifest)`)) fail("The proxy did not report the checkout's revision from the manifest.");

  if (compose(rev, ["restart", "fittingroom"]).status !== 0) fail("compose restart failed.");
  const t1 = Date.now();
  if ((await waitForIndex(100, 30_000)) === undefined) fail("The fitting did not come back after a restart.");
  const ms = Date.now() - t1;
  console.log(`restart (existing clone) to first 200: ${ms} ms`);
  if (ms > 2000) fail(`Start took ${ms} ms: over 2000 ms.`);
  console.log("compose smoke: PASS");
}

let code = 0;
try {
  await main();
} catch (e) {
  console.error(`compose smoke: FAIL: ${e instanceof Error ? e.message : String(e)}`);
  code = 1;
} finally {
  if (built) {
    compose("", ["down", "-v"]);
    if (run(engine, ["image", "rm", ...TAGS]).status !== 0) console.error("note: a demo image was not removed (another project may hold it).");
  }
}
process.exit(code);
