// @vitest-environment node
//
// Positive control for bundle.test.ts: the muslin build DOES contain the panel
// chunk and the fixtures, so their absence from the production build means
// something. Builds into its own mkdtemp dir, never dist-muslin/ or dist/.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL(".", import.meta.url));
let outDir: string;
let assetNames: string[];
let jsText: string;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "fittingroom-muslin-bundle-"));
  execFileSync("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"], {
    cwd: appDir,
    stdio: "pipe",
    env: { ...process.env, NODE_ENV: "production", VITE_FITTINGROOM: "1" },
  });
  assetNames = readdirSync(join(outDir, "assets"));
  jsText = assetNames
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(outDir, "assets", f), "utf8"))
    .join("\n");
}, 120_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe("muslin bundle (flag on)", () => {
  it("emits the named panel chunk", () => {
    expect(assetNames.some((f) => /^fittingroom-panel-.*\.js$/.test(f))).toBe(true);
  });

  it("contains the fixtures", () => {
    expect(jsText).toContain("SYN-JOB-4120");
  });

  it("contains the persona user handle", () => {
    expect(jsText).toContain("SYN-USER-");
  });
});
