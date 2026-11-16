from __future__ import annotations
import json
import math
from pathlib import Path
from typing import Any
import pandas as pd
from demo_backend.domain.platform import RecipeItem

HUMMUS_DATASET_NAME = 'HUMMUS'

HUMMUS_SOURCE_COMMIT = 'eb67259'

HUMMUS_FINGERPRINT = '2f6608400464393cba8240f8bb630a50236fda570edce2131e2f77d1b5c9c32a'

HUMMUS_FILTER_VERSION = 'food_only_v2'

HUMMUS_HEALTH_SCORE_SOURCE = 'hummus_nutri_score_v1'

HUMMUS_FSA_FALLBACK_SOURCE = 'hummus_fsa_score_fallback_v1'

HUMMUS_WHO_FALLBACK_SOURCE = 'hummus_who_score_fallback_v1'

HUMMUS_DATA_DIR = Path(__file__).resolve().parents[3] / 'data' / 'hummus'

DEFAULT_HUMMUS_PARQUET_PATH = HUMMUS_DATA_DIR / 'hummus_subset_10000.parquet'

DEFAULT_HUMMUS_CSV_PATH = HUMMUS_DATA_DIR / 'hummus_subset_10000.csv'

DEFAULT_HUMMUS_MANIFEST_PATH = HUMMUS_DATA_DIR / 'hummus_subset_10000_manifest.json'

def load_hummus_recipe_items(path: str | Path | None, *, manifest_path: str | Path | None, strict_validation: bool=True) -> list[RecipeItem]:
    """Load the committed HUMMUS subset as RecipeItem objects."""
    dataset_path = Path(path)
    manifest = _load_manifest(Path(manifest_path))
    _validate_manifest(manifest)
    dataframe = _read_hummus_dataframe(dataset_path)
    if strict_validation:
        _validate_dataframe_against_manifest(dataframe, manifest)
    return [_row_to_hummus_recipe_item(row) for _, row in dataframe.iterrows()]

def _read_hummus_dataframe(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f'HUMMUS dataset file does not exist: {path}')
    suffix = path.suffix.lower()
    if suffix == '.parquet':
        return pd.read_parquet(path)
    if suffix == '.csv':
        return pd.read_csv(path)
    raise ValueError(f'unsupported HUMMUS dataset format: {path.suffix}')

def _load_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f'HUMMUS manifest does not exist: {path}')
    return json.loads(path.read_text(encoding='utf-8'))

def _validate_manifest(manifest: dict[str, Any]) -> None:
    errors: list[str] = []
    if manifest.get('dataset_name') != HUMMUS_DATASET_NAME:
        errors.append('dataset_name must be HUMMUS')
    if manifest.get('subset_size_actual') != 10000:
        errors.append('subset_size_actual must be 10000')
    if manifest.get('food_only_filter_enabled') is not True:
        errors.append('food_only_filter_enabled must be true')
    if manifest.get('food_only_filter_version') != HUMMUS_FILTER_VERSION:
        errors.append(f'food_only_filter_version must be {HUMMUS_FILTER_VERSION}')
    if manifest.get('subset_recipe_ids_sha256') != HUMMUS_FINGERPRINT:
        errors.append('subset fingerprint does not match the approved HUMMUS fingerprint')
    if errors:
        raise ValueError('invalid HUMMUS manifest: ' + '; '.join(errors))

def _validate_dataframe_against_manifest(dataframe: pd.DataFrame, manifest: dict[str, Any]) -> None:
    expected_count = int(manifest['subset_size_actual'])
    if len(dataframe) != expected_count:
        raise ValueError(f'HUMMUS row count mismatch: expected {expected_count}, found {len(dataframe)}')
    fingerprint = _recipe_ids_fingerprint(dataframe['recipe_id'].astype(str).tolist())
    expected_fingerprint = str(manifest['subset_recipe_ids_sha256'])
    if fingerprint != expected_fingerprint:
        raise ValueError(f'HUMMUS ordered recipe ID fingerprint mismatch: expected {expected_fingerprint}, found {fingerprint}')

