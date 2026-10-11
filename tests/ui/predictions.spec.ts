import { test, expect } from "@playwright/test";
const risk = { probability30: .3, probability60: .1, probability180: .01, cohortSamples: 200, method: "caa-published-punctuality-v1", source: "Test fixture", direction: "arrival", limitations: "Test fixture only." };
function board(date: string) {
  const stamp = Date.parse(`${date}T10:00:00Z`) / 1000;
  const flight = { id: "fixture-delay", flightNumber: "TEST101", operatingAirline: "TEST", originIcao: "EHAM", destinationIcao: "EGLL", scheduledDeparture: stamp, scheduledArrival: stamp + 7200, aircraftIcao24: null, status: "scheduled", source: "Test fixture", updatedAt: stamp - 86400 };
  return { date, timezone: "UTC", total: 2, offset: 0, nextOffset: null, asOf: stamp - 86400, policy: { delay: .2, cancellation: .1 }, coverage: "Test fixtures only", limitations: "Test fixtures only", source: { provider: "Test fixture", configured: true, message: "Test fixture" }, flights: [
    { flight, prediction: risk, flag: "delay", reasons: ["Historical delay rate: 30% of 200 test movements. Future cause unknown."], error: null },
    { flight: { ...flight, id: "fixture-cancel", flightNumber: "TEST202", destinationIcao: "EGKK" }, prediction: { ...risk, cancellationRate: .2 }, flag: "cancellation", reasons: ["Historical cancellation rate: 20%. This is not a reported cancellation."], error: null },
  ] };
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("flightguard-preferences-v1", JSON.stringify({ state: { mode: "demo" }, version: 0 })));
  await page.route("https://basemaps.cartocdn.com/**/style.json", route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#15191f" } }] } }));
});
test("daily cards distinguish delay/cancellation risk, explain it and carry routes to the map", async ({ page }) => {
  await page.route("**/api/schedule/day?**", route => route.fulfill({ json: board(new URL(route.request().url()).searchParams.get("date")!) }));
  await page.goto("/predictions");
  await expect(page.getByRole("tab", { name: "Delayed", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("outlook-ticket")).toHaveCount(2);
  const delay = page.getByTestId("outlook-ticket").first(), cancel = page.getByTestId("outlook-ticket").last();
  await expect(delay.locator(".outlook-status")).toHaveText("Delay risk");
  await expect(cancel.locator(".outlook-status")).toHaveText("Cancellation risk");
  expect(await delay.evaluate(el => getComputedStyle(el).borderLeftColor)).toBe("rgb(255, 155, 69)");
  expect(await cancel.evaluate(el => getComputedStyle(el).borderLeftColor)).toBe("rgb(244, 107, 117)");
  await delay.getByText("Why this flag?", { exact: true }).click();
  await expect(delay.getByText(/Future cause unknown/)).toBeVisible();
  await delay.getByRole("button", { name: "Show route" }).click();
  await expect(delay.getByRole("button", { name: "All routes" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("prediction-route-map")).toHaveAttribute("data-map-ready", "true");
  await page.getByRole("link", { name: "Open full map" }).click();
  await expect(page.getByTestId("aviation-map")).toHaveAttribute("data-map-ready", "true", { timeout: 30000 });
  await expect(page.locator(".prediction-map-banner")).toContainText("2 connections");
  await page.getByRole("button", { name: "Clear routes", exact: true }).click();
  await expect(page.locator(".prediction-map-banner")).toHaveCount(0);
});
test("changing the selected day loads that day and keeps mobile layout within the screen", async ({ page }) => {
  const dates: string[] = [];
  await page.route("**/api/schedule/day?**", route => { const date = new URL(route.request().url()).searchParams.get("date")!; dates.push(date); return route.fulfill({ json: date === "2026-11-01" ? { ...board(date), total: 0, flights: [] } : board(date) }); });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/predictions");
  await expect(page.getByTestId("outlook-ticket")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("Flight day", { exact: true }).fill("2026-11-01");
  await expect(page.getByRole("heading", { name: "No available flights for this day" })).toBeVisible();
  await expect(page.getByTestId("outlook-ticket")).toHaveCount(0); expect(dates).toContain("2026-11-01");
});
test("itinerary fetches weather automatically and a late response cannot overwrite changed inputs", async ({ page }) => {
  await page.route("**/api/schedule/day?**", route => route.fulfill({ json: { ...board("2026-10-11"), total: 0, flights: [] } }));
  await page.route("**/api/schedule/flights?**", route => route.fulfill({ json: { publishedRoutes: [], status: {} } }));
  let release!: () => void, received!: () => void;
  const gate = new Promise<void>(resolve => release = resolve), requestReceived = new Promise<void>(resolve => received = resolve);
  await page.route("**/api/schedule/context", async route => {
    expect(Object.keys(route.request().postDataJSON())).toEqual(["itinerary"]);
    received(); await gate;
    const forecast = { status: "unavailable", point: null, source: null, message: "Test fixture unavailable." };
    await route.fulfill({ json: { prediction: risk, predictionError: null, weather: { departure: forecast, arrival: forecast } } });
  });
  await page.goto("/predictions"); await page.getByRole("tab", { name: "Check a flight" }).click();
  await expect(page.getByLabel(/Gust alert threshold|Precipitation alert threshold/)).toHaveCount(0);
  await page.getByRole("button", { name: "Get flight outlook" }).click(); await requestReceived;
  await page.getByLabel("From", { exact: true }).selectOption("EDDF"); release();
  await expect(page.getByRole("button", { name: "Get flight outlook" })).toBeEnabled();
  await expect(page.locator(".itinerary-risk-grid")).toHaveCount(0);
  await expect(page.locator(".itinerary-weather")).toHaveCount(0);
});
