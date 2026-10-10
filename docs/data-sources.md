# Data sources and provenance

| Data | Source | Timestamp meaning | Cache / availability |
| --- | --- | --- | --- |
| Aircraft position | [OpenSky state vectors](https://openskynetwork.github.io/opensky-api/rest.html) | `time_position` is last position observation; `last_contact` is last surveillance contact; response time identifies collection snapshot. | 120-second default regional cache, 300-second maximum position age. OAuth2 optional; anonymous IP quota. |
| Airport weather | [Open-Meteo Forecast API](https://open-meteo.com/en/docs) | `validAt` is forecast valid time. Server retrieval time is not model issuance time. Visibility uses nearest hourly forecast. | 15-minute cache. SI wind speeds, degrees, metres, millimetres, hPa, percent. |
| Radar tiles | [RainViewer Weather Maps](https://www.rainviewer.com/api/weather-maps-api.html) | Frame generation timestamp, not necessarily every underlying radar observation timestamp. Only past radar frames are used. | Five-minute metadata cache; max native zoom 7; best-effort coverage. |
| Basemap | [CARTO](https://carto.com/basemaps) / [OpenStreetMap](https://www.openstreetmap.org/copyright) | Base-map revision differs from aviation observation time. | Browser tile cache; attribution visible. |
| Airport metadata | Curated WGS84 coordinates and identifiers | Static curated reference; not live operational status. | Local dataset. Confirm against authorized charts for aviation use. |
| Commercial flights | Operator-imported authorized records | Schedule/actual fields as provided, with explicit source and updated time. | No live adapter configured. Surveillance identities never establish itineraries. |
| Predictions | Operator-trained LightGBM | Exported model version, evaluation periods, inference time, input snapshot time. | Disabled without a compatible model. |
| NOTAM, METAR, TAF, EUROCONTROL operations | No connected authorized provider | No observations available. | Explicitly unavailable; no restricted scraping. |

OpenSky's geographic cost is based on bounding-box area. Six selected regions limit collection scope; a displayed count is **retrieved aircraft in that coverage**, never total European flights. Polling pauses for historical and demo traffic. HTTP 429 responses expose retry timing; authentication secrets remain in server memory. Persistent caches share successful provider results between serverless instances; OAuth tokens and in-flight promises are process-local.

Operational analytics count observations within 75 km of an airport. This is a proximity metric, not an arrival count, movement count, capacity measurement, or verified congestion measure. Overlapping region snapshots are distinct samples and can have similar timestamps. The UI displays sample sizes and definitions.

Layers labelled airport forecasts represent point values around airport coordinates. The cloud display is a soft point indicator, wind values are point forecasts, and temperatures are measured/modelled numerical forecast inputs. They are not continuous satellite or weather grids. Radar remains a separate raster source with separate timestamp controls.

If providers fail, that source reports unavailable and independent services continue. A live error never swaps to fixtures. Demonstration positions use `DEMO...` callsigns and a fixed source timestamp; no fictional weather, NOTAM, legal approval, itinerary, or ML output is produced.

Public API terms must be reviewed before commercial use. [RainViewer terms](https://www.rainviewer.com/api.html) require visible credit and target personal, educational, and small community use. [Open-Meteo terms](https://open-meteo.com/en/terms) distinguish non-commercial public access from commercial licensing.
