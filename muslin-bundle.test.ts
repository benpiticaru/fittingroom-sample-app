// @vitest-environment node
//
// Positive control for bundle.test.ts: the muslin build DOES contain the panel
// chunk, the fixtures and the descriptor publish, so their absence from the
// production build means something. Built through the cli's `muslinBuild` (the
// same code `fit muslin build` runs) into mkdtemp dirs, never dist-muslin/ or dist/.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tempDirs } from "@fitting-room/agent/testing";
import { fileURLToPath } from "node:url";
import { muslinBuild } from "@fitting-room/cli";

const appDir = fileURLToPath(new URL(".", import.meta.url));
const temp = tempDirs();
let outDir: string;
let assetNames: string[];
let jsText: string;
let html: string;

const build = async (): Promise<string> => {
  const out = temp.makeSync("fittingroom-muslin-bundle-");
  return (await muslinBuild({ hostDir: appDir, out })).outDir;
};

/** Every built file as name -> text, with content hashes in names and references normalised away. */
function normalised(dir: string): Record<string, string> {
  const hash = (t: string): string => t.replace(/([A-Za-z]+)-[A-Za-z0-9_-]{8}\.(js|css)/g, "$1-HASH.$2");
  const list = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(join(d, e.name)).map((f) => join(e.name, f)) : [e.name]));
  return Object.fromEntries(list(dir).sort().map((f) => [hash(f), hash(readFileSync(join(dir, f), "utf8"))]));
}

beforeAll(async () => {
  outDir = await build();
  assetNames = readdirSync(join(outDir, "assets"));
  html = readFileSync(join(outDir, "index.html"), "utf8");
  jsText = assetNames
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(outDir, "assets", f), "utf8"))
    .join("\n");
}, 180_000);

afterAll(() => {
  temp.cleanupSync();
});

describe("muslin bundle (fit muslin build)", () => {
  it("emits the named panel chunk", () => {
    expect(assetNames.some((f) => /^fittingroom-panel-.*\.js$/.test(f))).toBe(true);
  });

  it("contains the fixtures", () => {
    expect(jsText).toContain("SYN-JOB-4120");
  });

  it("contains the persona user handle", () => {
    expect(jsText).toContain("SYN-USER-");
  });

  it("publishes the host descriptor", () => {
    expect(jsText).toContain("__fittingRoom");
    expect(jsText).toContain("fittingroom:host");
  });

  // Positive control for the gap tokens bundle.test.ts forbids in production: the muslin carries the seam.
  it("carries the gap store's storage key", () => {
    expect(jsText).toContain("fitting-room:gaps");
  });

  it("swapped the API boundary: the real HttpClient's fetch path is absent", () => {
    expect(jsText).not.toContain("jobs failed:");
  });

  it("keeps the host's own base for asset URLs", () => {
    expect(html).toMatch(/(?:src|href)="\/assets\//);
    expect(html).not.toMatch(/(?:src|href)="\.\/assets\//);
  });

  it("is reproducible: a second build is byte-identical once content hashes are normalised", async () => {
    const second = await build();
    const a = normalised(outDir);
    const b = normalised(second);
    expect(Object.keys(a)).toHaveLength(readdirSync(outDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length);
    expect(Object.keys(b)).toEqual(Object.keys(a));
    for (const k of Object.keys(a)) expect(b[k], k).toBe(a[k]);
  }, 180_000);

  // In the monorepo `npm ci` links no .bin/fit when the cli has no dist yet, so the scripts run the built entry.
  // The standalone export installs the cli with its dist present and rewrites them to the plain command.
  it.skipIf(existsSync(join(appDir, ".fitting-room-export")))("the monorepo scripts invoke the cli's built entry, not a bare fit bin", () => {
    const scripts = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")).scripts as Record<string, string>;
    for (const [name, sub] of [["build:muslin", "build"], ["dev:muslin", "dev"]] as const) {
      expect(scripts[name], name).toBe(`tsc -b ../../packages/cli && node ../../packages/cli/dist/index.js muslin ${sub}`);
      expect(scripts[name]!.split(/\s+/), name).not.toContain("fit");
    }
  });
});
