import { describe, expect, it } from "vitest";
import { bellSamples } from "../src/lib/bell";

const peak = (s: Float32Array) => s.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

describe("the bell, rendered for an <audio> element", () => {
  it("rings about 9 s for one strike, three strikes 3.2 s apart for the end", () => {
    const one = bellSamples("start", "medium", 8000), end = bellSamples("end", "medium", 8000);
    expect(one.length / 8000).toBeCloseTo(9.1, 1);
    expect(end.length / 8000).toBeCloseTo(15.5, 1);
    expect(Math.abs(end[Math.round(3.25 * 8000)])).toBeGreaterThan(0); // the second strike
  });
  it("gets louder with the volume and never clips", () => {
    const soft = peak(bellSamples("start", "soft", 8000)), loud = peak(bellSamples("end", "loud", 8000));
    expect(soft).toBeLessThan(peak(bellSamples("start", "medium", 8000)));
    expect(loud).toBeLessThan(1);
    expect(peak(bellSamples("interval", "medium", 8000))).toBeLessThan(peak(bellSamples("start", "medium", 8000)));
  });
});
