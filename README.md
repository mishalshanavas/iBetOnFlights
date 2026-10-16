# FlightGuard ATC Intelligence

A map-first European aviation intelligence workspace built with Next.js App Router, TypeScript, MapLibre, Tailwind, Radix/shadcn-style primitives, Zustand, TanStack Query, Drizzle, and SQLite/libSQL. The interface follows the supplied aviation operations reference: charcoal panels, compact telemetry, contextual airport details, real radar, a map toolbar, and recorded-snapshot playback.

## Run locally

Requirements: Node 22.12+ and npm. Python 3.12+ is needed only for offline cohort model training (tested on Python 3.14).

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
| Delay estimates | Bundled calibrated LightGBM model; no API key | Official CAA European route/airline cohorts linked to four UK airports. Monthly risk, with arrival/departure direction preserved. Historical fallbacks remain available. |

A calibrated European route/airline cohort model is bundled; its scope and measured limits are documented below. Official NOTAM feeds and comprehensive verified live commercial itineraries require a provider. The system does not derive schedules, airline responsibility, runway closures, or cancellation causes from surveillance data.

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

## Flight-delay ML backend

For the complete architecture, dataset schema, ML techniques, setup commands, API examples, historical fallbacks, and troubleshooting, see [the ML backend guide](docs/ml-backend.md).

The app now serves a trained, calibrated LightGBM model through `POST /api/schedule/predict` (also `POST /api/predict` with the same itinerary body), batch predictions, the itinerary weather context, and supported flights on the day board. Inference runs inside Next.js; no separate Python server is required. `GET /api/model/status` and `GET /api/schedule/status` expose evaluation, model age, release status and coverage. Python is only needed to refresh the data and retrain:

```sh
npm run ml:setup
# Reuse existing downloads/dependencies:
npm run ml:download
npm run ml:train
```

```sh
curl http://localhost:3000/api/schedule/predict \
  -H 'Content-Type: application/json' \
  -d "{\"origin\":\"EHAM\",\"destination\":\"EGLL\",\"operatingAirline\":\"KLM\",\"scheduledDeparture\":$(date -u -d '+1 day' +%s),\"scheduledArrival\":$(date -u -d '+1 day 2 hours' +%s)}"
```

