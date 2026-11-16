from __future__ import annotations
from typing import Any
from typing import Literal
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import model_validator

DietaryPattern = Literal['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'other']

class StrictModel(BaseModel):
    """Base model that rejects accidental fields in simulator records."""
    model_config = ConfigDict(extra='forbid')

class FrozenStrictModel(StrictModel):
    """Strict record whose top-level attributes cannot change after validation."""
    model_config = ConfigDict(extra='forbid', frozen=True)

class RecipeConstraintMixin(StrictModel):
    """Optional hard constraints that can be applied to recipe metadata."""
    max_total_time_minutes: float | None = Field(default=None, gt=0.0)
    max_ingredient_count: int | None = Field(default=None, ge=0)
    max_instruction_count: int | None = Field(default=None, ge=0)
    min_servings: float | None = Field(default=None, gt=0.0)
    max_servings: float | None = Field(default=None, gt=0.0)

    @model_validator(mode='after')
    def validate_serving_range(self):
        if self.min_servings is not None and self.max_servings is not None and (self.min_servings > self.max_servings):
            raise ValueError('min_servings cannot exceed max_servings')
        return self

class UserPersona(RecipeConstraintMixin):
    """Stable user traits and hard constraints for a simulated participant."""
    user_id: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    dietary_pattern: DietaryPattern
    health_goals: list[str] = Field(default_factory=list)
    taste_preferences: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)
    excluded_ingredients: list[str] = Field(default_factory=list)
    baseline_traits: dict[str, Any] = Field(default_factory=dict)

class DynamicUserState(StrictModel):
    """Mutable state that can change across turns."""
    trust: float
    motivation: float
    fatigue: float
    satisfaction: float
    engagement: float
    resistance: float
    recent_preferences: list[str] = Field(default_factory=list)
    avoided_recently: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)

class RecipeItem(StrictModel):
    """Recipe metadata and nutrition fields used by recommendation logic later."""
    recipe_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    description: str | None = None
    ingredients: list[str] = Field(min_length=1)
    directions: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    recipe_url: str | None = None
    image_url: str | None = None
    total_time_minutes: float | None = Field(default=None, ge=0.0)
    servings: float | None = Field(default=None, gt=0.0)
    serving_size_g: float | None = None
    calories_per_serving: float | None = None
    calories_per_100g: float | None = None
    totalfat_per_serving_g: float | None = None
    totalfat_per_100g_g: float | None = None
    saturatedfat_per_serving_g: float | None = None
    saturatedfat_per_100g_g: float | None = None
    cholesterol_per_serving_mg: float | None = None
    cholesterol_per_100g_mg: float | None = None
    sodium_per_100g_mg: float | None = None
    carbohydrate_per_serving_g: float | None = None
    carbohydrate_per_100g_g: float | None = None
    fiber_per_serving_g: float | None = None
    fiber_per_100g_g: float | None = None
    sugars_per_serving_g: float | None = None
    sugars_per_100g_g: float | None = None
    protein_per_serving_g: float | None = None
    protein_per_100g_g: float | None = None
    sodium_per_serving_mg: float | None = None
    who_score: float | None = None
    fsa_score: float | None = None
    nutri_score: float | None = None
    health_score: float | None = None
    health_score_source: str | None = None
    instruction_count: int | None = Field(default=None, ge=0)
    ingredient_count: int | None = Field(default=None, ge=0)
    average_rating: float | None = None
    number_of_ratings: int | None = Field(default=None, ge=0)
    dataset_name: str | None = None
    dataset_source_commit: str | None = None
    dataset_fingerprint: str | None = None
    dietary_labels: list[str] = Field(default_factory=list)
    allergens: list[str] = Field(default_factory=list)

class RecommendationAgentOutput(StrictModel):
    """Selected or ranked recommendation output for one turn."""
    turn_index: int = Field(ge=1)
    selected_recipe_id: str = Field(min_length=1)
    ranked_recipe_ids: list[str] = Field(min_length=1)
    rationale: str = Field(min_length=1)
    nudge_text: str | None = None
    constraint_violations: list[str] = Field(default_factory=list)
    constraint_evidence: dict[str, str] = Field(default_factory=dict)
