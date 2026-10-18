/**
 * Purpose: the API boundary. One real client, and the single build-time swap.
 * Responsibilities: expose JobsClient; resolve the production client + config source.
 * Inputs: none. Outputs: JobsClient, HttpClient, resolveHost().
 * Dependencies: ./types, ./configSource, ../features/jobs/tableConfig.json. Nothing here knows the muslin exists.
 * Side Effects: HttpClient performs fetch calls.
 * Live edit never writes this file: it is the production half of the muslin seam (muslin.aliases.api swaps it at build time), listed in liveEdit.protect (.fitting-room/config.json).
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

/** The production client and the static base config. `fit muslin build` swaps this module for src/muslin/client.ts. */
export async function resolveHost(): Promise<{ client: JobsClient; store: ConfigSource }> {
  return { client: new HttpClient(), store: staticConfigSource(baseConfig as TableConfig) };
}
