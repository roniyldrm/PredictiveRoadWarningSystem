# RoadSense Backend

Async **FastAPI + Motor + MongoDB Atlas** backend for RoadSense (preventive
road warning system). Organised **package-by-feature** so each domain owns
its routes, schemas, repository, and domain logic:

```
backend/app/
├── core/          shared config + primitive types (PyObjectId, GeoPoint)
├── db/            Motor client lifecycle + indexes
├── auth/          /api/auth/*  — register, login, JWT, current-user DI
├── risk/          /api/risk/*  — ML inference + accident proximity
├── history/       /api/history/* — trip history
└── main.py        app factory + lifespan (connects Mongo, loads model)
```

## What the lifespan hook does on startup

1. `connect_to_mongo()` — open a Motor client to Atlas and `ping`.
2. `ensure_indexes()` — idempotently create every index, including the
   `2dsphere` one on `accident_history.location`.
3. `import_accidents_if_empty()` — stream the UK Road Safety dataset and
   bulk-insert if the collection is empty. No-op on subsequent boots.
4. `risk_model.load(...)` — `joblib.load()` the pickled model **once** so
   every `/api/risk/predict` call is a cheap in-memory `predict`.

On shutdown: `close_mongo_connection()`.

## Collections

| Collection         | Purpose                                         | Key index                             |
| ------------------ | ----------------------------------------------- | ------------------------------------- |
| `users`            | Profiles + bcrypt-hashed password for JWT auth  | `{ email: 1 }` unique                 |
| `accident_history` | ~1.6M UK Road Safety records                    | **`{ location: "2dsphere" }`**        |
| `trip_history`     | Past driving sessions + avg `R_total` risk      | `{ user_id: 1, started_at: -1 }`      |

## Endpoints

| Method | Path                                | Auth | Description                             |
| ------ | ----------------------------------- | ---- | --------------------------------------- |
| POST   | `/api/auth/register`                | -    | Create account, return JWT              |
| POST   | `/api/auth/login`                   | -    | Exchange email+password for JWT         |
| GET    | `/api/auth/me`                      | JWT  | Current user profile                    |
| POST   | `/api/risk/predict`                 | JWT  | Risk score for a GPS+context payload    |
| GET    | `/api/risk/accidents/nearby`        | JWT  | Historical accidents around a point     |
| GET    | `/api/history/trips`                | JWT  | List the caller's past trips            |
| POST   | `/api/history/trips`                | JWT  | Record a completed trip                 |
| GET    | `/api/history/trips/{trip_id}`      | JWT  | Fetch one trip                          |
| DELETE | `/api/history/trips/{trip_id}`      | JWT  | Delete a trip                           |
| GET    | `/health`                           | -    | Liveness + Mongo/model status           |

Auth scheme: `Authorization: Bearer <jwt>` (HS256 via `python-jose`).
Passwords are hashed with `passlib[bcrypt]`.

## Setup

```bash
cd RoadWarningSystem/backend

python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env   # fill MONGODB_URI, JWT_SECRET, CORS_ALLOW_ORIGINS
# Drop the dataset + model under data/:
#   data/Accident_Information.csv.xlsx
#   data/road_risk_model.pkl

uvicorn app.main:app --reload
```

Interactive docs at <http://localhost:8000/docs>.

## CORS & HTTPS / TLS

- `CORS_ALLOW_ORIGINS` — comma-separated list of allowed origins for the
  React Native / Expo client. Use `*` in dev; set real origins in prod
  (this also enables `allow_credentials=True` automatically).
- `TRUST_PROXY_HEADERS=true` — FastAPI honours `X-Forwarded-Proto` /
  `X-Forwarded-For` from an HTTPS-terminating reverse proxy
  (nginx / traefik / ELB). The app never terminates TLS itself; put it
  behind a proxy and forward to `http://127.0.0.1:8000`.

## Request / response shapes

### `POST /api/auth/register` / `/api/auth/login`

```json
// request
{ "email": "alice@example.com", "password": "s3cret-pass" }

// response
{ "access_token": "eyJhbGciOi…", "token_type": "bearer", "expires_in": 86400 }
```

### `POST /api/risk/predict`

```json
// request
{
  "latitude": 51.52,
  "longitude": -0.20,
  "hour": 18,                   // optional; server clock used otherwise
  "day_of_week": 3,             // optional; 1=Mon..7=Sun
  "road_surface": "Wet or damp",
  "weather_conditions": "Raining no high winds",
  "nearby_radius_m": 500
}

// response
{
  "risk_score": 64.12,
  "risk_band": "high",
  "h_loc_count": 7,
  "features_used": { "latitude": 51.52, "longitude": -0.2, "h_loc_count": 7, ... }
}
```

The feature order sent into the model exactly matches
`backend/scripts/preprocess_uk_accidents.py :: FEATURE_COLUMNS`.

### `POST /api/history/trips`

```json
{
  "started_at": "2026-04-23T08:15:00Z",
  "ended_at":   "2026-04-23T08:47:00Z",
  "average_r_total": 0.27,
  "distance_km": 12.4,
  "route": [
    { "latitude": 51.52, "longitude": -0.20, "timestamp": "2026-04-23T08:15:01Z",
      "speed_kmh": 38.0, "r_total": 0.19 }
  ],
  "notes": "Commute, light rain"
}
```
