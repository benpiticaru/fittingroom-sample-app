import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import baseConfig from "./tableConfig.json";
import { ConfigProvider } from "./ConfigProvider";
import { JobsTable } from "./JobsTable";
import type { Job, TableConfig } from "../../api/types";
import { jobFixtures } from "../../fixtures/dispatcher";
import { muslinConfig } from "../../muslin/config";
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
// A placeholder cell's value: the sample's <em> (the "example" tag is excluded) or the em dash.
const cellValue = (td: Element): string | null => td.querySelector("em")?.textContent ?? td.textContent;

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
  // Counted from the merged config, never hard-coded: a fitting worktree adds
  // one placeholder per data gap, and these tests run there too.
  const placeholders = muslinConfig.placeholderColumns ?? [];
  const placeholderLabels = placeholders.map((p) => p.label);

  it("adds one header per placeholder column, labelled with the overlay's label", () => {
    expect(placeholders.length).toBeGreaterThan(0);
    renderTable(muslinConfig);
    expect(screen.getAllByRole("columnheader", { name: PLACEHOLDER_LABEL })).toHaveLength(placeholders.length);
    expect(screen.getAllByRole("columnheader")).toHaveLength(visibleColumns.length + placeholders.length);
  });

  it("appends the placeholder columns after the configured columns, never among them", () => {
    renderTable(muslinConfig);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([...BASE_HEADERS, ...placeholderLabels]);
  });

  it("renders each placeholder cell as its sample (cycled per row) or an em dash, one cell per job", () => {
    renderTable(muslinConfig);
    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(jobs.length);
    bodyRows.forEach((row, i) => {
      const cells = Array.from(row.querySelectorAll("td"));
      expect(cells).toHaveLength(visibleColumns.length + placeholders.length);
      expect(cells.slice(visibleColumns.length).map(cellValue)).toEqual(
        placeholders.map((p) => (p.sample ? p.sample[i % p.sample.length]! : "—")),
      );
    });
  });

  it("renders a sample verbatim with an example tag, and an em dash without one", () => {
    const withSample = { name: "holdRef", label: "pending", sample: ["[example] SYN-0000", "[example] SYN-0001"] };
    const without = { name: "plainRef", label: "pending" };
    const { container } = renderTable({ ...config, placeholderColumns: [withSample, without] });
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    rows.forEach((row, i) => {
      const [a, b] = Array.from(row.querySelectorAll("td.placeholder"));
      expect(a!.querySelector("em")!.textContent).toBe(withSample.sample[i % withSample.sample.length]);
      expect(a!.querySelector(".example-tag")).not.toBeNull();
      expect(b!.textContent).toBe("—");
      expect(b!.querySelector(".example-tag")).toBeNull();
    });
  });

  it("marks the placeholder headers and their cells with the placeholder class, which is what styles them as not real", () => {
    const { container } = renderTable(muslinConfig);
    const headers = Array.from(container.querySelectorAll("th.placeholder"));
    expect(headers.map((h) => h.textContent)).toEqual(placeholderLabels);
    const cells = Array.from(container.querySelectorAll("td.placeholder"));
    expect(cells).toHaveLength(jobs.length * placeholders.length);
    expect(cells.map(cellValue)).toEqual(
      jobs.flatMap((_, i) => placeholders.map((p) => (p.sample ? p.sample[i % p.sample.length]! : "—"))),
    );
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

// FR-59: a structural snapshot of this screen records the table's test id and each header's column key.
describe("JobsTable markup for structural snapshots", () => {
  it("the table carries a test id and every header its column key, in order", () => {
    const { container } = renderTable();
    expect(container.querySelector("table")!.getAttribute("data-testid")).toBe("jobs-table");
    expect(screen.getAllByRole("columnheader").map((h) => h.getAttribute("data-column-key"))).toEqual(visibleColumns);
  });

  it("a placeholder header's column key is its field name", () => {
    const placeholders = muslinConfig.placeholderColumns ?? [];
    renderTable(muslinConfig);
    const keys = screen.getAllByRole("columnheader").map((h) => h.getAttribute("data-column-key"));
    expect(keys.slice(visibleColumns.length)).toEqual(placeholders.map((p) => p.name));
  });

  it("no body cell carries a column key or a test id", () => {
    const { container } = renderTable(muslinConfig);
    expect(container.querySelectorAll("td[data-column-key], td[data-testid]")).toHaveLength(0);
  });
});
