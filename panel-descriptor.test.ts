// @vitest-environment jsdom
// FR-79 acceptance: the panel shows the sample app's fields and surface from its real descriptor.json.
// Publishes the committed descriptor exactly as src/muslin/client.ts does, mounts the panel with no store,
// and reads what the welcome turn lists.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfigStore } from "@fitting-room/adapter-msw";
import { parseHostDescriptor } from "@fitting-room/core";
import { PANEL_HOST_ID, mount, readHost } from "@fitting-room/panel";
import type { PanelHandle } from "@fitting-room/panel";
import { publishHostDescriptor } from "@fitting-room/adapter-msw";
import descriptor from "./src/muslin/descriptor.json";
import { muslinConfig } from "./src/muslin/config";
import type { TableConfig } from "./src/api/types";

let handle: PanelHandle | undefined;

beforeEach(() => {
  history.pushState({}, "", "/");
  sessionStorage.clear();
  // A fitting server double that answers only GET /api/meta; the welcome turn needs nothing else.
  const meta = { agent: "facilitator", modelBacked: false, personas: ["dispatcher"], personaInfo: { dispatcher: { displayName: "Synthetic Dispatcher", handle: "SYN-USER-dispatch", records: [{ key: "jobs", count: 4 }] } } };
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL) => {
    if (!String(input).endsWith("/api/meta")) throw new Error(`unexpected request ${String(input)}`);
    return { ok: true, status: 200, text: async () => JSON.stringify(meta) } as unknown as Response;
  }) as typeof fetch);
  const tag = document.createElement("meta");
  tag.name = "fittingroom-token";
  tag.content = "SYN-TOKEN";
  document.head.append(tag);
});
afterEach(() => {
  handle?.unmount();
  handle = undefined;
  document.querySelectorAll('meta[name="fittingroom-token"]').forEach((m) => m.remove());
  delete (window as unknown as { __fittingRoom?: unknown }).__fittingRoom;
  vi.unstubAllGlobals();
});

const welcome = (): string => document.getElementById(PANEL_HOST_ID)!.shadowRoot!.querySelector('[role="log"]')!.firstElementChild!.textContent!;

describe("the sample app's descriptor.json", () => {
  it("satisfies core's parseHostDescriptor and the panel's readHost once published with a store", () => {
    expect(parseHostDescriptor(descriptor)).toMatchObject({ route: "/", router: "history", rowIdField: "reference" });
    publishHostDescriptor(window, descriptor, createConfigStore<TableConfig>(muslinConfig));
    expect(readHost(window)).toBeDefined();
  });

  it("describes only config keys that exist in the table config, and each key exactly once", () => {
    const keys = [...Object.keys(descriptor.surface.live), ...Object.keys(descriptor.surface.recordedOnly)];
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(Object.keys(muslinConfig), k).toContain(k);
  });
});

describe("the panel on the sample app's descriptor", () => {
  it("lists every live field and every recorded-only field, the latter under the not-live wording", async () => {
    publishHostDescriptor(window, descriptor, createConfigStore<TableConfig>(muslinConfig));
    handle = mount({});
    await handle.ready;
    const text = welcome();
    const [live = "", recorded = ""] = text.split("recorded, not shown live");
    expect(text).toContain("On this screen");
    const shown = (k: string, desc: string): string => `- ${k}: ${desc}`;
    for (const [k, d] of Object.entries(descriptor.surface.live)) expect(live, k).toContain(shown(k, d));
    for (const [k, d] of Object.entries(descriptor.surface.recordedOnly)) {
      expect(recorded, k).toContain(shown(k, d));
      expect(live, k).not.toContain(`- ${k}:`);
    }
  });

  it("mounts when the descriptor is published after mount", async () => {
    handle = mount({});
    expect(document.getElementById(PANEL_HOST_ID)).toBeNull();
    publishHostDescriptor(window, descriptor, createConfigStore<TableConfig>(muslinConfig));
    await handle.ready;
    expect(welcome()).toContain("On this screen");
  });
});
