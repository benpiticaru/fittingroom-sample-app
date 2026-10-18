/**
 * Purpose: the API types fixtures are checked against and the table renders.
 * Responsibilities: shape only — no logic, no I/O.
 * Inputs/Outputs: none (type-only module).
 * Dependencies: none.
 * Side Effects: none.
 */

export type JobStatus = "scheduled" | "dispatched" | "on-site" | "blocked" | "complete";
export type Priority = "low" | "normal" | "high";

export interface Part {
  sku: string;
  description: string;
  onBackorder: boolean;
}

export interface Technician {
  /** Synthetic handle, never a real contact value. */
  handle: string;
  displayName: string;
  /** Jobs already on this technician's board for the same window. */
  concurrentJobs: number;
}

export interface Job {
  reference: string;
  status: JobStatus;
  priority: Priority;
  customerName: string;
  /** Absent for a job raised without a site address — a declared fixture edge. */
  address?: string;
  /** Year only, per Constraint A. */
  openedYear: number;
  /** Hours remaining against the SLA; negative means overdue. */
  slaHoursRemaining: number;
  technician?: Technician;
  parts: Part[];
}

/** One entry of the muslin-only placeholder overlay. Mirrors PlaceholderColumn in @fitting-room/core. */
export interface PlaceholderColumn {
  name: string;
  label: string;
  /** Illustrative values, cycled per row. Absent: the cell shows an em dash. */
  sample?: string[];
}

export interface TableConfig {
  columnOrder: string[];
  hiddenByDefault: string[];
  defaultSort: { field: string; direction: "asc" | "desc" };
  defaultFilter: { field: string; value: string } | null;
  displayRules: Array<{ field: string; when: string; style: string }>;
  labels: Record<string, string>;
  density: "comfortable" | "compact";
  /** Present only on the merged muslin config, never in tableConfig.json. */
  placeholderColumns?: PlaceholderColumn[];
}
