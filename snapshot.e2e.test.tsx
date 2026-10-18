// FR-59 end to end on the sample app: the real panel, mounted over the real jobs table, talks to a real
// `fit serve` kernel (fake git over a temp copy of this app). One fitting: a pin on "/", a navigation away,
// Submit. The fitting branch then holds exactly one snapshot, for "/", with column keys and no cell text.
import { cp, readdir, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { FittingBranch } from "@fitting-room/agent";
import type { FittingAgent } from "@fitting-room/agent";
import { createFakeRunner, tempDirs } from "@fitting-room/agent/testing";
import { createServer } from "@fitting-room/cli/serve";
import { PANEL_HOST_ID, mount, type PanelHandle } from "@fitting-room/panel";
import baseConfig from "./src/features/jobs/tableConfig.json";
import { ConfigProvider } from "./src/features/jobs/ConfigProvider";
import { JobsTable } from "./src/features/jobs/JobsTable";
import { jobFixtures } from "./src/fixtures/dispatcher";
import type { Job, TableConfig } from "./src/api/types";

const APP = __dirname;
const SKIP = /^(node_modules|dist|dist-muslin|\.git|vendor|\.worktrees|\.fitting-room[\\/](sessions|baselines))([\\/]|$)/;
const ID = "fit-0a1b2c3d";
const TOKEN = "synthetic-token-0059";
const config = baseConfig as TableConfig;
const jobs: Job[] = Object.values(jobFixtures).map((f) => f.data);
const temp = tempDirs();
let handle: PanelHandle | undefined;

afterEach(() => {
  handle?.unmount();
  handle = undefined;
  cleanup();
  document.head.querySelectorAll('meta[name="fittingroom-token"]').forEach((m) => m.remove());
  vi.unstubAllGlobals();
  history.replaceState({}, "", "/");
});
afterAll(() => temp.cleanup());

/** A layout pin for every utterance; nothing here attempts. */
const agent: FittingAgent = {
  name: "e2e-stub",
  async pin(input) {
    return { id: "agent-chosen-id", at: "1999-01-01T00:00:00.000Z", utterance: input.utterance, kind: "layout", scope: "frontend", summary: input.utterance };
  },
  async attempt() {
    throw new Error("not called in this test");
  },
};

const q = <T extends Element>(sel: string): T => document.getElementById(PANEL_HOST_ID)!.shadowRoot!.querySelector<T>(sel)!;
const WAIT = { timeout: 15_000 };

describe("structural snapshots on the sample app", () => {
  it("one fitting, a pin on /, navigate away, Submit: one snapshot for / with column keys and no cell text", { timeout: 60_000 }, async () => {
    const tmpRoot = await realpath(await temp.make("fit-snap-e2e-"));
    const host = join(tmpRoot, "examples/sample-app");
    await cp(APP, host, { recursive: true, filter: (src) => !SKIP.test(relative(APP, src)) });
    const fake = await createFakeRunner(tmpRoot);
    const server = createServer({
      cwd: host, exec: fake.runner, env: {}, token: TOKEN, staticDir: join(host, "dist-muslin"), agentName: "e2e-stub",
      agentFactory: () => agent, port: 4400, base: "main", newId: () => ID, now: () => new Date(Date.UTC(2026, 0, 1)), err: () => undefined,
    });
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), "http://127.0.0.1:4400");
      const method = init.method ?? "GET";
      calls.push(`${method} ${url.pathname}`);
      const headers: Record<string, string> = { host: "127.0.0.1:4400" };
      for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
      const res = await server.handle({ method, url: url.pathname + url.search, headers, ...(typeof init.body === "string" ? { body: init.body } : {}) });
      const text = typeof res.body === "string" ? res.body : Buffer.from(res.body).toString("utf8");
      return { ok: res.status >= 200 && res.status < 300, status: res.status, text: async () => text } as unknown as Response;
    });
    const meta = document.createElement("meta");
    meta.name = "fittingroom-token";
    meta.content = TOKEN;
    document.head.append(meta);
    sessionStorage.clear();
    history.replaceState({}, "", "/");
    render(<ConfigProvider config={config}><JobsTable jobs={jobs} onSelect={() => {}} /></ConfigProvider>);

    let value: unknown = {};
    const listeners = new Set<(v: unknown) => void>();
    handle = mount({ store: { get: () => value, set: (v) => { value = v; listeners.forEach((l) => l(v)); }, subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); } } });
    await handle.ready;

    // FR-96: no start form; the first Apply starts the fitting on the only persona fit serve lists.
    await waitFor(() => expect(q("input[name=utterance]")).not.toBeNull(), WAIT);
    q<HTMLInputElement>("input[name=utterance]").value = "Make the rows more compact";
    q<HTMLButtonElement>('.fr-compose button[type="submit"]').click();
    await waitFor(() => expect(calls).toContain("POST /api/fittings"), WAIT);
    await waitFor(() => expect(fake.messages(`fitting/${ID}`).length).toBeGreaterThan(0), WAIT);

    history.pushState({}, "", "/away");
    window.dispatchEvent(new PopStateEvent("popstate"));
    const PUT = new RegExp(`^PUT /api/fittings/${ID}/snapshots/root-[0-9a-f]{8}$`);
    await waitFor(() => expect(calls.some((c) => PUT.test(c))).toBe(true), WAIT);

    q<HTMLButtonElement>(".fr-drawer-toggle").click();
    await waitFor(() => expect(q<HTMLButtonElement>(".fr-submit").disabled).toBe(false), WAIT);
    q<HTMLButtonElement>(".fr-submit").click();
    await waitFor(() => expect(q(".fr-confirm-yes")).not.toBeNull(), WAIT);
    q<HTMLButtonElement>(".fr-confirm-yes").click();
    await waitFor(() => expect(fake.messages(`fitting/${ID}`).at(-1)).toMatch(/^submit: /), WAIT);

    const wt = join(tmpRoot, ".worktrees", `fitting-${ID}`);
    const dir = `examples/sample-app/.fitting-room/sessions/${ID}/snapshots`;
    const names = await readdir(join(wt, dir));
    expect(names).toHaveLength(1); // one per visited dressed screen: "/" only ("/away" is undressed)
    expect(names[0]).toMatch(/^root-[0-9a-f]{8}\.json$/);

    const text = await new FittingBranch({ runner: fake.runner, env: {} }).readAtRef({ cwd: wt, ref: `fitting/${ID}`, repoRel: `${dir}/${names[0]}` });
    expect(text).toBeDefined();
    const snap = JSON.parse(text!) as { version: number; screen: string };
    expect(snap.version).toBe(1);
    expect(snap.screen).toBe("/");
    expect(text).toContain('"testId":"jobs-table"');
    const keys = [...text!.matchAll(/"columnKey":"([^"]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(config.columnOrder.filter((c) => !config.hiddenByDefault.includes(c)));
    expect(jobs.length).toBeGreaterThan(0);
    // Every rendered cell text field the fixtures carry; the count keeps the check from passing vacuously.
    let checked = 0;
    for (const job of jobs) {
      const values = [job.reference, job.customerName, job.address, job.technician?.displayName, ...job.parts.flatMap((x) => [x.sku, x.description])];
      for (const v of values) {
        if (!v) continue;
        checked++;
        expect(text).not.toContain(v);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(jobs.length * 2);
    expect(jobs.some((j) => j.address)).toBe(true);
    expect(jobs.some((j) => j.parts.length > 0)).toBe(true);
  });
});
