/**
 * Purpose: the data-heavy worklist table, rendered entirely from TableConfig.
 * Responsibilities: ordering, hiding, labels, density, display rules, placeholder columns.
 * Inputs: jobs + onSelect. Outputs: a table element.
 * Dependencies: react, ./ConfigProvider, ../../api/types.
 * Side Effects: none.
 */
import type { Job, TableConfig } from "../../api/types";
import { useTableConfig } from "./ConfigProvider";

const EM_DASH = "—";

function cellValue(job: Job, field: string): string {
  const raw = (job as unknown as Record<string, unknown>)[field];
  if (raw === undefined || raw === null || raw === "") return EM_DASH;
  if (field === "technician") return (raw as Job["technician"])!.displayName;
  if (Array.isArray(raw)) return raw.length ? String(raw.length) : EM_DASH;
  return String(raw);
}

function rowClass(job: Job, config: TableConfig): string {
  return config.displayRules
    .filter((rule) => rule.when === "negative" && Number((job as unknown as Record<string, unknown>)[rule.field]) < 0)
    .map((rule) => rule.style)
    .join(" ");
}

export function JobsTable({ jobs, onSelect }: { jobs: Job[]; onSelect: (job: Job) => void }) {
  const config = useTableConfig();
  const columns = config.columnOrder.filter((c) => !config.hiddenByDefault.includes(c));
  const placeholders = config.placeholderColumns ?? [];

  return (
    <table className={`jobs-table ${config.density}`} data-testid="jobs-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} scope="col" data-column-key={c}>{config.labels[c] ?? c}</th>
          ))}
          {placeholders.map((p) => (
            <th key={p.name} scope="col" className="placeholder" data-column-key={p.name}>{p.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {jobs.map((job, i) => (
          <tr key={job.reference} className={rowClass(job, config)} onClick={() => onSelect(job)}>
            {columns.map((c) => (
              <td key={c}>{cellValue(job, c)}</td>
            ))}
            {placeholders.map((p) => (
              <td key={p.name} className="placeholder">
                {p.sample?.length ? (
                  <>
                    <em>{p.sample[i % p.sample.length]}</em> <span className="example-tag">example</span>
                  </>
                ) : (
                  EM_DASH
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
