import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
export const airportsTable = sqliteTable("airports", {icao:text().primaryKey(),iata:text().notNull(),name:text().notNull(),city:text().notNull(),countryCode:text().notNull(),latitude:real().notNull(),longitude:real().notNull(),elevationFt:integer().notNull(),timezone:text().notNull()});
export const aircraftTable = sqliteTable("aircraft", {icao24:text().primaryKey(),registration:text(),aircraftType:text(),manufacturer:text(),operator:text(),lastSeen:integer().notNull()});
export const snapshots = sqliteTable("snapshots", {id:integer().primaryKey({autoIncrement:true}),region:text().notNull(),observedAt:integer().notNull(),count:integer().notNull()}, t => [uniqueIndex("snapshot_region_time").on(t.region,t.observedAt)]);
export const positions = sqliteTable("aircraft_positions", {
  id:integer().primaryKey({autoIncrement:true}),snapshotId:integer().notNull(),icao24:text().notNull(),callsign:text(),
  latitude:real().notNull(),longitude:real().notNull(),altitudeM:real(),groundSpeedMs:real(),headingDeg:real(),
  verticalRateMs:real(),onGround:integer({mode:"boolean"}).notNull(),observedAt:integer().notNull(),
  ingestedAt:integer().notNull(),source:text().notNull(),data:text().notNull()
},t=>[uniqueIndex("position_snapshot_aircraft").on(t.snapshotId,t.icao24),index("position_aircraft_time").on(t.icao24,t.observedAt),index("position_time").on(t.observedAt)]);
export const flights = sqliteTable("flights", {
  id:text().primaryKey(),flightNumber:text().notNull(),callsign:text(),operatingAirline:text(),originIcao:text().notNull(),destinationIcao:text().notNull(),
  aircraftIcao24:text(),scheduledDeparture:integer().notNull(),scheduledArrival:integer().notNull(),actualDeparture:integer(),actualArrival:integer(),
  estimatedArrival:integer(),status:text().notNull(),source:text().notNull(),updatedAt:integer().notNull()
},t=>[index("flight_route").on(t.originIcao,t.destinationIcao),index("flight_schedule").on(t.scheduledDeparture)]);
export const weather = sqliteTable("airport_weather", {
  id:integer().primaryKey({autoIncrement:true}),airportIcao:text().notNull(),validAt:text().notNull(),temperatureC:real(),windSpeedMs:real(),windDirection:real(),
  windGustMs:real(),precipitationMm:real(),visibilityM:real(),cloudCoverPct:real(),pressureHpa:real(),forecastIssuedAt:integer(),forecastRetrievedAt:integer().notNull(),ingestedAt:integer().notNull(),source:text().notNull(),data:text().notNull()
},t=>[uniqueIndex("weather_airport_valid_issued").on(t.airportIcao,t.validAt,t.forecastRetrievedAt),index("weather_airport_time").on(t.airportIcao,t.validAt)]);
export const predictions = sqliteTable("predictions", {id:integer().primaryKey({autoIncrement:true}),flightId:text(),modelVersion:text().notNull(),predictedAt:integer().notNull(),probability30:real().notNull(),probability60:real().notNull(),probability180:real().notNull(),expectedDelayMin:real(),featureSnapshotJson:text().notNull(),sourceDataTimestamp:integer()});
export const assessments = sqliteTable("compensation_assessments", {id:integer().primaryKey({autoIncrement:true}),flightId:text(),assessedAt:integer().notNull(),regulationVersion:text().notNull(),eligibilityStatus:text().notNull(),potentialAmountEur:integer().notNull(),knownDisruptionCause:text().notNull(),missingEvidenceJson:text().notNull(),explanation:text().notNull(),inputJson:text().notNull(),resultJson:text().notNull()});
export const notams = sqliteTable("notams", {id:text().primaryKey(),notamNumber:text().notNull(),airportIcao:text().notNull(),rawText:text().notNull(),category:text().notNull(),effectiveStart:integer().notNull(),effectiveEnd:integer(),fetchedAt:integer().notNull(),source:text().notNull()});
export const watchlists = sqliteTable("watchlists", {id:integer().primaryKey({autoIncrement:true}),targetType:text().notNull(),targetId:text().notNull(),settings:text().notNull().default("{}"),createdAt:integer().notNull()},t=>[uniqueIndex("watchlist_target").on(t.targetType,t.targetId)]);
export const alerts = sqliteTable("alerts", {id:integer().primaryKey({autoIncrement:true}),watchlistId:integer().notNull(),severity:text().notNull(),title:text().notNull(),description:text().notNull(),eventTimestamp:integer().notNull(),acknowledgedAt:integer()},t=>[index("alert_watchlist_time").on(t.watchlistId,t.eventTimestamp)]);
export const ingestionRuns = sqliteTable("ingestion_runs", {id:integer().primaryKey({autoIncrement:true}),source:text().notNull(),startedAt:integer().notNull(),completedAt:integer(),status:text().notNull(),recordCount:integer().notNull().default(0),errorSummary:text()});
export const dataSources = sqliteTable("data_sources", {id:text().primaryKey(),providerName:text().notNull(),sourceType:text().notNull(),lastSuccessAt:integer(),accessStatus:text().notNull(),message:text()});
export const cache = sqliteTable("provider_cache", {key:text().primaryKey(),value:text().notNull(),expiresAt:integer().notNull()});
