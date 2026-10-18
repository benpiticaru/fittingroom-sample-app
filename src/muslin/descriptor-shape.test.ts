// Compile-time pin (checked by `tsc -b`, which typechecks src/): the host descriptor core defines and
// adapter-msw publishes must satisfy the structural view the panel reads. If either drifts, typecheck fails.
import { describe, expect, it } from "vitest";
import type { HostDescriptor } from "@fitting-room/adapter-msw";
import type { HostDescriptorFile } from "@fitting-room/core";
import type { PanelHostDescriptor } from "@fitting-room/panel";

type Assert<T extends true> = T;
export type PublishedSatisfiesPanel = Assert<HostDescriptor<unknown> extends PanelHostDescriptor ? true : false>;
export type FileFieldsSatisfyPanel = Assert<HostDescriptorFile extends Omit<PanelHostDescriptor, "store"> ? true : false>;

export type GapsSatisfyPanel = Assert<NonNullable<HostDescriptor<unknown>["gaps"]> extends NonNullable<PanelHostDescriptor["gaps"]> ? true : false>;

describe("descriptor shape", () => {
  it("is pinned at compile time (see the type assertions above)", () => {
    expect(true).toBe(true);
  });
});
