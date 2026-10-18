/**
 * Purpose: the muslin's replacement for src/api/client.ts, swapped in by `fit muslin build` (muslin.aliases.api).
 * Responsibilities: export what client.ts exports (HttpClient, JobsClient, resolveHost) backed by fixtures, and
 *   publish the host descriptor so the panel can mount itself.
 * Inputs: ./descriptor.json. Outputs: HttpClient, JobsClient, resolveHost().
 * Dependencies: @fitting-room/adapter-msw, ../api/client (the real module, by its ordinary path), ./fixture-client.
 * Side Effects: publishes window.__fittingRoom at import time. Tests import config.ts / fixture-client.ts instead.
 * Live edit never writes this file: it is the muslin seam, listed in liveEdit.protect (.fitting-room/config.json).
 */
import { publishHostDescriptor } from "@fitting-room/adapter-msw";
import type { ConfigSource } from "../api/configSource";
import type { JobsClient } from "../api/client";
import descriptor from "./descriptor.json";
import { muslinClient, muslinGaps, muslinStore } from "./fixture-client";

export { HttpClient } from "../api/client";
export type { JobsClient } from "../api/client";

publishHostDescriptor(window, descriptor, muslinStore, { gaps: muslinGaps });

export async function resolveHost(): Promise<{ client: JobsClient; store: ConfigSource }> {
  return { client: muslinClient, store: muslinStore };
}
