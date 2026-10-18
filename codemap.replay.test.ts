// @vitest-environment node
// FR-38 (spec Revision 12): the sample app's code map, built by `fit codemap` from a committed copy of the app.
// Named *.replay.test.ts on purpose: it pins the app's exact closure and JobsTable's keys, which a legitimate live edit
// may change, so the app's testCommand (and so liveEdit.checkCommand) must exclude it, as it excludes every *replay.test.ts.
import { spawnSync } from "node:child_process";
import { cp, mkdir, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { componentsFor, parseCodeMap, screensFor, type CodeMap } from "@fitting-room/core";
import { run } from "@fitting-room/cli";
import { tempDirs } from "@fitting-room/agent/testing";

const APP = fileURLToPath(new URL(".", import.meta.url));
const TABLE = "src/features/jobs/JobsTable.tsx";
const tmp = tempDirs();
let scratch = "";
let out = "";
let err = "";
let map: CodeMap;

async function codemap(): Promise<{ code: number; out: string; err: string }> {
  let o = "";
  let e = "";
  const code = await run(["codemap"], { cwd: scratch, env: { PATH: process.env.PATH ?? "", HOME: scratch }, stdout: { write: (c: string) => (o += c) }, stderr: { write: (c: string) => (e += c) } });
  return { code, out: o, err: e };
}

beforeAll(async () => {
  scratch = await tmp.make("fit-sample-codemap-");
  for (const f of ["index.html", "tsconfig.json", "package.json", ".fitting-room/config.json"]) {
    await mkdir(dirname(join(scratch, f)), { recursive: true });
    await cp(join(APP, f), join(scratch, f));
  }
  await cp(join(APP, "src"), join(scratch, "src"), { recursive: true });
  const env = { PATH: process.env.PATH ?? "", HOME: scratch, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...a: string[]) => spawnSync("git", ["-c", "user.name=Setup", "-c", "user.email=setup@localhost", "-c", "commit.gpgsign=false", ...a], { cwd: scratch, env, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "SYN sample app copy");
  await mkdir(join(scratch, "node_modules"));
  await symlink(dirname(createRequire(join(APP, "package.json")).resolve("typescript/package.json")), join(scratch, "node_modules", "typescript"), "dir");
  const r = await codemap();
  expect(r.code, r.err).toBe(0);
  out = r.out;
  err = r.err;
  map = parseCodeMap(JSON.parse(out))!;
}, 60_000);
afterAll(() => tmp.cleanup());

describe("the sample app's code map (FR-38 acceptance)", () => {
  it("maps its one screen through index.html's entry, closure in breadth-first order, tests left out", () => {
    expect(map.complete).toBe(true);
    expect(map.screens["/"]).toEqual({
      via: "entry", confidence: 0.5,
      files: ["src/main.tsx", "src/App.tsx", "src/api/client.ts", "src/features/jobs/ConfigProvider.tsx", TABLE, "src/features/jobs/JobDetail.tsx", "src/api/configSource.ts"],
    });
    expect(err).toContain("/: entry, confidence 0.5, 7 files");
  });

  it("componentsFor(\"/\") names JobsTable in its file", () => {
    expect(componentsFor(map, "/")).toContainEqual({ file: TABLE, component: "JobsTable", confidence: 0.5 });
  });

  it("componentsFor(\"columnOrder\") names JobsTable, and JobsTable reads the keys the brief example shows", () => {
    expect(componentsFor(map, "columnOrder")).toContainEqual({ file: TABLE, component: "JobsTable", confidence: 0.7 });
    expect(map.entries.find((e) => e.file === TABLE && e.component === "JobsTable")!.configKeys).toEqual(["columnOrder", "density", "hiddenByDefault", "labels"]);
  });

  it("screensFor(JobsTable's file) is the one screen", () => {
    expect(screensFor(map, TABLE)).toEqual(["/"]);
  });

  it("gives the same bytes on a second run", async () => {
    expect((await codemap()).out).toBe(out);
  });
});
