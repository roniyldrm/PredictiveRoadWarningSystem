"""Preprocess the UK Road Safety accident dataset for the RoadSense model.

Pipeline
--------
1. Load the raw dataset (CSV or XLSX, autodetected from the file suffix).
2. Keep only the columns we actually use for modelling.
3. Drop rows with missing values in the fields we can't impute safely
   (latitude, longitude, severity, time, weather_conditions).
4. Engineer temporal features (hour, is_night, is_weekend).
5. Encode weather_conditions into flag features + a weather_risk_score.
6. Encode road_surface into an ordinal numeric code.
7. Normalize severity into a 0-100 risk_score (higher = more dangerous).
8. Compute h_loc_count: for each accident, how many OTHER accidents in the
   full cleaned dataset sit within a 500 m radius (BallTree, haversine).
9. Draw a 50 000-row sample stratified by severity.
10. Write uk_accidents_processed.csv next to this script.

Run
---
    python backend/scripts/preprocess_uk_accidents.py \
        --source backend/data/Accident_Information.csv.xlsx \
        --out    backend/data/uk_accidents_processed.csv

Requires: pandas, numpy, scikit-learn, openpyxl (for .xlsx sources).
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

logger = logging.getLogger("preprocess_uk_accidents")

RELEVANT_COLUMNS = [
    "severity",
    "date",
    "day_of_week",
    "latitude",
    "longitude",
    "road_surface",
    "time",
    "weather_conditions",
]

REQUIRED_NOT_NULL = [
    "latitude",
    "longitude",
    "severity",
    "time",
    "weather_conditions",
]

# UK Stats19 severity uses 1 = Fatal, 2 = Serious, 3 = Slight. Some exports
# also carry a '4' bucket ("Non-injury"), which we keep in range by design.
SEVERITY_STRING_TO_INT = {
    "fatal": 1,
    "serious": 2,
    "slight": 3,
    "non-injury": 4,
    "non injury": 4,
    "none": 4,
}

WEEKDAY_NAME_TO_INT = {
    "monday": 1,
    "tuesday": 2,
    "wednesday": 3,
    "thursday": 4,
    "friday": 5,
    "saturday": 6,
    "sunday": 7,
}

# Road surface -> ordinal risk (higher = more hazardous).
ROAD_SURFACE_ENCODING = {
    "dry": 0,
    "wet": 1,
    "wet or damp": 1,
    "damp": 1,
    "snow": 2,
    "ice": 2,
    "frost": 2,
    "frost or ice": 2,
    "snow/ice": 2,
    "flood": 3,
    "flood over 3cm. deep": 3,
}

EARTH_RADIUS_M = 6_371_000.0
NEIGHBOUR_RADIUS_M = 500.0


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------

def _canonical_column(name: str) -> str:
    """Map any casing / spacing variant to our canonical lower_snake name."""
    return str(name).strip().lower().replace(" ", "_")


def load_dataset(path: Path) -> pd.DataFrame:
    """Load the dataset from CSV or XLSX and canonicalize column names."""
    if not path.exists():
        raise FileNotFoundError(f"Dataset not found: {path}")

    suffix = path.suffix.lower()
    logger.info("Loading dataset from %s (%s)...", path, suffix or "no suffix")

    # "Accident_Information.csv.xlsx" -> last suffix wins -> xlsx.
    if suffix == ".xlsx":
        df = pd.read_excel(path, engine="openpyxl")
    elif suffix == ".csv":
        df = pd.read_csv(path, low_memory=False)
    else:
        # Best-effort: try csv first, fall back to excel.
        try:
            df = pd.read_csv(path, low_memory=False)
        except Exception:
            df = pd.read_excel(path, engine="openpyxl")

    df.columns = [_canonical_column(c) for c in df.columns]
    logger.info("Loaded %d raw rows, %d columns.", len(df), df.shape[1])
    return df


# --------------------------------------------------------------------------
# Cleaning
# --------------------------------------------------------------------------

def select_and_clean(df: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in RELEVANT_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(
            f"Dataset is missing expected columns: {missing}. "
            f"Available: {sorted(df.columns)}"
        )

    df = df.loc[:, RELEVANT_COLUMNS].copy()

    # Coerce coordinates to numeric before the null check so strings like
    # "" or "NaN" become real NaN and get dropped below.
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")

    # Treat empty strings as missing in the string columns.
    for col in ("severity", "time", "weather_conditions", "day_of_week", "road_surface"):
        if df[col].dtype == object:
            df[col] = df[col].replace(r"^\s*$", np.nan, regex=True)

    before = len(df)
    df = df.dropna(subset=REQUIRED_NOT_NULL).reset_index(drop=True)
    logger.info("Dropped %d rows with missing required fields.", before - len(df))

    df = df[(df["latitude"].between(-90, 90)) & (df["longitude"].between(-180, 180))]
    df = df.reset_index(drop=True)
    logger.info("Rows after coordinate sanity filter: %d.", len(df))
    return df


# --------------------------------------------------------------------------
# Feature engineering
# --------------------------------------------------------------------------

def _extract_hour(time_value) -> float:
    """Return an hour in [0, 23] from heterogeneous time encodings, else NaN."""
    if pd.isna(time_value):
        return np.nan
    if isinstance(time_value, (int, np.integer)):
        return float(time_value % 24)
    if isinstance(time_value, float):
        # Excel day-fraction (0.7375 -> 17:42) if in [0, 1); integer hour otherwise.
        if 0.0 <= time_value < 1.0:
            return float(int(time_value * 24) % 24)
        return float(int(time_value) % 24)
    s = str(time_value).strip()
    if not s:
        return np.nan
    head = s.split(":", 1)[0]
    try:
        return float(int(head) % 24)
    except ValueError:
        try:
            return float(int(float(head)) % 24)
        except ValueError:
            return np.nan


def _day_of_week_to_int(value) -> float:
    if pd.isna(value):
        return np.nan
    if isinstance(value, (int, np.integer, float)):
        v = int(value)
        return float(v) if 1 <= v <= 7 else np.nan
    mapped = WEEKDAY_NAME_TO_INT.get(str(value).strip().lower())
    return float(mapped) if mapped is not None else np.nan


def add_temporal_features(df: pd.DataFrame) -> pd.DataFrame:
    df["hour"] = df["time"].apply(_extract_hour)
    df = df.dropna(subset=["hour"]).reset_index(drop=True)
    df["hour"] = df["hour"].astype(int).clip(0, 23)

    df["is_night"] = ((df["hour"] < 6) | (df["hour"] > 21)).astype(int)

    df["day_of_week"] = df["day_of_week"].apply(_day_of_week_to_int)
    df = df.dropna(subset=["day_of_week"]).reset_index(drop=True)
    df["day_of_week"] = df["day_of_week"].astype(int)
    df["is_weekend"] = df["day_of_week"].isin([6, 7]).astype(int)
    return df


def add_weather_features(df: pd.DataFrame) -> pd.DataFrame:
    w = df["weather_conditions"].astype(str).str.lower()

    df["is_raining"] = w.str.contains("rain|wet", regex=True, na=False).astype(int)
    df["is_high_wind"] = w.str.contains("high wind", regex=False, na=False).astype(int)
    df["is_fog"] = w.str.contains("fog|mist", regex=True, na=False).astype(int)
    df["is_snow"] = w.str.contains("snow|frost", regex=True, na=False).astype(int)

    # Sum of the four hazard flags (clipped to [0, 3] per spec).
    df["weather_risk_score"] = (
        df[["is_raining", "is_high_wind", "is_fog", "is_snow"]].sum(axis=1).clip(upper=3)
    )
    return df


def encode_road_surface(df: pd.DataFrame) -> pd.DataFrame:
    s = df["road_surface"].astype(str).str.strip().str.lower()
    df["road_surface_encoded"] = s.map(ROAD_SURFACE_ENCODING).fillna(0).astype(int)
    return df


def normalize_severity(df: pd.DataFrame) -> pd.DataFrame:
    """Map severity to an integer in [1, 4] and derive risk_score in [0, 100].

    UK severity codes run 1 = Fatal (most dangerous) -> 4 = Non-injury, so the
    risk_score inverts the scale: severity 1 -> 100, severity 4 -> 0.
    """
    raw = df["severity"]
    if pd.api.types.is_numeric_dtype(raw):
        sev = pd.to_numeric(raw, errors="coerce")
    else:
        sev = raw.astype(str).str.strip().str.lower().map(SEVERITY_STRING_TO_INT)
        # Fall back: sometimes the field is already a numeric string.
        if sev.isna().any():
            numeric_fallback = pd.to_numeric(raw, errors="coerce")
            sev = sev.fillna(numeric_fallback)

    df["severity"] = sev
    df = df.dropna(subset=["severity"]).reset_index(drop=True)
    df["severity"] = df["severity"].astype(int).clip(lower=1, upper=4)

    df["risk_score"] = ((4 - df["severity"]) / 3.0 * 100.0).round(2)
    return df


# --------------------------------------------------------------------------
# Spatial density feature (h_loc_count)
# --------------------------------------------------------------------------

def add_h_loc_count(df: pd.DataFrame, radius_m: float = NEIGHBOUR_RADIUS_M) -> pd.DataFrame:
    """For each row, count OTHER accidents within `radius_m` (haversine)."""
    logger.info(
        "Building BallTree over %d points for %.0f m neighbour counts...",
        len(df),
        radius_m,
    )
    coords_rad = np.radians(df[["latitude", "longitude"]].to_numpy(dtype=np.float64))
    tree = BallTree(coords_rad, metric="haversine")
    radius_rad = radius_m / EARTH_RADIUS_M

    # count_only is O(N log N) and avoids materializing neighbour index arrays.
    counts = tree.query_radius(coords_rad, r=radius_rad, count_only=True)
    df["h_loc_count"] = (counts - 1).clip(min=0).astype(int)  # exclude self
    logger.info(
        "h_loc_count stats: min=%d median=%d max=%d",
        int(df["h_loc_count"].min()),
        int(df["h_loc_count"].median()),
        int(df["h_loc_count"].max()),
    )
    return df


# --------------------------------------------------------------------------
# Sampling
# --------------------------------------------------------------------------

def stratified_sample(
    df: pd.DataFrame,
    target_size: int,
    stratify_col: str = "severity",
    random_state: int = 42,
) -> pd.DataFrame:
    if len(df) <= target_size:
        logger.info(
            "Dataset has %d rows (<= target %d), returning everything.",
            len(df),
            target_size,
        )
        return df.reset_index(drop=True)

    proportions = df[stratify_col].value_counts(normalize=True)
    frames: list[pd.DataFrame] = []
    allocated = 0
    classes = list(proportions.index)
    for i, cls in enumerate(classes):
        # Allocate last class with the remainder so rounding never loses rows.
        if i == len(classes) - 1:
            take = target_size - allocated
        else:
            take = int(round(proportions[cls] * target_size))
        available = (df[stratify_col] == cls).sum()
        take = max(0, min(take, int(available)))
        allocated += take
        frames.append(
            df[df[stratify_col] == cls].sample(n=take, random_state=random_state)
        )

    sample = (
        pd.concat(frames, ignore_index=True)
        .sample(frac=1.0, random_state=random_state)
        .reset_index(drop=True)
    )
    logger.info(
        "Stratified sample size=%d, class balance:\n%s",
        len(sample),
        sample[stratify_col].value_counts().to_string(),
    )
    return sample


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------

FEATURE_COLUMNS: Iterable[str] = (
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
)
TARGET_COLUMN = "risk_score"


def preprocess(source: Path, out: Path, sample_size: int = 50_000) -> Path:
    df = load_dataset(source)
    df = select_and_clean(df)
    df = add_temporal_features(df)
    df = add_weather_features(df)
    df = encode_road_surface(df)
    df = normalize_severity(df)
    df = add_h_loc_count(df)

    sample = stratified_sample(df, target_size=sample_size)

    final_cols = list(FEATURE_COLUMNS) + [TARGET_COLUMN, "severity"]
    sample = sample.loc[:, final_cols]

    out.parent.mkdir(parents=True, exist_ok=True)
    sample.to_csv(out, index=False)
    logger.info("Wrote %d rows x %d cols to %s", len(sample), sample.shape[1], out)
    return out


def _parse_args(argv: list[str]) -> argparse.Namespace:
    here = Path(__file__).resolve().parent
    default_source = here.parent / "data" / "Accident_Information.csv.xlsx"
    default_out = here.parent / "data" / "uk_accidents_processed.csv"

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", type=Path, default=default_source,
                   help="Path to the raw UK accident dataset (.csv or .xlsx).")
    p.add_argument("--out", type=Path, default=default_out,
                   help="Where to write the processed CSV.")
    p.add_argument("--sample-size", type=int, default=50_000,
                   help="Target number of rows in the output sample.")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    preprocess(args.source, args.out, sample_size=args.sample_size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
