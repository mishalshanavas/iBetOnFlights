import { describe, expect, it } from "vitest";
import { motionPosition } from "@/lib/aviation/map-motion";
import { routePosition, type Coordinate } from "@/lib/aviation/flight-path";
import { findAirport } from "@/data/airports";
import { demoAircraft } from "@/data/demo";
const aircraft = { ...demoAircraft("central-europe")[0], latitude: 50, longitude: 5, heading: 90, velocity: 200, onGround: false };
describe("illustrative map motion", () => {
  it("follows waypoints by distance and stays at the destination after landing", () => {
    const path: Coordinate[] = [[0, 0], [1, 0], [1, 3]];
    expect(routePosition(path, 0)).toEqual([0, 0]);
    expect(routePosition(path, .25)[0]).toBeCloseTo(1);
    expect(routePosition(path, .5)[1]).toBeCloseTo(1);
    expect(routePosition(path, 1)).toEqual([1, 3]);
    expect(routePosition(path, 10)).toEqual([1, 3]);
    expect(path).toEqual([[0, 0], [1, 0], [1, 3]]);
    expect(Math.abs(routePosition([[179, 0], [-179, 0]], .5)[0])).toBeCloseTo(180);
    expect(routePosition([[1, 2], [1, 2]], .5)).toEqual([1, 2]);
  });
  it("demo flight paths terminate at their named airport, without assigning live destinations", () => {
    for (const flight of demoAircraft("central-europe")) {
      const route = flight.animationRoute!, destination = findAirport(route.destinationIcao)!;
      expect(routePosition(route.coordinates, 1)).toEqual([destination.longitude, destination.latitude]);
      expect(routePosition(route.coordinates, route.progress)).toEqual([flight.longitude, flight.latitude]);
      expect(route.originIcao).not.toBe(route.destinationIcao);
      expect(route.source).toBe("demo");
    }
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
