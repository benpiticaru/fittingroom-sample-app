// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFittingroomConfig } from "@fitting-room/agent";

const APP = fileURLToPath(new URL(".", import.meta.url));
const cfg = JSON.parse(readFileSync(join(APP, ".fitting-room/config.json"), "utf8"));
const SKIP = new Set(["node_modules", "dist", "dist-muslin", ".fitting-room"]);

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    if (glob.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 2;
    } else if (glob[i] === "*") re += "[^/]*";
    else re += glob[i]!.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (SKIP.has(name)) return [];
    if (statSync(full).isDirectory()) return testFiles(full);
    return /\.test\.tsx?$/.test(name) ? [relative(APP, full).split("\\").join("/")] : [];
  });
}

function leafStrings(json: unknown): string[] {
  if (typeof json === "string") return [json];
  if (json && typeof json === "object") return Object.values(json).flatMap(leafStrings);
  return [];
}

function excludeGlobs(testCommand: string): string[] {
  const out: string[] = [];
  const re = /--exclude\s+(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  for (const m of testCommand.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3]!);
  return out;
}

/** True when the source mentions the config surface and quotes one of its literal values. */
function assertsLiteral(src: string, values: string[]): boolean {
  return /tableConfig/.test(src) && values.some((v) => src.includes(`"${v}"`) || src.includes(`'${v}'`));
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alt = (names: string[]): string => names.map(escape).join("|");

/**
 * Semantic, not a substring match: true only when the source reads a committed
 * session AND reads or imports a surface file. A name that only appears in an
 * array, matcher or it.each literal (a path string) does not count.
 */
function comparesSessionWithSurface(src: string, surfaces: string[], sessions: string[]): boolean {
  const call = String.raw`(?:read\w*|URL|join)\([^)]*?`;
  const readsSession = new RegExp(`${call}(["'\`])[^"'\`]*\\.fitting-room/sessions/(?:${alt(sessions)})\\1`).test(src);
  const readsSurface =
    new RegExp(`${call}(["'\`])[^"'\`]*(?:^|/)(?:${alt(surfaces)})\\1`).test(src) ||
    new RegExp(`from\\s+(["'])[^"']*/(?:${alt(surfaces)})\\1`).test(src);
  return readsSession && readsSurface;
}

/**
 * True when the source loads the overlay (imports or reads the file, or imports
 * anything from the muslin module) AND pins its contents: a quoted placeholder
 * name, or a placeholderColumns count compared with a bare number. A fitting
 * that adds a data gap breaks both.
 * Pattern-based, so not exhaustive: a count hidden in arithmetic on another
 * collection (`visibleColumns.length + 1`) is not detectable here.
 */
function assertsOverlayLiteral(src: string, overlayFile: string, names: string[], testPath = ""): boolean {
  const file = escape(overlayFile);
  const loadsOverlay =
    // A test that lives under src/muslin/ sits beside the merged config, so it counts as loading the overlay.
    /(?:^|[\\/])muslin[\\/]/.test(testPath) ||
    // Any import path with a `muslin` directory segment (../../muslin/config, ./muslin/client) or ending in /muslin.
    /from\s+(["'])[^"']*\/muslin(?:\/[^"']*)?\1/.test(src) ||
    new RegExp(`from\\s+(["'])[^"']*/${file}\\1`).test(src) ||
    new RegExp(String.raw`(?:read\w*|URL|join)\([^)]*?(["'\`])[^"'\`]*${file}\1`).test(src);
  const quotesName = names.some((n) => ['"', "'", "`"].some((q) => src.includes(`${q}${n}${q}`)));
  const countsPlaceholders =
    /placeholderColumns\b[^;]{0,80}?\.to(?:HaveLength|Be|Equal|StrictEqual)\(\s*\d+\s*\)/.test(src);
  return loadsOverlay && (quotesName || countsPlaceholders);
}

const SURFACES = [basename(cfg.muslin.configSurface), basename(cfg.muslin.overlay)];
const SESSIONS = readdirSync(join(APP, ".fitting-room/sessions")).filter((f) => /^example-.*\.json$/.test(f));
const excludes = excludeGlobs(cfg.attempt?.testCommand ?? "").map(globToRegExp);
const remaining = (): { file: string; src: string }[] =>
  testFiles(APP)
    .filter((f) => f !== "test-command-guard.test.ts" && !excludes.some((r) => r.test(f)))
    .map((file) => ({ file, src: readFileSync(join(APP, file), "utf8") }));
const surfaceValues = (): string[] =>
  leafStrings(JSON.parse(readFileSync(join(APP, cfg.muslin.configSurface), "utf8"))).filter((v) => v.length >= 3);

const overlayNames = (): string[] =>
  (JSON.parse(readFileSync(join(APP, cfg.muslin.overlay), "utf8")).placeholderColumns ?? []).map(
    (p: { name: string }) => p.name,
  );

describe("attempt testCommand guard", () => {
  it("the sample config parses with parseFittingroomConfig", () => {
    const c = parseFittingroomConfig(cfg);
    expect(c.attempt.testCommand).toBe('npx vitest run --project sample-app --exclude "**/*replay.test.ts" --exclude "**/*.live.test.ts"');
    expect(c.muslin.screens).toEqual({ "/": { endpoints: ["jobs"] } });
    expect(c.muslin.personas).toBe("src/fixtures/personas");
  });

  it("the testCommand exclude matches every replay.test file", () => {
    const replay = testFiles(APP).filter((f) => basename(f).includes("replay.test"));
    expect(replay).toEqual(expect.arrayContaining(["first-fitting.replay.test.ts", "session-schema.replay.test.ts"]));
    for (const f of replay) expect(excludes.some((r) => r.test(f)), f).toBe(true);
  });

  it("the testCommand exclude matches every .live.test file", () => {
    const live = testFiles(APP).filter((f) => basename(f).endsWith(".live.test.ts"));
    expect(live).toContain("dev-muslin.live.test.ts");
    for (const f of live) expect(excludes.some((r) => r.test(f)), f).toBe(true);
  });

  it("no remaining test asserts literal tableConfig.json values", () => {
    const values = surfaceValues();
    expect(values).toEqual(expect.arrayContaining(["Technician", "SLA (h)"]));
    expect(remaining().filter(({ src }) => assertsLiteral(src, values)).map((o) => o.file)).toEqual([]);
  });

  it("no remaining test asserts the overlay's placeholder names or count literally", () => {
    const names = overlayNames();
    expect(names.length).toBeGreaterThan(0);
    const offenders = remaining().filter(({ file, src }) => assertsOverlayLiteral(src, SURFACES[1]!, names, file));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it.each([
    ["merged config with a quoted placeholder name", 'import { muslinConfig } from "../muslin/config"; expect(muslinConfig.placeholderColumns).toEqual([{ name: "warrantyStatus" }]);', true],
    ["merged config with a numeric placeholder count", 'import { muslinClient } from "../muslin/fixture-client"; import { muslinConfig } from "../muslin/config"; expect(muslinConfig.placeholderColumns).toHaveLength(1);', true],
    ["overlay import with a quoted placeholder name", 'import overlay from "../features/jobs/tableConfig.muslin.json"; expect(overlay.placeholderColumns[0].name).toBe("warrantyStatus");', true],
    ["count through .length and toBe", 'import { muslinConfig } from "../muslin/config"; expect(muslinConfig.placeholderColumns!.length).toBe(1);', true],
    ["count split across lines", 'import { muslinConfig } from "../muslin/config";\nexpect(muslinConfig.placeholderColumns)\n  .toHaveLength(2);', true],
    ["backtick-quoted placeholder name", 'import { muslinConfig } from "../muslin/config"; expect(muslinConfig.placeholderColumns![0]!.name).toBe(`warrantyStatus`);', true],
    ["namespace import of the muslin module", 'import * as m from "../../muslin/config"; expect(m.muslinConfig.placeholderColumns).toHaveLength(1);', true],
    ["named import from the alias target", 'import { muslinStore } from "../muslin/client"; expect(muslinStore.get().placeholderColumns).toHaveLength(1);', true],
    ["derived count next to an unrelated numeric assertion", 'import { muslinClient } from "../muslin/fixture-client"; import { muslinConfig } from "../muslin/config"; expect(muslinConfig.placeholderColumns).toEqual(overlay.placeholderColumns); expect(jobs).toHaveLength(4);', false],
    ["overlay-derived expectations", 'import overlay from "../features/jobs/tableConfig.muslin.json"; import { muslinConfig } from "../muslin/config"; expect(muslinConfig.placeholderColumns).toEqual(overlay.placeholderColumns); expect(th).toHaveLength(overlay.placeholderColumns.length);', false],
    ["e2e shape (overlay path string and a session-derived name)", 'expect(r).toMatchObject({ blockedOn: { name: "warrantyStatus" } }); expect(a).toEqual(["examples/sample-app/src/features/jobs/tableConfig.muslin.json"]);', false],
  ])("assertsOverlayLiteral plants: %s", (_n, src, flagged) => {
    expect(assertsOverlayLiteral(src, SURFACES[1]!, ["warrantyStatus"])).toBe(flagged);
  });

  it("a test whose own path is under src/muslin/ counts as loading the overlay", () => {
    const src = 'import { muslinConfig } from "./config"; expect(muslinConfig.placeholderColumns![0]!.name).toBe("warrantyStatus");';
    expect(assertsOverlayLiteral(src, SURFACES[1]!, ["warrantyStatus"])).toBe(false);
    expect(assertsOverlayLiteral(src, SURFACES[1]!, ["warrantyStatus"], "src/muslin/config.test.ts")).toBe(true);
  });

  it("no remaining test compares a committed session with the config surface", () => {
    expect(SESSIONS).toContain("example-fitting.json");
    const offenders = remaining().filter(({ src }) => comparesSessionWithSurface(src, SURFACES, SESSIONS));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("the committed-session check spares path-only tests that exist today", () => {
    expect(existsSync(join(APP, "ignores.test.ts"))).toBe(true);
    for (const f of ["ignores.test.ts", "attempt.e2e.test.ts"]) {
      if (!existsSync(join(APP, f))) continue; // attempt.e2e.test.ts lands in a later phase of FR-12
      expect(comparesSessionWithSurface(readFileSync(join(APP, f), "utf8"), SURFACES, SESSIONS), f).toBe(false);
    }
  });

  it.each([
    ["session-schema shape (reads both)", 'const s = read("./.fitting-room/sessions/example-fitting.json"); expect(x).toEqual(read("./src/features/jobs/tableConfig.json").columnOrder);', true],
    ["import of the surface plus a session read", 'import cfg from "./src/features/jobs/tableConfig.json"; readFileSync(new URL("./.fitting-room/sessions/example-fitting.json", import.meta.url));', true],
    ["ignores shape (path strings only)", 'it.each(["some/host/.fitting-room/sessions/x.json", `${APP}src/features/jobs/tableConfig.json`])("tracks %s", (p) => expect(ignored(p)).toBe(false));', false],
    ["e2e shape (reads the session, asserts repo-rel strings)", 'const f = JSON.parse(await readFile(join(APP, ".fitting-room/sessions/example-fitting.json"), "utf8")); expect(a).toEqual(["examples/sample-app/src/features/jobs/tableConfig.json"]);', false],
  ])("comparesSessionWithSurface plants: %s", (_n, src, flagged) => {
    expect(comparesSessionWithSurface(src, SURFACES, SESSIONS)).toBe(flagged);
  });

  it("the literal check flags a planted offender and spares a config-free label test", () => {
    const values = surfaceValues();
    expect(assertsLiteral('import c from "./tableConfig.json"; expect(h).toBe("SLA (h)");', values)).toBe(true);
    expect(assertsLiteral('expect(label).toBe("Technician");', values)).toBe(false);
  });
});