Source: [UK Civil Aviation Authority punctuality reports](https://www.caa.co.uk/data-and-analysis/uk-aviation-market/flight-punctuality/uk-flight-punctuality-statistics/2026/), January 2023–August 2026. The European subset contains 13,908 monthly reporting cohorts representing 1,058,694 matched movements, **not individual flight records**. UK domestic movements may be counted at both reporting airports. This covers European routes linked to Heathrow, Gatwick, Manchester and Edinburgh; it does not cover arbitrary intra-EU routes.

The untouched July–August 2026 evaluation includes 47,318 movements. For delays strictly over 30 minutes, ROC-AUC is 0.623 and Brier score improves 2.55% over a seasonal route-history baseline. The 60-minute model has a slightly worse Brier score than that baseline (0.37%), although log loss improves. Three-hour improvement is marginal. These results establish modest cohort-level signal, **not high individual-flight accuracy**. See [the evaluation protocol](docs/model-evaluation.md) and [the machine-readable results](docs/caa-model-evaluation.json).

The model uses month, route, airline and reporting direction. It cannot infer exact delay minutes, cancellations, incoming aircraft delays or weather effects from these aggregates. Unsupported or stale ML estimates fall back to explicitly labelled historical rates where available. Predictions for UK departures describe delay at the UK departure airport; predictions for arrivals into the UK describe delay at the UK arrival airport. API probabilities use CAA's strict `>30`, `>60` and `>180` thresholds, excluding cancellations and unmatched movements.

The committed model is frozen for evaluation: training ends November 2025 and calibration ends May 2026. ML inference expires 180 days after the calibration period ends. Refresh with `npm run ml:setup -- --refresh`; failed retraining writes a candidate artifact and leaves the previous released artifact intact. Raw data stays in ignored `ml/datasets/caa/`; the downloader records source URLs and SHA-256 hashes. The Lambda packager includes the released model.

## Historical delay estimates and AWS Lambda API

The default map includes **Plane animation** controls: pause/play and 0.25×, 0.5×, 1×, 2×, 4× or 8× speed. Demo flights follow simulated airport connections and finish at the named destination; select a demo aircraft to see its connection. Flight outlook route previews follow their supplied waypoints, stop at the destination airport, and do not restart or fly reported cancelled services. These are time-compressed airport connections, not confirmed ATC flight plans or actual landing reports. OpenSky live state vectors do not supply destination airports: live markers use bounded heading/speed estimates between observations, never invented airport assignments or circular paths. Ground aircraft and recorded snapshots stay stationary. Speed controls affect display only; recorded positions, timestamps and tracks remain unchanged. Animations pause offscreen/in hidden tabs and respect reduced-motion preferences. A canvas layer uses animation frames without updating React state or MapLibre data sources on each frame.

The Predictions page now opens on **Delayed**, a UTC date-based flight outlook. It uses the official public [Avinor flight feed](https://partner.avinor.no/en/services/flight-data/) for Oslo departures without an account or API key, with a shared three-minute cache and a 14-day window. Every available flight is accessible through pages of 50; a missing estimate stays visible with its reason. The feed provides one airport's departure times, not worldwide schedules or scheduled arrival times. Arrival times and aircraft identity are never fabricated. Other authorized schedules can still be imported and selected in the source menu.

Orange means a modelled or historical 30-minute delay risk of at least 20%, or an airport-reported delay. Red means a historical cancellation rate of at least 10%, or an airport-reported cancellation. These are explicit watchlist cutoffs, not validated predictions that individual flights will be delayed/cancelled. Each card distinguishes reported status from historical risk and explains the source, comparable sample, measured airport/direction and unknown disruption cause. Cancellation risk stays unavailable for delay-only history. Route lines show airport-to-airport connections for the displayed page, not planned paths or actual tracks. The main map's existing OpenSky feed continues to display recent aircraft positions; it does not identify future schedules from callsigns.

`GET /api/schedule/day?date=YYYY-MM-DD&source=public&offset=0&limit=50` fetches and assesses the selected day. `source=imported` uses database schedules and accepts an optional departure `airport=EGLL`. Page size is bounded to 100; there is no 500-flight cutoff. Public departure-only records use the cohort ML model when supported, followed by historical route estimates, without inventing arrival times. Complete imported schedules are scored through the configured private batch API when set. Unsupported dates/providers return explicit errors. Lambda also has a new authenticated `/v1/flights/day` route in its source and deployment template; using that endpoint directly requires deploying the updated Lambda.

**Check a flight** now asks only for airports, operating airline and scheduled departure/arrival. Weather is fetched automatically; weather threshold inputs have been removed from this screen. They previously flagged weather alerts and never affected the historical prediction percentages. The context API retains its optional thresholds for existing integrations. Changing an itinerary hides its previous result, including responses arriving after the edit.

The `/predictions` screen first uses the released cohort ML model on supported routes, then historical rates calculated directly in the API. For individual gate-arrival records it needs at least 1,000 labelled flights and 10 severe delays; smaller route groups are pulled toward the overall sample. When that history is insufficient, the API can return official UK CAA published route-and-airline punctuality for covered UK-linked routes with at least 100 matched movements. The response identifies its method, arrival/departure direction, target, thresholds, reporting months, sample, source URLs, and limitations. These are historical rates, not calibrated individual-flight forecasts or compensation eligibility. The older `/api/predict` weather-feature request format remains supported as a separate model contract.

To fetch public CAA history and import it into the database configured in ignored `.env.local`:

```bash
python3 scripts/import-caa.py
```

The importer discovers monthly Arrival/Departure CSVs on the official CAA pages for the previous 12 complete calendar months, maps only known airports, and retains scheduled services. It reconstructs integer delay-band counts from six-decimal published percentages using **matched + unmatched + cancelled movements** as the original denominator, validates reconciliation, and stores aggregates separately in `published_punctuality`. Displayed delay rates then divide those counts by matched operated movements; cancellation rates use all three categories. Raw downloads and a provenance manifest stay in ignored `data/imports/caa/`. Reimporting the same cohort updates it without duplication. Use `--dry-run` to download and validate without database writes.

CAA rates use **strictly more than 30, 60, and 180 minutes**, not the individual-record API's greater-than-or-equal thresholds. A UK destination uses arrival punctuality at that airport; otherwise a supported UK origin uses departure punctuality. No global CAA fallback is used for an unsupported route or airline. CAA carrier codes and selected aliases are accepted; the UI lists published airline names and covered route history. [CAA methodology](https://www.caa.co.uk/data-and-analysis/uk-aviation-market/flight-punctuality/uk-flight-punctuality-statistics-notes/) permits changes to planned times up to 30 minutes before operation and estimated taxi times when gate times are missing, so these aggregates do not establish booking-time predictability. [CAA publication terms](https://www.caa.co.uk/data-and-analysis/uk-aviation-market/flight-punctuality/uk-flight-punctuality-statistics/2026/) require attribution and prohibit selling their statistical data to third parties. Published movement totals may count a UK domestic flight at both reporting airports. Individual flights and upcoming schedules are never synthesized from monthly totals.

Import sourced flight records with a `predictionEvidence` object when the source provides a timestamped schedule. Example (timestamps are Unix seconds):

```json
[{"id":"source-flight-id","flightNumber":"XY123","operatingAirline":"Operating carrier name","originIcao":"EHAM","destinationIcao":"EDDF","scheduledDeparture":1800000000,"scheduledArrival":1800007200,"actualArrival":1800009000,"status":"arrived","source":"Your licensed source","updatedAt":1800010000,"predictionEvidence":{"scheduleObservedAt":1799900000,"labelObservedAt":1800010000,"arrivalTimeBasis":"gate"}}]
```

The importer validates structure and timestamp order; **you must verify the source and rights to use it**. Reimporting a flight without `predictionEvidence` clears its old evidence so a changed schedule cannot inherit a stale proof. The Lambda computes rates from eligible records directly; no training job or model artifact is required:

```bash
npm run data:import -- flights.json
```

Only flights whose schedule was observed at least one hour before departure, whose actual arrival is labelled as gate arrival, and whose label became available before the estimate are counted. The API excludes cancellations and diversions from this arrival-delay target. Estimates require at least one hour before departure and use only the route and operating airline from the requested schedule. It cannot infer the eventual aircraft or disruption cause.

Next.js exposes `GET /api/schedule/status`, `GET /api/schedule/flights?limit=50`, `POST /api/schedule/predict`, `POST /api/schedule/predict/batch`, and `POST /api/schedule/context`. The batch body is `{ "flights": [<schedule input>, ...] }` (maximum 100); each result includes either a prediction or a reason it is unavailable. A schedule input contains `origin`, `destination`, `operatingAirline`, `scheduledDeparture`, and `scheduledArrival` in Unix seconds. The context body is `{ "itinerary": <schedule input>, "thresholds": { "gustMs": 18, "precipitationMm": 3 } }`. Context returns the historical estimate when supported, plus time-matched Open-Meteo departure and arrival forecasts. User thresholds flag forecast conditions; they do **not** alter the historical percentage. Weather can still appear when the historical sample is insufficient. Forecasts beyond the 48-hour assessment window are marked unavailable.

For a private AWS API, run `npm run lambda:package`, then deploy `aws/template.yaml` with AWS SAM. It provisions API Gateway HTTP API and Node.js 22 Lambda with `GET /v1/status`, `GET /v1/flights`, `POST /v1/predictions`, `POST /v1/predictions/batch`, and `POST /v1/context`. Supply a hosted libSQL URL, its auth token, and a random `PredictionApiToken` (at least 32 characters) as SAM parameters. Requests require `Authorization: Bearer <token>`. Keep that token on the server: setting `PREDICTION_API_BASE_URL` and `PREDICTION_API_TOKEN` in the Next.js server makes the existing UI routes proxy to Lambda. Do not put it in a `NEXT_PUBLIC_` variable. Lambda packaging includes SQL migrations and scoring code. Deploy only after the database and API token are ready. Unsupported cohorts return insufficient history; the API does not invent percentages. Status reports individual gate-arrival records and published aggregates separately. The flight board includes `publishedRoutes`, a separate historical-cohort list; it never presents that list as upcoming flights.

The board examines upcoming imported schedules; it does not collect or purchase live flight-status data. A licensed ingestion feed or recurring import is still needed for a continuously populated board. [EUROCONTROL DDR historical traffic and its API require approved access](https://www.eurocontrol.int/ddr); the API is restricted to ANSPs. [EAD Basic](https://www.ead.eurocontrol.int/cms-eadbasic/opencms/en/ead-solutions/ead-basic/) exposes limited NOTAM information, not flight-level scheduled and actual gate-arrival labels. No EUROCONTROL/NOTAM scraper is included. [Open-Meteo's free API is for non-commercial use](https://open-meteo.com/en/terms); arrange suitable terms before a commercial launch.

To deploy with AWS CLI without installing SAM CLI, log in with `aws login`, put `DATABASE_URL` and `DATABASE_AUTH_TOKEN` in ignored `.env.local`, then run `python3 scripts/deploy-predictions.py`. The script packages the Lambda, creates a private S3 artifact bucket and the CloudFormation stack in `ap-south-1`, generates an API token when absent, and saves the deployed URL and token to `.env.local`. Set `PREDICTION_AWS_REGION` to override the region. Restart Next.js after deployment. API Gateway throttles requests to two per second with a burst of five. Packaging uses the hosted libSQL client to avoid native SQLite dependencies in Lambda.

## Optional offline delay model research

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
