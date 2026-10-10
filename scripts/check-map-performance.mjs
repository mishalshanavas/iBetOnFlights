import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(90000);
  const requests = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/api/")) requests.push(request.url()); });
  await page.addInitScript(() => localStorage.setItem("flightguard-preferences-v1", JSON.stringify({
    state: { mode: "demo", region: "central-europe" }, version: 0,
  })));
  const started = Date.now();
  await page.goto(process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /EGLL.*LHR/ }).waitFor();
  const shellMs = Date.now() - started;
  await page.waitForSelector('[data-map-ready="true"]');
  const mapMs = Date.now() - started;
  const initialRequests = [...requests];
  console.log("Map ready", { shellMs, mapMs });
  await page.locator(".maplibregl-canvas").evaluate(node => node.setAttribute("data-check-instance", "original"));
  await page.getByRole("button", { name: "Map layers · L", exact: true }).click();
  await page.getByLabel("Airport cloud forecasts").check();
  await page.getByLabel("Airport wind forecasts").check();
  await page.getByLabel("Airport temperatures").check();
  await page.getByRole("button", { name: "Close map layers" }).click();
  await page.waitForTimeout(2000);
  const weatherAirportsRequested = [...new Set(requests
    .filter(url => /\/api\/airports\/[^/]+\/weather/.test(url))
    .map(url => url.match(/\/airports\/([^/]+)\/weather/)[1]))];
  console.log("Forecast airports", weatherAirportsRequested.length);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Flights 128/ }).click();
  const renderedRows = await page.locator(".aircraft-list-row").count();
  await page.locator(".virtual-list").evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.getByRole("button", { name: /DEMO128/ }).waitFor();
  const canvasPreserved = await page.locator(".maplibregl-canvas").getAttribute("data-check-instance") === "original";
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/map-performance-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Airports", exact: true }).click();
  await page.getByRole("button", { name: /EGLL.*LHR/ }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "docs/screenshots/map-performance-desktop.png" });
  const report = { shellMs, mapMs, initialRequests, weatherAirportsRequested, renderedRows, canvasPreserved, mobileOverflow, errors };
  await writeFile("docs/screenshots/map-performance-check.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  expect(errors).toEqual([]);
  expect(canvasPreserved).toBe(true);
  expect(mobileOverflow).toBe(false);
  expect(renderedRows).toBeLessThan(30);
  expect(initialRequests.some(url => url.includes("/api/aircraft/live"))).toBe(false);
} finally {
  await browser.close();
}
