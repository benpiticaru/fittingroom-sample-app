// @vitest-environment node
//
// FR-10: the muslin build output and per-machine session files must be
// invisible to git and ESLint, while committed examples stay tracked.
//
// FR-23: this test also runs in the standalone export, where the app dir IS the
// repo root (marked by .fitting-room-export), the .gitignore is the generated
// one, and the dest may not be a git repo yet. So git check-ignore runs against
// a throwaway git dir with the real tree as its work tree: only the committed
// .gitignore files decide, never .git/info/exclude or a global excludesFile.
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { disableAutoMaintenanceSync, tempDirs } from "@fitting-room/agent/testing";
import type { UserConfigFnObject } from "vite";
import { MUSLIN_DEFAULT_OUT } from "@fitting-room/cli";
import viteConfig from "./vite.config";

const appDir = fileURLToPath(new URL(".", import.meta.url));
const standalone = existsSync(join(appDir, ".fitting-room-export"));
const repoRoot = standalone ? appDir : fileURLToPath(new URL("../../", import.meta.url));
/** The app's path inside its repo: empty in the standalone export. */
const APP = standalone ? "" : "examples/sample-app/";
const S = `${APP}.fitting-room/sessions`;

const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const temp = tempDirs();
const scratch = temp.makeSync("fittingroom-ignores-");
afterAll(() => temp.cleanupSync());
spawnSync("git", ["init", "-q", scratch], { env: cleanEnv(), encoding: "utf8" });
disableAutoMaintenanceSync(scratch, cleanEnv());

/** git check-ignore --no-index: 0 = ignored, 1 = not ignored, anything else is a failure. */
function ignored(rel: string): boolean {
  const r = spawnSync(
    "git",
    ["-c", "core.excludesFile=", `--git-dir=${join(scratch, ".git")}`, `--work-tree=${repoRoot}`, "check-ignore", "--no-index", "-q", rel],
    { cwd: repoRoot, env: cleanEnv(), encoding: "utf8" },
  );
  if (r.status !== 0 && r.status !== 1) throw new Error(`git check-ignore failed for ${rel}: ${r.stderr}`);
  return r.status === 0;
}

describe("git ignore rules", () => {
  it.each([
    `${S}/x.json`,
    `${S}/fit-abc123.json`,
    `${S}/example-x.local.json`,
    `${S}/abc123/turns/1.json`,
    "some/host/.fitting-room/sessions/x.json",
    `${APP}.fitting-room/baselines/x.json`,
    ".fitting-room/baselines/x.json",
    `${APP}dist-muslin/index.html`,
    `${APP}dist-muslin/assets/index-abc.js`,
  ])("ignores %s", (p) => expect(ignored(p)).toBe(true));

  it.each([
    `${S}/example-beta.json`,
    `${S}/example-fitting.json`,
    `${APP}src/features/jobs/tableConfig.json`,
  ])("tracks %s", (p) => expect(ignored(p)).toBe(false));
});

// The standalone export carries no ESLint config or dependency (it has no lint
// step), so there is nothing to assert there; the monorepo's eslint.config.js
// is what keeps dist-muslin/ out of `npm run precheck`.
describe.skipIf(standalone)("ESLint ignores", () => {
  it("ignores dist-muslin output but not source", async () => {
    const { ESLint } = await import("eslint");
    const eslint = new ESLint({ cwd: repoRoot });
    expect(await eslint.isPathIgnored(join(repoRoot, "examples/sample-app/dist-muslin/assets/index-abc.js"))).toBe(true);
    expect(await eslint.isPathIgnored(join(repoRoot, "examples/sample-app/src/main.tsx"))).toBe(false);
  }, 30_000);
});

describe("muslin output directory", () => {
  it("is the cli's default, dist-muslin, which the ignore rules above cover", () => {
    expect(MUSLIN_DEFAULT_OUT).toBe("dist-muslin");
  });

  it.each(["build", "serve"] as const)("the vite config (%s) sets no outDir, so neither build overrides the cli's default or Vite's dist", (command) => {
    const cfg = (viteConfig as UserConfigFnObject)({ command, mode: "production" });
    expect(cfg.build?.outDir).toBeUndefined();
  });
});
