import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import baseConfig from "./tableConfig.json";
import { ConfigProvider } from "./ConfigProvider";
import { JobsTable } from "./JobsTable";
import type { Job, TableConfig } from "../../api/types";
import { jobFixtures } from "../../fixtures/dispatcher";
import { muslinConfig } from "../../api/muslin";
// Imported for its side effect: the vitest sample-app project runs with
// `css: true`, so these rules are what the appearance assertions below read.
import "../../index.css";

const jobs: Job[] = Object.values(jobFixtures).map((f) => f.data);
const config = baseConfig as TableConfig;
const visibleColumns = config.columnOrder.filter((c) => !config.hiddenByDefault.includes(c));
const BASE_HEADERS = visibleColumns.map((c) => config.labels[c] ?? c);
const hiddenColumn = config.hiddenByDefault[0]!;
const hiddenLabel = config.labels[hiddenColumn] ?? hiddenColumn;
const PLACEHOLDER_LABEL = "not in data today";

function renderTable(cfg: TableConfig = config) {
  return render(
    <ConfigProvider config={cfg}>
      <JobsTable jobs={jobs} onSelect={() => {}} />
    </ConfigProvider>,
  );
}

// Vitest runs with globals off, so @testing-library/react cannot register its
// own auto-cleanup afterEach. Without this the DOM accumulates between tests.
afterEach(cleanup);

describe("JobsTable", () => {
  it("renders one header per configured column, in configured order", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(BASE_HEADERS);
  });

  it("omits a column that is in columnOrder but listed in hiddenByDefault", () => {
    expect(config.columnOrder).toContain(hiddenColumn);
    renderTable();
    expect(screen.queryByRole("columnheader", { name: hiddenLabel })).toBeNull();
  });

  it("renders that same column once hiddenByDefault no longer lists it", () => {
    renderTable({ ...config, hiddenByDefault: [] });
    expect(screen.getByRole("columnheader", { name: hiddenLabel })).toBeTruthy();
    expect(screen.getAllByRole("columnheader")).toHaveLength(config.columnOrder.length);
  });

  it("renders a row per job", () => {
    renderTable();
    expect(screen.getAllByRole("row")).toHaveLength(jobs.length + 1);
  });

  it("marks an overdue SLA with the configured style", () => {
    renderTable();
    const overdue = screen.getByText("SYN-JOB-4120").closest("tr");
    expect(overdue?.className).toContain(config.displayRules[0]!.style);
  });

  it("renders an em dash, never the text undefined, for a job with no address", () => {
    renderTable({ ...config, columnOrder: [...config.columnOrder, "address"], labels: { ...config.labels, address: "Address" } });
    expect(screen.queryByText("undefined")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("applies the configured density as a class", () => {
    renderTable({ ...config, density: "compact" });
    expect(screen.getByRole("table").className).toContain("compact");
  });
});

// Acceptance criterion 4: the overlay renders, and it renders ONLY under a
// config that carries placeholderColumns. muslinConfig is the real merged
// config the muslin build loads, so a placeholder dropped from the overlay
// fails here rather than only in the config-equality test.
describe("JobsTable under the muslin placeholder overlay", () => {
  it("adds one header per placeholder column, labelled with the overlay's label", () => {
    expect(muslinConfig.placeholderColumns).toHaveLength(1);
    renderTable(muslinConfig);
    expect(screen.getByRole("columnheader", { name: PLACEHOLDER_LABEL })).toBeTruthy();
    expect(screen.getAllByRole("columnheader")).toHaveLength(visibleColumns.length + 1);
  });

  it("appends the placeholder column after the configured columns, never among them", () => {
    renderTable(muslinConfig);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([...BASE_HEADERS, PLACEHOLDER_LABEL]);
  });

  it("renders an em dash in the placeholder column of every row, one per job", () => {
    renderTable(muslinConfig);
    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(jobs.length);
    for (const row of bodyRows) {
      const cells = row.querySelectorAll("td");
      expect(cells).toHaveLength(visibleColumns.length + 1);
      expect(cells[cells.length - 1].textContent).toBe("—");
    }
  });

  it("marks the placeholder header and its cells with the placeholder class, which is what styles them as not real", () => {
    const { container } = renderTable(muslinConfig);
    const header = container.querySelector("th.placeholder");
    expect(header?.textContent).toBe(PLACEHOLDER_LABEL);
    const cells = Array.from(container.querySelectorAll("td.placeholder"));
    expect(cells).toHaveLength(jobs.length);
    expect(cells.map((c) => c.textContent)).toEqual(jobs.map(() => "—"));
  });

  it("renders no placeholder header, cell or class without the overlay", () => {
    expect(config.placeholderColumns).toBeUndefined();
    const { container } = renderTable();
    expect(container.querySelectorAll(".placeholder")).toHaveLength(0);
    expect(screen.queryByRole("columnheader", { name: PLACEHOLDER_LABEL })).toBeNull();
    expect(screen.getAllByRole("columnheader")).toHaveLength(visibleColumns.length);
  });
});

describe("JobsTable display rules", () => {
  const overdueRow = () => screen.getByText("SYN-JOB-4120").closest("tr")!;
  const normalRow = () => screen.getByText("SYN-JOB-4121").closest("tr")!;

  it("gives a row flagged by displayRules a different background from an unflagged row", () => {
    // The class alone is not the feature. A stakeholder who says "flag the
    // overdue ones" is pinning displayRules; if the flagged row looks identical
    // to the others they conclude the muslin ignored them.
    renderTable();
    const flagged = getComputedStyle(overdueRow()).backgroundColor;
    const plain = getComputedStyle(normalRow()).backgroundColor;
    expect(flagged).not.toBe("");
    expect(flagged).not.toBe(plain);
  });

  it("gives the flagged row's cells a different colour and weight", () => {
    renderTable();
    const flaggedCell = getComputedStyle(overdueRow().querySelector("td")!);
    const plainCell = getComputedStyle(normalRow().querySelector("td")!);
    expect(flaggedCell.color).not.toBe(plainCell.color);
    expect(flaggedCell.fontWeight).not.toBe(plainCell.fontWeight);
  });

  it("flags only the row the rule actually matches", () => {
    // SYN-JOB-4120 is the only fixture with a negative slaHoursRemaining.
    renderTable();
    const flaggedBg = getComputedStyle(overdueRow()).backgroundColor;
    const others = ["SYN-JOB-4121", "SYN-JOB-4122", "SYN-JOB-4123"];
    for (const ref of others) {
      const row = screen.getByText(ref).closest("tr")!;
      expect(getComputedStyle(row).backgroundColor, `${ref} should not be flagged`).not.toBe(flaggedBg);
    }
  });

  it("applies no flag styling when the config declares no displayRules", () => {
    renderTable({ ...config, displayRules: [] });
    const flagged = getComputedStyle(overdueRow()).backgroundColor;
    const plain = getComputedStyle(normalRow()).backgroundColor;
    expect(flagged).toBe(plain);
  });
});
