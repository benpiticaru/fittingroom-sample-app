// @vitest-environment jsdom
/**
 * Purpose: cover the detail view's missing-value fallbacks.
 * Responsibilities: assert that absent fields render an em dash, never the
 *   string "undefined", which is the failure a stakeholder would actually see.
 * Dependencies: @testing-library/react, ./JobDetail, ../../fixtures/dispatcher.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { JobDetail } from "./JobDetail";
import { jobFixtures } from "../../fixtures/dispatcher";
import type { Job } from "../../api/types";

// Vitest globals are off, so @testing-library's auto-cleanup never registers.
afterEach(cleanup);

const EM_DASH = "—";
const byRef = (ref: string): Job => {
  const found = Object.values(jobFixtures).find((f) => f.data.reference === ref);
  if (!found) throw new Error(`fixture ${ref} not found`);
  return found.data;
};

/** The declared "no-address" edge: raised from a call, no address, no technician, no parts. */
const sparse = byRef("SYN-JOB-4123");
/** A fully populated job, including a part on backorder. */
const full = byRef("SYN-JOB-4121");

describe("JobDetail", () => {
  it("renders an em dash for a missing address, never the text undefined", () => {
    render(<JobDetail job={sparse} onBack={() => {}} />);
    expect(screen.queryByText("undefined")).toBeNull();
    expect(screen.getByText("Address").nextElementSibling?.textContent).toBe(EM_DASH);
  });

  it("renders an em dash for a missing technician", () => {
    render(<JobDetail job={sparse} onBack={() => {}} />);
    expect(screen.getByText("Technician").nextElementSibling?.textContent).toBe(EM_DASH);
  });

  it("renders an em dash, not an empty list, when a job has no parts", () => {
    render(<JobDetail job={sparse} onBack={() => {}} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getAllByText(EM_DASH).length).toBeGreaterThanOrEqual(3);
  });

  it("renders the real values when they are present", () => {
    render(<JobDetail job={full} onBack={() => {}} />);
    expect(screen.getByText("Address").nextElementSibling?.textContent).toBe(full.address);
    expect(screen.getByText("Technician").nextElementSibling?.textContent).toBe(full.technician?.displayName);
    expect(screen.queryByText("undefined")).toBeNull();
  });

  it("flags a part on backorder, which is why that fixture exists", () => {
    render(<JobDetail job={full} onBack={() => {}} />);
    const backordered = full.parts.find((p) => p.onBackorder);
    expect(backordered).toBeDefined();
    // getByText throws when absent, so this is the existence assertion.
    expect(screen.getByText(`${backordered!.description} (on backorder)`).tagName).toBe("LI");
    expect(screen.getByRole("list").textContent).toContain("(on backorder)");
  });

  it("renders the year only, never a full date, per the no-real-identifiers constraint", () => {
    render(<JobDetail job={full} onBack={() => {}} />);
    expect(screen.getByText("Opened").nextElementSibling?.textContent).toBe(String(full.openedYear));
    expect(screen.getByText("Opened").nextElementSibling?.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
