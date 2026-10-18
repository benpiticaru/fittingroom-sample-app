// The panel and adapter-msw each keep their own copy of these constants (the panel may not import the
// adapter at runtime); this pins the copies equal, so the panel's write and the host's read meet.
import { describe, expect, it } from "vitest";
import { GAPS_KEY as adapterKey, HOST_EVENT as adapterEvent } from "@fitting-room/adapter-msw";
import { GAPS_KEY as panelKey, HOST_EVENT as panelEvent } from "@fitting-room/panel";

describe("panel and adapter-msw constants", () => {
  it("share the gaps storage key", () => {
    expect(adapterKey).toBe("fitting-room:gaps");
    expect(panelKey).toBe(adapterKey);
  });

  it("share the host event name", () => {
    expect(adapterEvent).toBe("fittingroom:host");
    expect(panelEvent).toBe(adapterEvent);
  });
});
