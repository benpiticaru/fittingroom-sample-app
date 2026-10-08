/**
 * Purpose: the muslin side of the API boundary — fixtures and the overlay merge.
 * Responsibilities: build the fixture-backed client; merge the muslin overlay
 *   over the base config; wrap it in a live store; mount the panel. Reached
 *   ONLY through resolveHost()'s folded branch.
 * Inputs: none. Outputs: muslinClient, muslinConfig, muslinStore, mountPanel().
 * Dependencies: @fitting-room/adapter-msw, @fitting-room/panel (dynamic), ../fixtures/dispatcher, both config JSONs.
 * Side Effects: mountPanel() dynamically imports and mounts the panel into the DOM. createFixtureClient sleeps 120ms per call by design.
 * @invariants placeholderColumns exist only here, never in tableConfig.json.
 */
import { createConfigStore, createFixtureClient } from "@fitting-room/adapter-msw";
import type { ConfigStore } from "@fitting-room/adapter-msw";
import { jobFixtures } from "../fixtures/dispatcher";
import baseConfig from "../features/jobs/tableConfig.json";
import overlay from "../features/jobs/tableConfig.muslin.json";
import type { JobsClient } from "./client";
import type { TableConfig } from "./types";

export const muslinClient: JobsClient = createFixtureClient(jobFixtures);

export const muslinConfig: TableConfig = {
  ...(baseConfig as TableConfig),
  ...overlay,
};

/** The live config the panel edits and ConfigProvider reads. */
export const muslinStore: ConfigStore<TableConfig> = createConfigStore(muslinConfig);

/** Loads the panel lazily so it stays out of any chunk the host needs to boot. */
export async function mountPanel(): Promise<void> {
  const { mount } = await import("@fitting-room/panel");
  mount({ store: muslinStore });
}
