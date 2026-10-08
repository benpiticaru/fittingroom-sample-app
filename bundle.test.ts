// @vitest-environment node
//
// Constraint B: the host app's production bundle is never modified by this
// framework. The only honest way to assert that is to build it and read the
// output. Builds into an mkdtemp dir, never examples/sample-app/dist.
// (`build:muslin` writes to dist-muslin/ since FR-10; this test still builds
// into its own mkdtemp, so it never touches either directory.)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL(".", import.meta.url));
let outDir: string;
let bundleText: string;
/** The JS assets alone. Used where an assertion must be about the SCRIPT. */
let jsText: string;
let assetNames: string[];
let scannedFiles: string[];

/** Built files whose contents ship to a browser as text. */
const TEXT_ASSET = /\.(js|mjs|cjs|css|html|json|svg|map)$/;

function listFilesRecursively(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? listFilesRecursively(full) : [full];
  });
}

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "fittingroom-bundle-"));
  execFileSync("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"], {
    cwd: appDir,
    stdio: "pipe",
    // NODE_ENV must be "production", not Vitest's inherited "test". Otherwise
    // @vitejs/plugin-react keeps the DEV JSX transform and the bundle under
    // test carries jsxDEV plus absolute source paths, i.e. it is not the
    // artifact that actually ships and Constraint B would be asserted against
    // the wrong build.
    env: { ...process.env, NODE_ENV: "production", VITE_FITTINGROOM: "0" },
  });
  assetNames = readdirSync(join(outDir, "assets"));
  // Read EVERY built text file, not just the JS. A stylesheet, the HTML shell
  // or a JSON asset is as much a part of the shipped bundle as a script, and
  // scanning only .js left a blind spot: a fixture id or the overlay label
  // planted in src/index.css produced a full pass.
  scannedFiles = listFilesRecursively(outDir).filter((f) => TEXT_ASSET.test(f));
  bundleText = scannedFiles.map((f) => readFileSync(f, "utf8")).join("\n");
  jsText = scannedFiles
    .filter((f) => /\.(js|mjs|cjs)$/.test(f))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}, 120_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe("production bundle (flag off)", () => {
  it("produces at least one JS asset, so the assertions below are not vacuous", () => {
    expect(assetNames.filter((f) => f.endsWith(".js")).length).toBeGreaterThan(0);
    expect(bundleText.length).toBeGreaterThan(1000);
  });

  it("contains no fixture record id", () => {
    expect(bundleText).not.toContain("SYN-JOB-4120");
    expect(bundleText).not.toContain("SYN-TECH-");
  });

  // Belt and braces: the spec names this string, but esbuild minification
  // renames the identifier, so only an unminified leak would trip it.
  it("contains no createFixtureClient reference", () => {
    expect(bundleText).not.toContain("createFixtureClient");
  });

  it("contains no placeholder-column label or field name from the muslin overlay", () => {
    expect(bundleText).not.toContain("not in data today");
    expect(bundleText).not.toContain("warrantyStatus");
  });

  it("emits no separate muslin chunk", () => {
    expect(assetNames.filter((f) => /muslin/i.test(f))).toEqual([]);
  });

  // Belt and braces: minification renames createConfigStore and the bundler
  // rewrites the bare @fitting-room/panel specifier, so the two string checks
  // below cannot fail on a leak. The real guards are the chunk-name check and
  // the fixture / SYN-USER- absences, backed by muslin-bundle.test.ts.
  it("emits no @fitting-room/panel chunk", () => {
    expect(assetNames.filter((f) => /panel/i.test(f))).toEqual([]);
    expect(bundleText).not.toContain("@fitting-room/panel");
  });

  it("contains no createConfigStore reference", () => {
    expect(bundleText).not.toContain("createConfigStore");
  });

  it("contains no fittingroom-panel marker", () => {
    expect(bundleText).not.toContain("fittingroom-panel");
  });

  it("contains no persona user fixture", () => {
    expect(bundleText).not.toContain("SYN-USER-");
  });

  it("scans the stylesheet too, so a leak into CSS cannot pass unseen", () => {
    // Regression guard: bundleText once read only .js assets, and a fixture id
    // planted in src/index.css passed every assertion below.
    expect(scannedFiles.some((f) => f.endsWith(".css"))).toBe(true);
    expect(scannedFiles.some((f) => f.endsWith(".js"))).toBe(true);
    const totalBytes = scannedFiles.length;
    expect(totalBytes).toBeGreaterThanOrEqual(2);
  });

  it("still contains the production code, proving the build was real", () => {
    // Asserted against jsText, NOT bundleText. index.html carries the same
    // string in its <title>, so checking the whole scanned corpus would pass
    // even if the component tree never made it into the bundle.
    expect(jsText).toContain("Dispatch worklist");
  });

  it("is a real production build, not Vitest's inherited NODE_ENV=test build", () => {
    // Without NODE_ENV=production the React plugin keeps the dev JSX transform,
    // and the bundle asserted on above would not be the one that ships.
    expect(bundleText).not.toContain("jsxDEV");
  });

  it("leaks no absolute filesystem path from the build machine", () => {
    // The dev JSX transform embeds `fileName:` with an absolute path. A
    // production build must not carry the builder's directory layout.
    expect(bundleText).not.toMatch(/\/(Users|home)\//);
  });
});
