"""Train the RoadSense Random Forest risk model.

Pipeline
--------
1. Load the preprocessed CSV produced by ``preprocess_uk_accidents.py``.
2. Train a ``RandomForestRegressor`` (n_estimators=100) on an 80/20 split
   using the exact 12-feature vector the mobile client will send at runtime.
3. Evaluate on the held-out test set: RMSE, MAE, R^2, and the single-row
   inference latency in milliseconds (the mobile budget is < 50 ms).
4. Compute the closed-form RoadSense score R_total = alpha*H_loc +
   beta*W_t + gamma*T_t on the same test rows so we can compare the
   learned model against the analytic baseline.
5. Print feature importances and persist the model to
   ``backend/data/road_risk_model.pkl`` via joblib.

Run
---
    python backend/scripts/train_road_risk_model.py \
        --data backend/data/uk_accidents_processed.csv \
        --out  backend/data/road_risk_model.pkl
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

logger = logging.getLogger("train_road_risk_model")

# The exact feature order the inference API and mobile client must use.
FEATURE_COLUMNS: list[str] = [
    "latitude",
    "longitude",
    "h_loc_count",
    "hour",
    "day_of_week",
    "is_weekend",
    "is_night",
    "road_surface_encoded",
    "weather_risk_score",
    "is_raining",
    "is_high_wind",
    "is_fog",
]
TARGET_COLUMN = "risk_score"

# RoadSense formula weights. H_loc is the strongest signal by design.
ALPHA = 0.5   # historical density
BETA = 0.3    # environmental (weather + road surface)
GAMMA = 0.2   # temporal

# Real-time budget on a mid-range mobile device.
LATENCY_BUDGET_MS = 50.0

# Bounds used to normalize the sub-features into [0, 1] so the analytic
# score stays on a comparable scale regardless of dataset min/max.
MAX_HOUR = 23.0
MAX_WEATHER_RISK = 3.0      # weather_risk_score is clipped to [0, 3] upstream
MAX_ROAD_SURFACE = 3.0      # road_surface_encoded tops out at 3 (flood)


# --------------------------------------------------------------------------
# RoadSense analytic score
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class RoadSenseWeights:
    alpha: float = ALPHA
    beta: float = BETA
    gamma: float = GAMMA

    def __post_init__(self) -> None:
        total = self.alpha + self.beta + self.gamma
        if not np.isclose(total, 1.0):
            raise ValueError(
                f"RoadSense weights must sum to 1.0, got {total:.4f}"
            )


def _normalize_h_loc(h_loc_count: pd.Series, reference_max: float) -> pd.Series:
    """Scale h_loc_count into [0, 1] against a reference maximum.

    We use the training-set maximum so that the same normalizer can be
    reused at inference time (it will be saved alongside the model).
    """
    if reference_max <= 0:
        return pd.Series(np.zeros(len(h_loc_count)), index=h_loc_count.index)
    return (h_loc_count.clip(lower=0, upper=reference_max) / reference_max).astype(float)


def roadsense_score(
    features: pd.DataFrame,
    h_loc_reference_max: float,
    weights: RoadSenseWeights = RoadSenseWeights(),
) -> pd.Series:
    """Compute R_total in [0, 100] for each row of ``features``.

    R_total = alpha * H_loc + beta * W_t + gamma * T_t, each component
    normalized to [0, 1] before being scaled back up to a 0-100 score so
    it is directly comparable to the learned ``risk_score`` target.
    """
    h_loc = _normalize_h_loc(features["h_loc_count"], h_loc_reference_max)

    # W_t: environmental hazard. Average of four [0, 1] signals.
    weather_norm = features["weather_risk_score"].astype(float) / MAX_WEATHER_RISK
    surface_norm = features["road_surface_encoded"].astype(float) / MAX_ROAD_SURFACE
    w_t = (
        weather_norm + surface_norm + features["is_raining"] + features["is_fog"]
    ) / 4.0

    # T_t: temporal risk. Hour is mapped to [0, 1] linearly; is_night and
    # is_weekend are already binary. Averaging keeps the component in [0, 1].
    hour_norm = features["hour"].astype(float) / MAX_HOUR
    t_t = (hour_norm + features["is_night"] + features["is_weekend"]) / 3.0

    r_total = weights.alpha * h_loc + weights.beta * w_t + weights.gamma * t_t
    return (r_total.clip(lower=0.0, upper=1.0) * 100.0).round(2)


# --------------------------------------------------------------------------
# Training
# --------------------------------------------------------------------------

def load_training_frame(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(
            f"Processed dataset not found at {path}. "
            "Run scripts/preprocess_uk_accidents.py first."
        )
    df = pd.read_csv(path)
    missing = [c for c in FEATURE_COLUMNS + [TARGET_COLUMN] if c not in df.columns]
    if missing:
        raise ValueError(f"Processed CSV is missing required columns: {missing}")
    logger.info("Loaded %d rows from %s.", len(df), path)
    return df


def _measure_single_prediction_ms(
    model: RandomForestRegressor,
    sample_row: np.ndarray,
    repeats: int = 200,
) -> float:
    """Median latency of predicting a single row, in milliseconds.

    Median (not mean) so one garbage-collection hiccup does not dominate.
    """
    one_row = sample_row.reshape(1, -1)
    # Warm-up: first predict in a fresh interpreter hits cold caches.
    for _ in range(5):
        model.predict(one_row)

    timings_ms: list[float] = []
    for _ in range(repeats):
        start = time.perf_counter()
        model.predict(one_row)
        timings_ms.append((time.perf_counter() - start) * 1000.0)
    return float(np.median(timings_ms))


def train_and_evaluate(
    df: pd.DataFrame,
    random_state: int = 42,
    n_estimators: int = 100,
) -> tuple[RandomForestRegressor, dict]:
    X = df[FEATURE_COLUMNS].to_numpy(dtype=np.float64)
    y = df[TARGET_COLUMN].to_numpy(dtype=np.float64)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=random_state
    )

    logger.info(
        "Training RandomForestRegressor (n_estimators=%d) on %d rows...",
        n_estimators,
        len(X_train),
    )
    model = RandomForestRegressor(
        n_estimators=n_estimators,
        random_state=random_state,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
    mae = float(mean_absolute_error(y_test, y_pred))
    r2 = float(r2_score(y_test, y_pred))

    inference_ms = _measure_single_prediction_ms(model, X_test[0])

    # Analytic RoadSense score on the same held-out rows, so we can see
    # how close the closed-form baseline lands to the learned model.
    h_loc_reference_max = float(df["h_loc_count"].max())
    test_frame = pd.DataFrame(X_test, columns=FEATURE_COLUMNS)
    analytic = roadsense_score(test_frame, h_loc_reference_max).to_numpy()
    analytic_rmse = float(np.sqrt(mean_squared_error(y_test, analytic)))
    analytic_mae = float(mean_absolute_error(y_test, analytic))

    metrics = {
        "n_train": len(X_train),
        "n_test": len(X_test),
        "rmse": rmse,
        "mae": mae,
        "r2": r2,
        "inference_ms_per_prediction": inference_ms,
        "meets_latency_budget": inference_ms < LATENCY_BUDGET_MS,
        "roadsense_analytic_rmse": analytic_rmse,
        "roadsense_analytic_mae": analytic_mae,
        "h_loc_reference_max": h_loc_reference_max,
    }
    return model, metrics


def print_feature_importances(model: RandomForestRegressor) -> None:
    ranking = sorted(
        zip(FEATURE_COLUMNS, model.feature_importances_),
        key=lambda kv: kv[1],
        reverse=True,
    )
    width = max(len(name) for name in FEATURE_COLUMNS)
    print("\nFeature importances (highest first):")
    print("-" * (width + 14))
    for name, importance in ranking:
        print(f"  {name:<{width}}  {importance:.4f}")


def print_metrics(metrics: dict) -> None:
    print("\nEvaluation on held-out 20% test split:")
    print(f"  n_train                       : {metrics['n_train']}")
    print(f"  n_test                        : {metrics['n_test']}")
    print(f"  RMSE                          : {metrics['rmse']:.3f}")
    print(f"  MAE                           : {metrics['mae']:.3f}")
    print(f"  R^2                           : {metrics['r2']:.4f}")
    print(
        f"  Inference / single prediction : {metrics['inference_ms_per_prediction']:.3f} ms"
        f"   (budget < {LATENCY_BUDGET_MS:.0f} ms:"
        f" {'OK' if metrics['meets_latency_budget'] else 'FAIL'})"
    )
    print("\nRoadSense analytic baseline on the same test rows:")
    print(f"  R_total = {ALPHA}*H_loc + {BETA}*W_t + {GAMMA}*T_t")
    print(f"  RMSE                          : {metrics['roadsense_analytic_rmse']:.3f}")
    print(f"  MAE                           : {metrics['roadsense_analytic_mae']:.3f}")


# --------------------------------------------------------------------------
# Persistence
# --------------------------------------------------------------------------

def save_model(
    model: RandomForestRegressor,
    metrics: dict,
    out_path: Path,
) -> Path:
    """Serialize the model plus metadata needed to reproduce the pipeline.

    Saving the feature order and the h_loc_count reference max alongside
    the estimator means the inference service can reconstruct both the
    learned prediction and the analytic RoadSense score without having
    to re-load the training CSV.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "model": model,
        "feature_columns": FEATURE_COLUMNS,
        "target_column": TARGET_COLUMN,
        "h_loc_reference_max": metrics["h_loc_reference_max"],
        "roadsense_weights": {"alpha": ALPHA, "beta": BETA, "gamma": GAMMA},
        "normalization": {
            "max_hour": MAX_HOUR,
            "max_weather_risk": MAX_WEATHER_RISK,
            "max_road_surface": MAX_ROAD_SURFACE,
        },
        "metrics": {k: v for k, v in metrics.items() if k != "h_loc_reference_max"},
    }
    joblib.dump(payload, out_path)
    logger.info("Saved trained model to %s", out_path)
    return out_path


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def _parse_args(argv: list[str]) -> argparse.Namespace:
    here = Path(__file__).resolve().parent
    default_data = here.parent / "data" / "uk_accidents_processed.csv"
    default_out = here.parent / "data" / "road_risk_model.pkl"

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data", type=Path, default=default_data,
                   help="Path to uk_accidents_processed.csv.")
    p.add_argument("--out", type=Path, default=default_out,
                   help="Where to write the serialized model (.pkl).")
    p.add_argument("--n-estimators", type=int, default=100)
    p.add_argument("--random-state", type=int, default=42)
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    df = load_training_frame(args.data)
    model, metrics = train_and_evaluate(
        df,
        random_state=args.random_state,
        n_estimators=args.n_estimators,
    )
    print_metrics(metrics)
    print_feature_importances(model)
    save_model(model, metrics, args.out)

    return 0 if metrics["meets_latency_budget"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
