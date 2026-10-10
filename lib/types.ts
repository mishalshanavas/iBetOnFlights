export interface Airport {
  icao: string; iata: string; name: string; city: string; country: string; countryCode: string;
  latitude: number; longitude: number; elevationFt: number; timezone: string;
}
export interface Aircraft {
  icao24: string; callsign: string | null; originCountry: string | null;
  latitude: number; longitude: number; baroAltitude: number | null; geoAltitude: number | null;
  velocity: number | null; heading: number | null; verticalRate: number | null;
  onGround: boolean; timePosition: number | null; lastContact: number;
  squawk: string | null; spi: boolean; positionSource: number | null;
}
export interface SourceMeta {
  provider: string; status: "recent" | "cached" | "historical" | "unavailable" | "demo";
  observedAt: number | null; retrievedAt: number; message?: string;
}
export interface AircraftResponse {
  aircraft: Aircraft[]; source: SourceMeta; region: string;
  pollSeconds: number; quotaRemaining: number | null; snapshotId?: number;
  storageWarning?: string;
}
export interface WeatherPoint {
  validAt: string; temperature: number | null; humidity: number | null;
  windSpeed: number | null; windDirection: number | null; windGust: number | null;
  precipitation: number | null; cloudCover: number | null; pressure: number | null;
  visibility: number | null; code: number | null;
}
export interface WeatherResponse {
  airport: string; current: WeatherPoint; hourly: WeatherPoint[]; source: SourceMeta;
}
export interface RadarResponse {
  host: string; frames: {time: number; path: string}[]; source: SourceMeta;
}
export interface Snapshot {
  id: number; region: string; observedAt: number; count: number;
}
export interface Watchlist {
  id: number; targetType: "airport" | "aircraft" | "route" | "flight";
  targetId: string; settings: string; createdAt: number;
}
export interface Alert {
  id: number; watchlistId: number; severity: string; title: string;
  description: string; eventTimestamp: number; acknowledgedAt: number | null;
}
export interface Flight {
  id: string; flightNumber: string; callsign: string | null; operatingAirline: string | null;
  originIcao: string; destinationIcao: string; aircraftIcao24: string | null;
  scheduledDeparture: number; scheduledArrival: number; actualDeparture: number | null;
  actualArrival: number | null; estimatedArrival: number | null; status: string;
  source: string; updatedAt: number;
}
