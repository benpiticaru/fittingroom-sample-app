/**
 * Purpose: load the `dispatcher` persona bundle (the beta's one built-in persona).
 * Responsibilities: read <personas>/dispatcher/*.json, validate it, expose the
 *   typed jobs fixture set the muslin client serves.
 * Inputs: personas/dispatcher/user.json and jobs.json.
 * Outputs: dispatcherBundle, jobFixtures, toJobFixtures.
 * Dependencies: @fitting-room/fixtures, ../api/types.
 * Side Effects: throws at module load if the bundle is not safe to show.
 */
import { assertPersonaBundle, defineFixtures } from "@fitting-room/fixtures";
import type { Fixture, FixtureSet, PersonaBundle } from "@fitting-room/fixtures";
import type { Job } from "../api/types";
import userJson from "./personas/dispatcher/user.json";
import jobsJson from "./personas/dispatcher/jobs.json";

export interface DispatcherUser {
  role: string;
  handle: string;
  displayName: string;
}

// JSON infers `synthetic: boolean`, so these casts are compile-time only; the
// runtime checks below (assertPersonaBundle, defineFixtures) back them.
const user = userJson as unknown as Fixture<DispatcherUser>;
const jobsEndpoint = jobsJson as unknown as Fixture<FixtureSet<Job>>;

/** Validates every nested record's synthetic flag via defineFixtures. */
export function toJobFixtures(endpoint: Fixture<FixtureSet<Job>>): FixtureSet<Job> {
  return defineFixtures<Job>(endpoint.data);
}

export const dispatcherBundle: PersonaBundle<DispatcherUser> = {
  name: "dispatcher",
  user,
  data: { jobs: jobsEndpoint },
};

assertPersonaBundle(dispatcherBundle);

export const jobFixtures: FixtureSet<Job> = toJobFixtures(jobsEndpoint);