def _recipe_ids_fingerprint(recipe_ids: list[str]) -> str:
    import hashlib
    ordered_ids = '\n'.join((str(recipe_id) for recipe_id in recipe_ids))
    return hashlib.sha256(ordered_ids.encode('utf-8')).hexdigest()

def _row_to_hummus_recipe_item(row: pd.Series) -> RecipeItem:
    who_score = _optional_float(row.get('who_score'))
    fsa_score = _optional_float(row.get('fsa_score'))
    nutri_score = _optional_float(row.get('nutri_score'))
    health_score, health_score_source = derive_hummus_health_score(nutri_score=nutri_score, fsa_score=fsa_score, who_score=who_score)
    parsed_ingredients = _list_value(row.get('parsed_ingredients'))
    parsed_directions = _list_value(row.get('parsed_directions'))
    parsed_tags = _list_value(row.get('parsed_tags'))
    return RecipeItem(recipe_id=str(row['recipe_id']), title=str(row['title']).strip(), description=_optional_text(row.get('description')), recipe_url=_optional_text(row.get('recipe_url')), image_url=None, ingredients=parsed_ingredients, directions=parsed_directions, tags=parsed_tags, dietary_labels=[], allergens=[], total_time_minutes=_optional_float(row.get('total_time_minutes')), servings=_optional_float(row.get('servings')), serving_size_g=_optional_float(row.get('serving_size_g')), calories_per_serving=_optional_float(row.get('calories_per_serving')), totalfat_per_serving_g=_optional_float(row.get('total_fat_per_serving_g')), saturatedfat_per_serving_g=_optional_float(row.get('saturated_fat_per_serving_g')), cholesterol_per_serving_mg=_optional_float(row.get('cholesterol_per_serving_mg')), sodium_per_serving_mg=_optional_float(row.get('sodium_per_serving_mg')), carbohydrate_per_serving_g=_optional_float(row.get('carbohydrate_per_serving_g')), fiber_per_serving_g=_optional_float(row.get('fiber_per_serving_g')), sugars_per_serving_g=_optional_float(row.get('sugars_per_serving_g')), protein_per_serving_g=_optional_float(row.get('protein_per_serving_g')), instruction_count=_optional_int(row.get('instruction_count')), ingredient_count=_optional_int(row.get('ingredient_count')), average_rating=_optional_float(row.get('average_rating')), number_of_ratings=_optional_int(row.get('number_of_ratings')), who_score=who_score, fsa_score=fsa_score, nutri_score=nutri_score, health_score=health_score, health_score_source=health_score_source, dataset_name=HUMMUS_DATASET_NAME, dataset_source_commit=HUMMUS_SOURCE_COMMIT, dataset_fingerprint=HUMMUS_FINGERPRINT)

def derive_hummus_health_score(*, nutri_score: float | None, fsa_score: float | None, who_score: float | None) -> tuple[float | None, str | None]:
    """Return the approved HUMMUS compatibility health score and provenance."""
    if nutri_score is not None:
        return (_clamp_unit(nutri_score), HUMMUS_HEALTH_SCORE_SOURCE)
    if fsa_score is not None:
        return (_clamp_unit(fsa_score), HUMMUS_FSA_FALLBACK_SOURCE)
    if who_score is not None:
        return (_clamp_unit(who_score), HUMMUS_WHO_FALLBACK_SOURCE)
    return (None, None)

def _clamp_unit(value: float) -> float:
    return max(0.0, min(1.0, float(value)))

def _list_value(value: Any) -> list[str]:
    if _is_missing(value):
        return []
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return []
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            return [stripped]
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
        return [str(parsed).strip()] if str(parsed).strip() else []
    if hasattr(value, 'tolist'):
        value = value.tolist()
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if not _is_missing(item) and str(item).strip()]
    return [str(value).strip()] if str(value).strip() else []

def _optional_text(value: Any) -> str | None:
    if _is_missing(value):
        return None
    cleaned = str(value).strip()
    return cleaned or None

def _optional_float(value: Any) -> float | None:
    if _is_missing(value):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(numeric):
        return None
    return numeric

def _optional_int(value: Any) -> int | None:
    numeric = _optional_float(value)
    if numeric is None:
        return None
    return int(numeric)

def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False
