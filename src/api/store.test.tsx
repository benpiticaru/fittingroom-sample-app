// @vitest-environment jsdom
/**
 * Purpose: prove the table follows a config store without remounting.
 * Expected values come from the config passed to store.set or imported at
 * test time, never from literal tableConfig.json values.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createConfigStore } from "@fitting-room/adapter-msw";
import { ConfigProvider } from "../features/jobs/ConfigProvider";
import { JobsTable } from "../features/jobs/JobsTable";
import { jobFixtures } from "../fixtures/dispatcher";
import { muslinConfig } from "../muslin/config";
import type { TableConfig } from "./types";
import "../index.css";

afterEach(cleanup);

const jobs = Object.values(jobFixtures).map((f) => f.data);
const initial = muslinConfig;

function headersFor(cfg: TableConfig): string[] {
  return [
    ...cfg.columnOrder.filter((c) => !cfg.hiddenByDefault.includes(c)).map((c) => cfg.labels[c] ?? c),
    ...(cfg.placeholderColumns ?? []).map((p) => p.label),
  ];
}

const renderedHeaders = () => screen.getAllByRole("columnheader").map((h) => h.textContent);

describe("ConfigProvider driven by a config store", () => {
  it("re-renders in the new column order on store.set without remounting", () => {
    const store = createConfigStore<TableConfig>(initial);
    render(
      <ConfigProvider store={store}>
        <JobsTable jobs={jobs} onSelect={() => {}} />
      </ConfigProvider>,
    );
    const table = screen.getByRole("table");
    const next = { ...initial, columnOrder: [...initial.columnOrder].reverse() };
    expect(headersFor(next)).not.toEqual(headersFor(initial));
    expect(renderedHeaders()).toEqual(headersFor(initial));

    act(() => store.set(next));

    expect(screen.getByRole("table")).toBe(table);
    expect(renderedHeaders()).toEqual(headersFor(next));
  });

  it("adds a striped placeholder column when placeholderColumns grows", () => {
    const store = createConfigStore<TableConfig>(initial);
    const { container } = render(
      <ConfigProvider store={store}>
        <JobsTable jobs={jobs} onSelect={() => {}} />
      </ConfigProvider>,
    );
    const before = initial.placeholderColumns!;
    const extra = { name: "synthProbeField", label: before[0]!.label };

    act(() => store.set({ ...initial, placeholderColumns: [...before, extra] }));

    const headers = container.querySelectorAll("th.placeholder");
    expect(headers).toHaveLength(before.length + 1);
    expect(container.querySelectorAll("td.placeholder")).toHaveLength(jobs.length * (before.length + 1));
    expect(getComputedStyle(headers[headers.length - 1]!).backgroundImage).toMatch(/gradient/);
  });

  it("still accepts a plain config prop", () => {
    render(
      <ConfigProvider config={initial}>
        <JobsTable jobs={jobs} onSelect={() => {}} />
      </ConfigProvider>,
    );
    expect(renderedHeaders()).toEqual(headersFor(initial));
  });
});
