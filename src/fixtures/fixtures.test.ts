import { describe, expect, it } from "vitest";
import { assertNoObviousIdentifiers, byEdge } from "@fitting-room/fixtures";
import { jobFixtures } from "./dispatcher";

describe("sample-app job fixtures", () => {
  it("passes the identifier guard", () => {
    expect(() => assertNoObviousIdentifiers(jobFixtures)).not.toThrow();
  });

  it("declares at least one edge per fixture", () => {
    for (const [id, f] of Object.entries(jobFixtures)) {
      expect(f.meta.edges.length, `${id} declares no edges`).toBeGreaterThan(0);
    }
  });

  it("marks every fixture synthetic", () => {
    for (const [id, f] of Object.entries(jobFixtures)) {
      expect(f.meta.synthetic, `${id} is not marked synthetic`).toBe(true);
    }
  });

  it("covers the four edges the spec names", () => {
    for (const edge of ["overdue-sla", "part-on-backorder", "technician-double-booked", "no-address"]) {
      expect(byEdge(jobFixtures, edge).length, `no fixture for ${edge}`).toBeGreaterThan(0);
    }
  });

  it("uses only SYN- prefixed record ids", () => {
    for (const id of Object.keys(jobFixtures)) expect(id).toMatch(/^SYN-/);
  });

  it("holds no phone- or email-shaped contact value, so FR-2's widened guard stays green", () => {
    const json = JSON.stringify(jobFixtures);
    expect(json).not.toMatch(/\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/);
    expect(json).not.toMatch(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  });
});
