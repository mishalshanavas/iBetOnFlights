import { describe, expect, it } from "vitest";
import { motionPosition, visualFlightOffset } from "@/lib/aviation/map-motion";
import { demoAircraft } from "@/data/demo";
const aircraft = { ...demoAircraft("central-europe")[0], latitude: 50, longitude: 5, heading: 90, velocity: 200, onGround: false };
describe("illustrative map motion", () => {
  it("keeps visible motion beyond the old observation limit with continuous turns", () => {
    for (const seconds of [0, 120, 600, 3600]) {
      const before = visualFlightOffset(seconds, 90), after = visualFlightOffset(seconds + 1, 90);
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(8);
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(15);
    }
    const cycle = 2 * Math.PI / .1;
    const before = visualFlightOffset(cycle - .001, 45), after = visualFlightOffset(cycle + .001, 45);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(.03);
    expect(after.rotation).toBeCloseTo(before.rotation, 2);
  });
  it("moves along reported heading without changing source coordinates", () => {
    const before = { ...aircraft }, position = motionPosition(aircraft, 60);
    expect(position[0]).toBeGreaterThan(5); expect(position[1]).toBeCloseTo(50, 3);
    expect(aircraft).toEqual(before);
    expect(motionPosition({ ...aircraft, heading: 0 }, 60)[1]).toBeGreaterThan(50);
  });
  it("caps extrapolation and holds ground or incomplete observations still", () => {
    expect(motionPosition(aircraft, 600)).toEqual(motionPosition(aircraft, 120));
    expect(motionPosition(aircraft, -5)[0]).toBeCloseTo(5);
    for (const item of [{ ...aircraft, onGround: true }, { ...aircraft, heading: null }, { ...aircraft, velocity: null }]) expect(motionPosition(item, 60)).toEqual([5, 50]);
  });
  it("wraps longitude safely across the date line", () => {
    const position = motionPosition({ ...aircraft, longitude: 179.99 }, 120);
    expect(position[0]).toBeGreaterThanOrEqual(-180); expect(position[0]).toBeLessThan(0);
  });
});
