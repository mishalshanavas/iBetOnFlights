# FlightGuard ATC Intelligence

A map-first European aviation intelligence workspace built with Next.js App Router, TypeScript, MapLibre, Tailwind, Radix/shadcn-style primitives, Zustand, TanStack Query, Drizzle, and SQLite/libSQL. The interface follows the supplied aviation operations reference: charcoal panels, compact telemetry, contextual airport details, real radar, a map toolbar, and recorded-snapshot playback.

## Run locally

Requirements: Node 22.12+ and npm. Python is needed only for offline model training.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:3000. SQLite is created and seeded on the first database request. `npm run db:migrate` also initializes it explicitly. CLI tools read shell environment variables; Next.js automatically reads `.env.local`. For hosted CLI migrations, set `DATABASE_URL` and `DATABASE_AUTH_TOKEN` in your shell without committing them.

The initial workspace uses **live mode**. If OpenSky is unavailable, the map shows the provider error and an explicit **Explore demo** action. Demo aircraft use fixed, clearly labelled synthetic fixtures and are never saved to the recording database. Forecasts and radar are actual provider responses in both modes. No automatic fallback to fictional live traffic occurs.

## What works

- Interactive MapLibre map with dark/light CARTO/OpenStreetMap basemaps, regional coverage boundaries, aircraft symbol layers, heading rotation, safe hover tooltips, selectable airports, and selectable aircraft.
- Regional OpenSky queries, anonymous access or server-side OAuth2 client credentials, token caching, deduplicated requests, quota responses, retries, timeouts, 120-second default polling, and source timestamps. Positions older than five minutes are excluded from new collections.
- Real Open-Meteo airport forecasts, weather features and a twelve-hour table. All forecast fields are labelled as modelled weather, rather than official METAR reports.
- Timestamped RainViewer past radar frames, opacity, independent radar playback, and visible provider attribution. Forecast cloud/wind/temperature overlays are airport-point visualizations, not radar or continuous weather grids.
- Airport details, genuine nearby surveillance counts (75 km geodesic radius), flight and airport search, sorting, resizable desktop sidebar, mobile drawer, measurement, fullscreen, and keyboard shortcuts.
- SQLite recording, deduplicated position snapshots, recent aircraft tracks, regional/date-based playback, speed selection, previous/next, and configurable position retention. No recordings are fabricated for periods before collection starts.
- Date-versioned deterministic EU261 calculator with geographic scope, carrier jurisdiction, cancellation notice, rerouting, ticket category, extraordinary-circumstances evidence, reductions, and saved assessment history.
- Imported commercial schedules, local manually entered flight candidates and prices, route comparison, recorded traffic analytics, and route reliability from actual scheduled/arrival labels.
- SQLite-backed watchlists and in-app airport forecast alerts while the browser is open. Aircraft/route/flight targets can be saved; their commercial status alerts require a provider.
- Offline LightGBM training and calibration with chronological partitions, feature validation, future-data checks, baseline comparisons, calibration plots, per-airport metrics, and serverless TypeScript inference from exported numeric trees.

## Integrations that require your data or access

| Integration | Available without credentials | Requirements / limits |
| --- | --- | --- |
| OpenSky surveillance | Anonymous requests, subject to IP quotas | OAuth2 API client improves available quota. Set `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` on the server. |
| Open-Meteo | Yes, non-commercial public API | Forecast data only. Review provider licensing before commercial launch. |
| RainViewer | Yes, personal/educational/small community API | Best-effort radar, variable coverage, max native zoom 7. Attribution required. Commercial/high-volume usage needs provider terms. |
| CARTO / OpenStreetMap map | Public basemap | Preserve attribution; review terms before large commercial deployment. Custom style through `NEXT_PUBLIC_MAP_STYLE_URL`. |
| Turso | Requires your database | SQLite-compatible hosted persistence; verify current account limits. |
| Official NOTAM / EUROCONTROL | No authorized integration connected | Provider interfaces and explicit unavailable states; no restricted-service scraping. |
| Official METAR/TAF | Not connected | Separate abstraction; forecast fields are never represented as official observations. |
| Commercial flight status | No live provider connected | Import sourced records using `npm run data:import -- records.json`; API key variable reserved for a future authorized adapter. |
| Delay predictions | No pretrained model shipped | Supply genuine labelled records, run the offline pipeline, and place `model.json` under `ml/models/`. |

No validated European prediction model, official NOTAM feed, or verified live commercial itinerary is bundled. Their unavailable states are intentional. The system does not derive schedules, airline responsibility, runway closures, or cancellation causes from surveillance data.

## Data and recording

SQLite/libSQL is the only application database. Schema: `lib/db/schema.ts`; idempotent initial migration: `drizzle/0000_initial.sql`. Records include airports, aircraft, snapshots, positions, flights, forecasts, predictions, compensation assessments, NOTAMs, watchlists, alerts, ingestion/source metadata, and shared provider caches. SQL is parameterized through Drizzle.

