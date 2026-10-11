import { test, expect } from "@playwright/test";
test("default map follows demo airport routes, supports speed and pause, and stops after arrival", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("flightguard-preferences-v1", JSON.stringify({ state: { mode: "demo", region: "central-europe", selectedAirport: null, sidebarOpen: false }, version: 0 })));
  await page.goto("/");
  const canvas = page.locator('[data-testid="aviation-map"] [data-testid="aircraft-motion"]');
  await expect(canvas).toBeVisible();
  const picture = () => canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL());
  const initial = await picture();
  await expect.poll(picture).not.toBe(initial);
  await page.getByLabel("Plane animation speed").selectOption("4");
  await expect(page.getByLabel("Plane animation speed")).toHaveValue("4");
  await page.getByRole("button", { name: "Pause plane animation", exact: true }).click();
  const paused = await picture(); await page.waitForTimeout(250);
  expect(await picture()).toBe(paused);
  await page.getByRole("button", { name: "Play plane animation", exact: true }).click();
  await expect.poll(picture).not.toBe(paused);
  // Advancing past the journey duration leaves flights at their airports, without looping.
  await page.clock.install();
  await page.getByLabel("Plane animation speed").selectOption("8");
  await page.clock.runFor(100);
  await page.clock.fastForward(40000);
  const arrived = await picture();
  await page.clock.fastForward(1000);
  expect(await picture()).toBe(arrived);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Plane animation speed")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
