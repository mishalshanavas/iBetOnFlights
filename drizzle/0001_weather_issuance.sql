-- Upgrade early development databases: an API retrieval timestamp is not model issuance.
-- Initialization checks the column layout before applying this upgrade once.
ALTER TABLE airport_weather RENAME COLUMN forecastIssuedAt TO forecastRetrievedAt;
ALTER TABLE airport_weather ADD COLUMN forecastIssuedAt INTEGER;
