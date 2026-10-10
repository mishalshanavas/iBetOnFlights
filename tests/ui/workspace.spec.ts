import { test,expect } from "@playwright/test";
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem("flightguard-preferences-v1",JSON.stringify({state:{mode:"demo",uiMode:"simple",region:"central-europe"},version:0}));});});
test("simple mode defers advanced requests and preserves the map when toggled",async({page})=>{
  const requests:string[]=[];page.on("request",r=>{if(r.url().includes("/api/"))requests.push(r.url());});
  await page.goto("/",{waitUntil:"domcontentloaded"});await expect(page.getByRole("button",{name:"Simple",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByTestId("aviation-map")).toHaveAttribute("data-map-ready","true",{timeout:60000});
  await expect(page.getByRole("button",{name:"Map layers · L",exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:"Play recorded snapshots"})).toHaveCount(0);
  expect(requests.some(url=>url.includes("/api/history")||url.includes("/api/analytics"))).toBe(false);
  await page.locator(".maplibregl-canvas").evaluate(node=>node.setAttribute("data-instance","preserved"));
  await page.getByRole("button",{name:"Advanced",exact:true}).click();await expect(page.getByRole("button",{name:"Map layers · L",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Play recorded snapshots"})).toBeVisible();
  await page.getByRole("button",{name:"Simple",exact:true}).click();await expect(page.locator(".maplibregl-canvas")).toHaveAttribute("data-instance","preserved");await expect(page.getByRole("button",{name:"Map layers · L",exact:true})).toHaveCount(0);
  await page.reload({waitUntil:"domcontentloaded"});await expect(page.getByRole("button",{name:"Simple",exact:true})).toHaveAttribute("aria-pressed","true");
});
test("map and airport panel render, search and layers operate",async({page})=>{
  await page.goto("/",{waitUntil:"domcontentloaded"});await expect(page.getByTestId("aviation-map")).toBeVisible();await expect(page.getByRole("heading",{name:/EGLL.*LHR/})).toBeVisible();
  await page.getByRole("button",{name:"Advanced",exact:true}).click();
  await page.getByRole("button",{name:"Map layers · L",exact:true}).click();await expect(page.getByText("TRAFFIC & GEOGRAPHY")).toBeVisible();const checkbox=page.getByLabel("Aircraft callsigns");await checkbox.check();await expect(checkbox).toBeChecked();
  await page.getByRole("button",{name:"Close map layers"}).click();await page.getByRole("button",{name:"Global search",exact:true}).click();await page.getByPlaceholder("Airport, callsign, or ICAO24…").fill("Schiphol");await page.getByRole("button",{name:/EHAM.*AMS/}).click();await expect(page.getByRole("heading",{name:/EHAM.*AMS/})).toBeVisible();
});
test("aircraft details retain fixture provenance and no fabricated itinerary",async({page})=>{
  await page.goto("/",{waitUntil:"domcontentloaded"});await page.getByRole("button",{name:/^Flights 128/}).click();expect(await page.locator(".aircraft-list-row").count()).toBeLessThan(30);await page.getByRole("button",{name:/DEMO001/}).click();await expect(page.getByRole("heading",{name:"DEMO001"})).toBeVisible();await expect(page.getByText("DEMO · SIMULATED",{exact:true})).toBeVisible();await expect(page.getByText("Itinerary not verified",{exact:true})).toBeVisible();
});
test("missing playback is clearly explained",async({page})=>{
  await page.route("**/api/history?**",route=>route.fulfill({json:{snapshots:[]}}));await page.goto("/",{waitUntil:"domcontentloaded"});await page.getByRole("button",{name:"Advanced",exact:true}).click();await page.getByRole("button",{name:"Play recorded snapshots"}).click();await expect(page.getByText(/No recorded history for this interval/)).toBeVisible();
});
test("manually entered flight options render as tickets and can be removed",async({page})=>{
  await page.goto("/flights",{waitUntil:"domcontentloaded"});await page.getByRole("button",{name:"Add candidate",exact:true}).click();
  await page.getByLabel("Flight number",{exact:true}).fill("FG101");await page.getByLabel("Operating airline",{exact:true}).fill("Example Air");await page.getByLabel("Known price (EUR, optional)").fill("125.50");
  await page.getByRole("button",{name:"Save candidate",exact:true}).click();await expect(page.getByRole("article",{name:"FLIGHT OPTION: EHAM to EDDF"})).toBeVisible();await expect(page.getByText("€125.50",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Delete candidate FG101"}).click();await expect(page.getByRole("article",{name:"FLIGHT OPTION: EHAM to EDDF"})).toHaveCount(0);
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
