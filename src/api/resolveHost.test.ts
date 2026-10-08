import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@fitting-room/panel";
import baseConfig from "../features/jobs/tableConfig.json";
import { resolveHost } from "./client";
import { muslinConfig, muslinStore } from "./muslin";

vi.mock("@fitting-room/panel", () => ({ mount: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("resolveHost", () => {
  it("muslin build: returns the muslin store and mounts the panel with it once", async () => {
    vi.stubEnv("VITE_FITTINGROOM", "1");
    const host = await resolveHost();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledWith({ store: host.store });
    expect(host.store.get()).toEqual(muslinConfig);
  });

  it("production build: static base config, no panel", async () => {
    vi.stubEnv("VITE_FITTINGROOM", "0");
    const host = await resolveHost();
    expect(host.store.get()).toEqual(baseConfig);
    expect(host.store.get().placeholderColumns).toBeUndefined();
    expect(mount).not.toHaveBeenCalled();
  });

  it("the muslin store is live", async () => {
    vi.stubEnv("VITE_FITTINGROOM", "1");
    const host = await resolveHost();
    const next = { ...muslinConfig, columnOrder: [...muslinConfig.columnOrder].reverse() };
    try {
      muslinStore.set(next);
      expect(host.store.get()).toEqual(next);
    } finally {
      muslinStore.set(muslinConfig);
    }
  });
});
