import { test,expect } from "@playwright/test";
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem("flightguard-preferences-v1",JSON.stringify({state:{mode:"demo",region:"central-europe"},version:0}));});});
test("map and airport panel render, search and layers operate",async({page})=>{
  await page.goto("/",{waitUntil:"domcontentloaded"});await expect(page.getByTestId("aviation-map")).toBeVisible();await expect(page.getByRole("heading",{name:/EGLL.*LHR/})).toBeVisible();
  await page.getByRole("button",{name:"Map layers · L",exact:true}).click();await expect(page.getByText("TRAFFIC & GEOGRAPHY")).toBeVisible();const checkbox=page.getByLabel("Aircraft callsigns");await checkbox.check();await expect(checkbox).toBeChecked();
  await page.getByRole("button",{name:"Close map layers"}).click();await page.getByRole("button",{name:"Global search",exact:true}).click();await page.getByPlaceholder("Airport, callsign, or ICAO24…").fill("Schiphol");await page.getByRole("button",{name:/EHAM.*AMS/}).click();await expect(page.getByRole("heading",{name:/EHAM.*AMS/})).toBeVisible();
});
test("aircraft details retain fixture provenance and no fabricated itinerary",async({page})=>{
  await page.goto("/",{waitUntil:"domcontentloaded"});await page.getByRole("button",{name:/^Flights 128/}).click();await page.getByRole("button",{name:/DEMO001/}).click();await expect(page.getByRole("heading",{name:"DEMO001"})).toBeVisible();await expect(page.getByText("DEMO · SIMULATED",{exact:true})).toBeVisible();await expect(page.getByText("Itinerary not verified",{exact:true})).toBeVisible();
});
test("missing playback is clearly explained",async({page})=>{
  await page.route("**/api/history?**",route=>route.fulfill({json:{snapshots:[]}}));await page.goto("/",{waitUntil:"domcontentloaded"});await page.getByRole("button",{name:"Play recorded snapshots"}).click();await expect(page.getByText(/No recorded history for this interval/)).toBeVisible();
});
test("compensation computes and saves deterministic result",async({page})=>{
  await page.goto("/compensation",{waitUntil:"domcontentloaded"});await page.getByLabel("Disruption reason").selectOption("airline");await page.getByLabel("Actual arrival delay").fill("180");await page.getByRole("button",{name:"Evaluate compensation"}).click();await expect(page.getByText("POTENTIALLY ELIGIBLE",{exact:true})).toBeVisible();await expect(page.getByText("€250",{exact:true}).first()).toBeVisible();
});
test("live provider failure never falls back silently to fixtures",async({page})=>{
  await page.route("**/api/aircraft/live?**",route=>route.fulfill({status:429,json:{error:{code:"RATE_LIMITED",message:"Quota exhausted",retryAfter:600}}}));await page.goto("/",{waitUntil:"domcontentloaded"});await page.getByRole("button",{name:"Connect live"}).click();await expect(page.getByText("Aircraft feed unavailable",{exact:true})).toBeVisible();await expect(page.getByText("Quota exhausted",{exact:true})).toBeVisible();await expect(page.getByText(/DEMO TRAFFIC · Simulated aircraft/)).toHaveCount(0);
});
test("mobile layout contains map and compensation form",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto("/",{waitUntil:"domcontentloaded"});await expect(page.getByTestId("aviation-map")).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();await page.goto("/compensation",{waitUntil:"domcontentloaded"});await expect(page.getByLabel("Origin airport")).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});
