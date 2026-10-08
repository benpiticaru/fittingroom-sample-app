/**
 * Purpose: the second view — one job, its technician and its parts.
 * Responsibilities: read-only detail render; missing values show an em dash.
 * Inputs: job + onBack. Outputs: a section element.
 * Dependencies: react, ../../api/types.
 * Side Effects: none.
 */
import type { Job } from "../../api/types";

const EM_DASH = "—";

export function JobDetail({ job, onBack }: { job: Job; onBack: () => void }) {
  return (
    <section>
      <button onClick={onBack}>Back to worklist</button>
      <h2>{job.reference}</h2>
      <dl>
        <dt>Customer</dt><dd>{job.customerName}</dd>
        <dt>Address</dt><dd>{job.address ?? EM_DASH}</dd>
        <dt>Status</dt><dd>{job.status}</dd>
        <dt>Opened</dt><dd>{job.openedYear}</dd>
        <dt>SLA hours remaining</dt><dd>{job.slaHoursRemaining}</dd>
        <dt>Technician</dt><dd>{job.technician?.displayName ?? EM_DASH}</dd>
      </dl>
      <h3>Parts</h3>
      {job.parts.length === 0 ? (
        <p>{EM_DASH}</p>
      ) : (
        <ul>
          {job.parts.map((p) => (
            <li key={p.sku}>{p.description}{p.onBackorder ? " (on backorder)" : ""}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