Recording is request-driven; there is no permanent backend or ingestion daemon. Default retention is 48 hours, configurable from 1–168 hours through `POSITION_RETENTION_HOURS`; expired snapshots and associated positions are removed after successful live ingestion. Weather history is retained for seven days. Provider caches are shared through SQLite with an additional process-local cache and in-flight request deduplication. Process-level OAuth tokens never reach the browser or database.

For research exports:

```powershell
npm run data:export -- positions.json
python ml/export_parquet.py positions.json positions.parquet
```

Optional research output is local; deployed persistence must use Turso. Detailed provenance and limits are in [docs/data-sources.md](docs/data-sources.md).

## Commercial flight import

`npm run data:import -- <records.json>` accepts a JSON array of genuine, authorized records. Required fields: `id`, `flightNumber`, `originIcao`, `destinationIcao`, `scheduledDeparture`, `scheduledArrival`, `status`, `source`, `updatedAt`. Times are Unix seconds. Optional nullable fields: `callsign`, `operatingAirline`, `aircraftIcao24`, `actualDeparture`, `actualArrival`, `estimatedArrival`. Airports must exist in the curated dataset, and arrival must follow departure. Source strings must identify the actual provider or dataset. An import does not verify provenance automatically; the operator is responsible for authorized, correctly labelled data.

Manual comparison candidates and ticket prices are saved only to browser localStorage, labelled **manually entered**, and kept separate from imported schedules. No ticket prices are generated.

## Train a real delay model

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r ml/requirements.txt
python ml/train.py --dataset ml/datasets/flights.csv --output ml/models
```

Add `--european-evaluation` only when the held-out sample genuinely contains documented European flight records. The pipeline rejects that declaration if test rows are not marked Europe. Dataset schema, acquisition guidance, evaluation, and limitations are in [docs/model-evaluation.md](docs/model-evaluation.md). No training data or made-up metrics are included.

Inference uses exported LightGBM numeric decision trees with the exact same calibrated scoring as Python. A parity check verifies exported raw scores against LightGBM before export. JSON inference avoids native ONNX runtime constraints in serverless deployments; a native ONNX runtime is unnecessary for the MVP. A regression/quantile model and SHAP output are not included, so those panels do not manufacture estimates.

## Passenger-rights rule versions

- Flights before 23 October 2027: Regulation (EC) 261/2004 with applicable arrival-delay case-law interpretation.
- Flights from 23 October 2027: Regulation (EU) 2026/2202 amendment; date-specific thresholds, cancellation exceptions, and reductions.
- UK and Swiss domestic rights are outside this engine's EU/EEA scope. The curated dataset includes these airports without treating their countries as EU members.
- Results are preliminary, evidence-dependent guidance. The form never issues `CONFIRMED_ELIGIBLE`. Full journeys with connecting-flight rerouting, denied boarding, complex territorial exceptions, and national limitation periods need a separate assessment.

Authoritative sources and implemented boundaries: [docs/compensation-rules.md](docs/compensation-rules.md).

## Validation

```powershell
npm run typecheck
npm test
python -m unittest discover -s ml -p test_*.py
npm run test:ui
```

Playwright needs its matching browser installed (`npx playwright install chromium`) if none is present. UI tests start or reuse the local development server. Provider tests use fixtures and mocks; they do not consume a large live quota. To create a production build when desired, run `npm run build`. Builds are not performed after every edit.

Keyboard: `/` and `F` open search, `L` opens map layers, `Space` toggles genuine playback, `Esc` closes dialogs/cancels measurement. Settings persist in localStorage.

## Deploy to Vercel

1. Create a Turso SQLite database, apply the migration using its authenticated libSQL URL, and retain the auth token as a server secret.
2. Import this repository into Vercel with the **Next.js** framework preset. `vercel.json` requests the Frankfurt region; there is no Docker or separate backend dependency.
3. Set `DATABASE_URL=libsql://...` and `DATABASE_AUTH_TOKEN` in Vercel. Set optional OpenSky credentials and `MODEL_PATH=./ml/models/model.json` when a real model is included.
4. Provide your genuinely trained `ml/models/model.json` in the deployment checkout. It is ignored by Git by default; deliberately include an authorized model artifact for deployment. Next's output tracing includes SQL migrations and model JSON in API function bundles.
5. Deploy through your Vercel account. Runtime endpoints initialize the SQLite schema once per serverless process. Local SQLite URLs are explicitly rejected when `VERCEL` is set, so deployed writes never rely on a temporary filesystem.

Use Node 22.12+ in Vercel. Functions are request-driven with a 30-second maximum declared on the API handler. No background scheduling is assumed. OpenSky quotas, serverless concurrency, provider licences, database write volume, and a large model can limit availability. This is an MVP, not a production reliability claim.

This initial MVP is a shared, unauthenticated workspace intended for local use or a privately protected deployment. SQLite watchlists and assessment history are shared by users of that deployment; use Vercel deployment protection or add user isolation before opening it publicly. Secrets remain server-side; incoming mutations validate origin and apply a process-local request limit.
