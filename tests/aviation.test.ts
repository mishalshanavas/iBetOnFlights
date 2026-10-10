import { describe,it,expect,vi,afterEach } from "vitest";
import { normalizeState,boundsSchema,accessToken,clearToken } from "@/lib/providers/opensky";
import { weatherPoint } from "@/lib/providers/weather";
import { timedFetch,ProviderError } from "@/lib/providers/base";
import { distanceKm,feet,knots } from "@/lib/aviation/geo";
const row=["3c6444"," DLH123 ","Germany",1791700000,1791700000,8.5,50,10000,false,230,90,1,null,10100,"1234",false,0];
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();clearToken();});
describe("Surveillance normalization",()=>{
  it("keeps SI units and trims the callsign",()=>{const a=normalizeState(row)!;expect(a.callsign).toBe("DLH123");expect(a.baroAltitude).toBe(10000);expect(a.velocity).toBe(230);});
  it("rejects null or out-of-range coordinates",()=>{const v=[...row];v[5]=null;expect(normalizeState(v)).toBeNull();v[5]=200;expect(normalizeState(v)).toBeNull();});
  it("preserves missing callsigns",()=>{const v=[...row];v[1]="   ";expect(normalizeState(v)?.callsign).toBeNull();});
  it("invalidates missing or invalid headings",()=>{const v=[...row];v[10]=400;expect(normalizeState(v)?.heading).toBeNull();v[10]=null;expect(normalizeState(v)?.heading).toBeNull();});
  it("rejects malformed identifiers and oversized bounds",()=>{expect(normalizeState(["bad"])).toBeNull();expect(()=>boundsSchema.parse([-180,-90,180,90])).toThrow();expect(()=>boundsSchema.parse([5,50,2,53])).toThrow();});
  it("converts display units only",()=>{expect(feet(1000)).toBe("3,281");expect(knots(100)).toBe("194");expect(feet(null)).toBe("—");expect(distanceKm(0,0,0,1)).toBeCloseTo(111.195,2);});
});
describe("Provider safety",()=>{
  it("caches OAuth tokens and refreshes expiring tokens",async()=>{vi.stubEnv("OPENSKY_CLIENT_ID","test-client");vi.stubEnv("OPENSKY_CLIENT_SECRET","test-secret");const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({access_token:"first",expires_in:60}))).mockResolvedValueOnce(new Response(JSON.stringify({access_token:"second",expires_in:1800})));vi.stubGlobal("fetch",fetch);expect(await accessToken()).toBe("first");expect(await accessToken()).toBe("first");clearToken();expect(await accessToken()).toBe("second");expect(fetch).toHaveBeenCalledTimes(2);});
  it("deduplicates concurrent token requests",async()=>{vi.stubEnv("OPENSKY_CLIENT_ID","test");vi.stubEnv("OPENSKY_CLIENT_SECRET","test");const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({access_token:"one",expires_in:1800})));vi.stubGlobal("fetch",fetch);expect(await Promise.all([accessToken(),accessToken()])).toEqual(["one","one"]);expect(fetch).toHaveBeenCalledTimes(1);});
  it("returns an explicit timeout error",async()=>{vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new DOMException("timeout","TimeoutError")));await expect(timedFetch("https://example.test")).rejects.toMatchObject({code:"TIMEOUT",status:504});});
  it("weather keeps nulls and UTC timestamps",()=>{const p=weatherPoint({time:"2026-10-11T12:00",temperature_2m:12,wind_speed_10m:4},10000);expect(p.validAt).toBe("2026-10-11T12:00Z");expect(p.windSpeed).toBe(4);expect(p.visibility).toBe(10000);expect(p.precipitation).toBeNull();});
});
