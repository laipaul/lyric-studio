import { describe, expect, it } from "vitest";

import { hfWorkers, parseHfOutput } from "../src/node";

describe("HyperFrames workers", () => {
  it("one per core, bounded by memory, frames and 16", () => {
    expect(hfWorkers(939, { cpus: 4, memoryGB: 16 })).toBe(4);
    expect(hfWorkers(912, { cpus: 24, memoryGB: 31 })).toBe(10); // memory: 31 GB / 2 / 1.5
    expect(hfWorkers(912, { cpus: 32, memoryGB: 128 })).toBe(16);
    expect(hfWorkers(60, { cpus: 24, memoryGB: 64 })).toBe(2); // 30 frames each at least
    expect(hfWorkers(10, { cpus: 1, memoryGB: 2 })).toBe(1);
  });

  it("reads workers, capture, GPU and stage times from HyperFrames' output", () => {
    const out = [
      '[INFO] [Render:trace] {"phase":"worker_resolution","status":"checkpoint","message":"resolved","workerCount":4}',
      "  ████  80%  Streaming frame 939/939\r",
      "   12.7 MB · 31.3s video · rendered in 1m 34.5s",
      "   beginframe capture · software gpu · compile 0.4s · extract 0.3s · setup 11.0s · capture 1m 22.5s · encode (during capture) 1m 22.5s · assemble 0.1s",
    ].join("\n");
    expect(parseHfOutput(out)).toEqual({ workers: 4, capture: "beginframe", gpu: "software", setupS: 11, captureS: 82.5 });
    expect(parseHfOutput("nothing")).toEqual({ workers: null, capture: null, gpu: null, setupS: null, captureS: null });
  });
});
