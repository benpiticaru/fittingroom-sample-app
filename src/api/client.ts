/**
 * Purpose: the API boundary. One real client, and the single build-time swap.
 * Responsibilities: expose JobsClient; resolve which client + config source the build uses.
 * Inputs: none. Outputs: JobsClient, HttpClient, resolveHost().
 * Dependencies: ./types, ./configSource, ../features/jobs/tableConfig.json. The muslin module is
 *   imported dynamically and ONLY under the statically-folded flag check.
 * Side Effects: HttpClient performs fetch calls.
 */
import baseConfig from "../features/jobs/tableConfig.json";
import { staticConfigSource } from "./configSource";
import type { ConfigSource } from "./configSource";
import type { Job, TableConfig } from "./types";

export interface JobsClient {
  list(): Promise<Array<{ id: string } & Job>>;
  get(id: string): Promise<Job | undefined>;
}

/** The real client. There is no server in v0, so these calls may 404. */
export class HttpClient implements JobsClient {
  constructor(private readonly baseUrl = "/api") {}

  async list(): Promise<Array<{ id: string } & Job>> {
    const res = await fetch(`${this.baseUrl}/jobs`);
    if (!res.ok) throw new Error(`GET ${this.baseUrl}/jobs failed: ${res.status}`);
    return (await res.json()) as Array<{ id: string } & Job>;
  }

  async get(id: string): Promise<Job | undefined> {
    const res = await fetch(`${this.baseUrl}/jobs/${id}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`GET ${this.baseUrl}/jobs/${id} failed: ${res.status}`);
    return (await res.json()) as Job;
  }
}

/**
 * @description Pick the client and config source for this build. The muslin
 *   also mounts the panel before returning.
 * @invariants In a production build `import.meta.env.VITE_FITTINGROOM` is the
 *   literal "0", so the branch folds to false and neither ./muslin nor any
 *   fixture module is reachable from the bundle.
 */
export async function resolveHost(): Promise<{ client: JobsClient; store: ConfigSource }> {
  if (import.meta.env.VITE_FITTINGROOM === "1") {
    const { muslinClient, muslinStore, mountPanel } = await import("./muslin");
    await mountPanel();
    return { client: muslinClient, store: muslinStore };
  }
  return { client: new HttpClient(), store: staticConfigSource(baseConfig as TableConfig) };
}
