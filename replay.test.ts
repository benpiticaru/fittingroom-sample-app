// @vitest-environment node
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { run, type Exec } from "@fitting-room/cli";
import { draftAlterations, renderMarkdown, type Fitting } from "@fitting-room/core";
import { repoFile } from "./repo-file";
import { parseWalkthrough, tokenize, type Step } from "./replay/walkthrough";

const APP = fileURLToPath(new URL(".", import.meta.url));
const DOC = repoFile("docs/first-fitting.md");
const COMMITTED = join(APP, ".fitting-room/sessions/example-fitting.json");
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

/** Strip what legitimately differs between runs: the fitting id (incl. attempt.branch), timestamps, build id. */
function normalize(f: Fitting): unknown {
  const s = JSON.stringify(f).split(f.id).join("<fitting-id>").replace(ISO, "<time>");
  return { ...(JSON.parse(s) as Fitting), muslinBuild: "<build>" };
}

const noExec: Exec = async (cmd, args) => {
  throw new Error(`the replay must not run external commands: ${cmd} ${args.join(" ")}`);
};

async function copyApp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fit-replay-"));
  const skip = /^(node_modules|dist|\.fitting-room[\\/](sessions|baselines))([\\/]|$)/;
  await cp(APP, dir, { recursive: true, filter: (src) => !skip.test(relative(APP, src)) });
  return dir;
}

async function replay(steps: Step[], dir: string): Promise<{ session: string; kinds: string[]; submitted: string }> {
  const vars: Record<string, string> = {};
  const kinds: string[] = [];
  let submitted = "";
  for (const step of steps) {
    if (step.kind === "edit") {
      const file = join(dir, step.file);
      const doc = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      await writeFile(file, JSON.stringify({ ...doc, ...step.patch }, null, 2) + "\n");
      kinds.push("edit");
      continue;
    }
    const argv = tokenize(step.line, vars);
    let out = "";
    let err = "";
    const code = await run(argv, { cwd: dir, exec: noExec, stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) } });
    expect(code, `fit ${step.line}\n${err}`).toBe(0);
    if (argv[0] === "fitting") {
      const m = /^Started \S+ → (\S+)$/m.exec(out);
      expect(m, out).not.toBeNull();
      vars.FITTING = m![1]!;
    }
    if (argv[0] === "submit") submitted = out;
    kinds.push(argv[0] === "fitting" ? "start" : argv[0]!);
  }
  if (!vars.FITTING) throw new Error("walkthrough never ran `fit fitting start`");
  return { session: join(dir, vars.FITTING), kinds, submitted };
}

describe("docs/first-fitting.md replay", () => {
  const dirs: string[] = [];
  afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

  it("reproduces the committed example session", async () => {
    const steps = parseWalkthrough(await readFile(DOC, "utf8"));
    const configBefore = await readFile(join(APP, "src/features/jobs/tableConfig.json"), "utf8");
    const dir = await copyApp();
    dirs.push(dir);
    expect(dir.startsWith(tmpdir() + sep)).toBe(true);

    const { session, kinds, submitted } = await replay(steps, dir);

    expect(kinds).toEqual(["start", "edit", "pin", "pin", "pin", "attempt", "submit"]);
    const replayed = JSON.parse(await readFile(session, "utf8")) as Fitting;
    const committed = JSON.parse(await readFile(COMMITTED, "utf8")) as Fitting;
    expect(normalize(replayed)).toEqual(normalize(committed));
    // What the reader sees from `fit submit` is the ticket rendered from that same session.
    expect(submitted).toBe(renderMarkdown(draftAlterations(replayed)) + "\n");
    expect(await readFile(join(APP, "src/features/jobs/tableConfig.json"), "utf8")).toBe(configBefore);
    // The data-gap pin keeps its implied field in the muslin-only overlay of the replayed copy.
    const overlay = JSON.parse(await readFile(join(dir, "src/features/jobs/tableConfig.muslin.json"), "utf8")) as { placeholderColumns: Array<{ name: string }> };
    expect(overlay.placeholderColumns.map((c) => c.name)).toContain(replayed.pins.find((p) => p.kind === "data-gap")!.impliedField!.name);
  });

  it("keeps the real publish out of the replayed blocks", async () => {
    const md = await readFile(DOC, "utf8");
    const fitLines = parseWalkthrough(md).flatMap((s) => (s.kind === "fit" ? [s.line] : []));
    expect(fitLines.some((l) => l.includes("--publish"))).toBe(false);
    expect(md).toMatch(/```sh\n[^`]*fit submit "\$FITTING" --publish github/);
  });
});
