// @vitest-environment node
// FR-104 (spec Revision 10, LE7, AC1): the default liveEdit.devCommand serves this app's muslin. The real
// LocalLiveRuntime starts real Vite through `npm run dev:muslin -- --host 127.0.0.1 --port {port} --strictPort`
// with the minimal host environment, on a free loopback port, and stops it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { LocalLiveRuntime, nodeRunner, parseFittingroomConfig, spawnLong } from "@fitting-room/agent";

const APP = fileURLToPath(new URL(".", import.meta.url));
const TEST_MS = 90_000;
/** Requests share what is left of the test budget, less a margin for the failure message to be the one reported. */
const MARGIN_MS = 5_000;
const cfg = parseFittingroomConfig(JSON.parse(readFileSync(join(APP, ".fitting-room/config.json"), "utf8"))).liveEdit;

describe("dev:muslin under the default devCommand", () => {
  // The install is npm ci in a real fitting worktree; this checkout is already installed, so a no-op stands in.
  const rt = new LocalLiveRuntime({
    worktreeRoot: APP, hostDir: APP, repoRoot: APP, config: { ...cfg, installCommand: "node --version" },
    env: process.env, runner: nodeRunner, spawnLong,
  });
  afterAll(() => rt.stop());
  // FR-134: every request is bounded and a failure carries the dev server's own output, so a stall names itself
  // instead of surfacing as the test's 90 s timeout with nothing attached.
  let deadline = 0;
  const get = async (port: number, path: string): Promise<string> => {
    try {
      const ms = Math.max(1_000, deadline - Date.now());
      return await (await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(ms) })).text();
    } catch (e) {
      throw new Error(`GET ${path} failed (${String(e)}); dev server output:\n${rt.tail().join("\n")}`);
    }
  };

  it("starts the muslin dev server on 127.0.0.1 through the alias path, serves the swapped app, and stops", { timeout: TEST_MS }, async () => {
    deadline = Date.now() + TEST_MS - MARGIN_MS;
    const started = await rt.start();
    expect(started, rt.tail().join("\n")).toMatchObject({ ok: true });
    const port = (started as { ok: true; port: number }).port;
    const html = await get(port, "/");
    expect(html).toContain('src="/@vite/client"');
    expect(html).toContain('src="/src/main.tsx"');
    expect(html).toContain("/@fitting-room/muslin-boot.js");
    // Prove the swap through the import graph: a direct request for /src/api/client.ts has no importer, so the
    // plugin never swaps it and it would serve the real module, proving nothing about the swap.
    const main = await get(port, "/src/main.tsx");
    expect(main).toContain("/src/muslin/client.ts");
    expect(main).not.toMatch(/from\s+["']\/src\/api\/client\.ts/);
    const swapped = await get(port, "/src/muslin/client.ts");
    expect(swapped).toContain("publishHostDescriptor");
    await rt.stop();
    expect(rt.status().server).toBe("down");
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });
});
