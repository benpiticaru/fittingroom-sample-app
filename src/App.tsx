/**
 * Purpose: the two-view shell — worklist and detail.
 * Responsibilities: view switching and data loading. No config decisions.
 * Inputs: a JobsClient and a ConfigSource. Outputs: the app tree.
 * Dependencies: react, ./api/client, ./features/jobs/*.
 * Side Effects: calls client.list() on mount.
 */
import { useEffect, useState } from "react";
import type { JobsClient } from "./api/client";
import type { ConfigSource } from "./api/configSource";
import type { Job } from "./api/types";
import { ConfigProvider } from "./features/jobs/ConfigProvider";
import { JobsTable } from "./features/jobs/JobsTable";
import { JobDetail } from "./features/jobs/JobDetail";

export function App({ client, store }: { client: JobsClient; store: ConfigSource }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .list()
      .then(setJobs)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [client]);

  return (
    <ConfigProvider store={store}>
      <h1>Dispatch worklist</h1>
      {error ? <p role="alert">Could not load jobs: {error}</p> : null}
      {selected ? (
        <JobDetail job={selected} onBack={() => setSelected(null)} />
      ) : (
        <JobsTable jobs={jobs} onSelect={setSelected} />
      )}
    </ConfigProvider>
  );
}
