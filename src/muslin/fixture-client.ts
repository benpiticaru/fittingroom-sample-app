/**
 * Purpose: the fixture-backed client and the live config store the muslin runs on.
 * Responsibilities: build `muslinClient` from the dispatcher fixtures, `muslinStore` from the merged config and
 *   `muslinGaps`, the gap layer the panel keeps (example values for fields the data does not have yet).
 * Inputs: none. Outputs: muslinClient, muslinStore, muslinGaps.
 * Dependencies: @fitting-room/adapter-msw, ../fixtures/dispatcher, ./config.
 * Side Effects: none at import. createFixtureClient sleeps 120ms per call by design.
 * Live edit never writes this file: it is part of the muslin seam, listed in liveEdit.protect (.fitting-room/config.json).
 */
import { createConfigStore, createFixtureClient, createGapStore } from "@fitting-room/adapter-msw";
import type { ConfigStore } from "@fitting-room/adapter-msw";
import type { GapLayer } from "@fitting-room/core";
import { jobFixtures } from "../fixtures/dispatcher";
import type { JobsClient } from "../api/client";
import type { TableConfig } from "../api/types";
import { muslinConfig } from "./config";

/** The gap layer the panel hands over; the empty layer when none is stored. "jobs" is this screen's endpoint (.fitting-room/config.json). */
export const muslinGaps: ConfigStore<GapLayer> = createGapStore(globalThis);

export const muslinClient: JobsClient = createFixtureClient(jobFixtures, 120, { gaps: muslinGaps, endpoint: "jobs" });

/** The live config the panel edits and ConfigProvider reads. */
export const muslinStore: ConfigStore<TableConfig> = createConfigStore(muslinConfig);
