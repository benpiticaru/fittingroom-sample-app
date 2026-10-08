import { describe, expect, it } from "vitest";
import baseConfig from "../features/jobs/tableConfig.json";
import { muslinClient, muslinConfig } from "./muslin";
import type { TableConfig } from "./types";

describe("muslin overlay", () => {
  it("adds the overlay's placeholder columns to the merged config", () => {
    expect(muslinConfig.placeholderColumns).toEqual([{ name: "warrantyStatus", label: "not in data today" }]);
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
});
