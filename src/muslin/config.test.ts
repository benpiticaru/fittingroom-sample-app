import { afterEach, describe, expect, it } from "vitest";
import baseConfig from "../features/jobs/tableConfig.json";
import overlay from "../features/jobs/tableConfig.muslin.json";
import type { TableConfig } from "../api/types";
import { muslinConfig } from "./config";
import { muslinClient, muslinGaps } from "./fixture-client";

describe("muslin overlay", () => {
  it("adds the overlay's placeholder columns to the merged config", () => {
    // Derived from the overlay file: a fitting worktree adds placeholders to it.
    expect(overlay.placeholderColumns.length).toBeGreaterThan(0);
    expect(muslinConfig.placeholderColumns).toEqual(overlay.placeholderColumns);
  });

  it("labels every placeholder exactly 'not in data today', the string core's NOT_IN_DATA_TODAY holds", () => {
    for (const p of muslinConfig.placeholderColumns ?? []) expect(p.label).toBe("not in data today");
  });

  it("leaves the base config free of placeholder columns, so one can never reach production", () => {
    expect((baseConfig as TableConfig).placeholderColumns).toBeUndefined();
  });

  it("keeps every base config value the overlay does not mention", () => {
    const base = baseConfig as TableConfig;
    expect(muslinConfig.columnOrder).toEqual(base.columnOrder);
    expect(muslinConfig.defaultSort).toEqual(base.defaultSort);
    expect(muslinConfig.density).toBe(base.density);
  });

  it("serves every fixture through the fixture-backed client", async () => {
    const jobs = await muslinClient.list();
    expect(jobs).toHaveLength(4);
    expect(jobs.map((j) => j.reference)).toContain("SYN-JOB-4120");
  });

  it("returns undefined for an unknown id rather than throwing", async () => {
    await expect(muslinClient.get("SYN-JOB-9999")).resolves.toBeUndefined();
  });

  describe("gap layer", () => {
    afterEach(() => muslinGaps.set({ version: 1, fields: [] }));

    it("adds the jobs endpoint's gap fields to every record the client returns", async () => {
      muslinGaps.set({
        version: 1,
        fields: [{ pinId: "pin-1", endpoint: "jobs", field: "warrantyEnd", label: "warrantyEnd", value: "[example] SYN-0000" }],
      });
      const jobs = await muslinClient.list();
      expect(jobs).toHaveLength(4);
      for (const j of jobs) expect((j as unknown as Record<string, unknown>).warrantyEnd).toBe("[example] SYN-0000");
      const one = await muslinClient.get("SYN-JOB-4120");
      expect((one as unknown as Record<string, unknown> | undefined)?.warrantyEnd).toBe("[example] SYN-0000");
    });

    it("adds nothing with the empty layer", async () => {
      for (const j of await muslinClient.list()) expect(j).not.toHaveProperty("warrantyEnd");
    });
  });
});
