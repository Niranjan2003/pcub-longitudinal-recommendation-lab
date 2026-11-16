import { useState } from 'react';
import type { Action, Pending } from '@/api/schemas';
import { useRecipe } from '@/state/hooks';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { catalogRating, catalogText, malformedIngredient, readRationale } from '@/domain/display';
import { shortHash } from '@/domain/format';

const NUTRITION: { key: string; label: string; unit: string }[] = [
  { key: 'calories_per_serving', label: 'Calories', unit: 'kcal' },
  { key: 'protein_per_serving_g', label: 'Protein', unit: 'g' },
  { key: 'carbohydrate_per_serving_g', label: 'Carbohydrate', unit: 'g' },
  { key: 'totalfat_per_serving_g', label: 'Fat', unit: 'g' },
  { key: 'fiber_per_serving_g', label: 'Fibre', unit: 'g' },
  { key: 'sugars_per_serving_g', label: 'Sugars', unit: 'g' },
  { key: 'sodium_per_serving_mg', label: 'Sodium', unit: 'mg' },
];

const MISSING = 'not in catalog metadata';

/** Title cache-friendly lookup for lists of recipe ids. */
export function RecipeTitle({ id }: { id: string }) {
  const q = useRecipe(id);
  if (q.isPending) return <span className="text-muted">loading…</span>;
  if (q.error) return <span className="text-muted">(not available)</span>;
  return <>{catalogText(q.data.title)}</>;
}

/**
 * The recommended recipe. Title and ingredients come from the action already in
 * the session; everything else from GET /v1/recipes/{id}. No images are shown:
 * the catalog supplies none. Missing values say so explicitly.
 */
export function RecipeCard({ pending, action }: { pending: Pending; action: Action }) {
  const id = pending.recommendation.selected_recipe_id;
  const q = useRecipe(id);
  const r = q.data;
  const rec = pending.recommendation;
  const [showRanked, setShowRanked] = useState(false);
  const evidenceEntries = Object.entries(rec.constraint_evidence);
  const why = readRationale(rec.rationale);

  return (
    <article className="space-y-5" aria-label="Recommended recipe">
      {/* 1. Title */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Recommended recipe</p>
        <h3 className="mt-0.5 text-2xl leading-tight">{catalogText(action.selected_item.title)}</h3>
        {r?.description && <p className="mt-1 line-clamp-3 text-sm text-muted">{catalogText(r.description)}</p>}
      </header>

      {q.error && <ErrorPanel error={q.error} title="Recipe details unavailable" />}

      {/* 2. Essential information */}
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="rounded border border-rule bg-card px-3 py-2">
          <dt className="text-xs text-muted">Total time</dt>
          <dd className="font-medium">{r ? (r.total_time_minutes != null ? `${r.total_time_minutes} min` : MISSING) : '…'}</dd>
        </div>
        <div className="rounded border border-rule bg-card px-3 py-2">
          <dt className="text-xs text-muted">Servings</dt>
          <dd className="font-medium">{r ? (r.servings != null ? r.servings : MISSING) : '…'}</dd>
        </div>
        <div className="rounded border border-rule bg-card px-3 py-2">
          <dt className="text-xs text-muted">Ingredients</dt>
          <dd className="font-medium">{action.selected_item.ingredients.length}</dd>
        </div>
        <div className="rounded border border-rule bg-card px-3 py-2">
          <dt className="text-xs text-muted">Catalog rating</dt>
          <dd className="font-medium">{r ? (catalogRating(r.average_rating, r.number_of_ratings) ?? MISSING) : '…'}</dd>
        </div>
      </dl>

      {/* 3. Ingredients and preparation */}
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold">
            Ingredients <span className="text-xs font-normal text-muted">(names only; the catalog has no amounts)</span>
          </h4>
          {action.selected_item.ingredients.some(malformedIngredient) && (
            <p className="mt-1 text-xs text-muted">Lines marked “incomplete in source” are shown exactly as recorded; nothing is filled in.</p>
          )}
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {action.selected_item.ingredients.map((ing, i) => (
              <li key={i}>
                {catalogText(ing)}
                {malformedIngredient(ing) && <span className="ml-1 text-xs text-warn">(incomplete in source)</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          {r && r.directions.length > 0 ? (
            <details>
              <summary className="cursor-pointer select-none text-sm font-semibold">Directions ({r.directions.length} steps)</summary>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
                {r.directions.map((d, i) => (
                  <li key={i}>{catalogText(d)}</li>
                ))}
              </ol>
            </details>
          ) : (
            r && <p className="text-sm text-muted">Directions: {MISSING}</p>
          )}
          {r && (
            <details>
              <summary className="cursor-pointer select-none text-sm font-semibold">Nutrition per serving</summary>
              <dl className="mt-1 grid grid-cols-2 gap-x-6 text-sm">
                {NUTRITION.map((n) => {
                  const v = (r as Record<string, unknown>)[n.key];
                  return (
                    <div key={n.key}>
                      <dt className="text-xs text-muted">{n.label}</dt>
                      <dd className="tabular">{typeof v === 'number' ? `${v} ${n.unit}` : MISSING}</dd>
                    </div>
                  );
                })}
                <div className="col-span-2 mt-1">
                  <dt className="text-xs text-muted">Catalog health-compatibility score</dt>
                  <dd>
                    {r.health_score != null ? (
                      <>
                        <span className="mono">{r.health_score}</span>{' '}
                        <span className="text-xs text-muted">(source: {r.health_score_source ?? 'unknown'}; a catalog-derived proxy, not a clinical assessment)</span>
                      </>
                    ) : (
                      MISSING
                    )}
                  </dd>
                </div>
              </dl>
            </details>
          )}
        </div>
      </div>

      {/* 4. Why this recipe */}
      <section aria-label="Why this recipe" className="rounded border border-rule bg-card p-3">
        <h4 className="text-sm font-semibold">Why this recipe</h4>
        {why.kind === 'guarded' ? (
          <p className="mt-0.5 text-sm">
            {why.fallback
              ? 'The model’s answer was not a valid score vector, so the backend used its fallback: the feedback-sequence ranking of the same safe shortlist.'
              : 'The guarded LLM scored each recipe on the safe shortlist from 0 to 100; the backend sorted the scores and recommends the top one.'}
          </p>
        ) : why.kind === 'contributions' ? (
          <div className="mt-0.5 text-sm">
            <p>Highest total feedback-sequence score in this turn’s window. Score contributions:</p>
            <dl className="mt-1 grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
              {why.parts.map((p) => (
                <div key={p.key} className="contents">
                  <dt>
                    {p.label}
                    {p.key === 'health' && r && r.health_score == null && (
                      <span className="text-xs text-muted"> (no health score in the catalog: counted as 0)</span>
                    )}
                  </dt>
                  <dd className="tabular text-right">{p.value.toFixed(3)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <p className="mt-0.5 text-sm [overflow-wrap:anywhere]">{rec.rationale}</p>
        )}
        {rec.nudge_text && <p className="mt-1 text-sm italic">{rec.nudge_text}</p>}
        <p className="mt-2 text-xs text-muted">
          Chosen from this turn’s 48-recipe candidate window, not from the whole catalog.{' '}
          {rec.constraint_violations.length === 0
            ? 'It passed the declared diet and limits under approximate catalog-text screening (not an allergy-safety check).'
            : 'Constraint notes are listed in the details below.'}
        </p>
      </section>

      {/* 5. Diagnostics */}
      <details className="rounded border border-rule p-3 text-sm" onToggle={(e) => setShowRanked((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer select-none font-semibold">Technical details: screening record, ranking and provenance</summary>
        <div className="mt-2 space-y-3">
          <div>
            <p className="font-semibold">Hard-constraint filter</p>
            {rec.constraint_violations.length === 0 ? (
              <p className="mt-0.5 text-xs text-muted">
                No violations recorded under the declared constraints. Approximate keyword screening and numeric limits on catalog metadata: not guaranteed
                dietary compliance, and not an allergy or clinical safety certification.
              </p>
            ) : (
              <ul className="mt-0.5 list-disc pl-5">
                {rec.constraint_violations.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            )}
            {evidenceEntries.length > 0 && (
              <ul className="mono mt-1 text-xs">
                {evidenceEntries.map(([k, v]) => (
                  <li key={k}>
                    {k}: {v}
                  </li>
                ))}
              </ul>
            )}
            {r && (r.dietary_labels?.length === 0 || r.allergens?.length === 0) && (
              <p className="mt-1 text-xs text-muted">This catalog subset carries empty dietary-label and allergen lists, so filtering relies on ingredient, title and tag text.</p>
            )}
          </div>
          <div>
            <p className="font-semibold">Ranked candidates ({rec.ranked_recipe_ids.length}, from this turn’s 48-recipe window)</p>
            {showRanked && (
              <ol className="mt-1 space-y-0.5 pl-5">
                {rec.ranked_recipe_ids.slice(0, 10).map((rid) => (
                  <li key={rid}>
                    <span className="mono mr-2 text-xs text-muted">{rid}</span>
                    <RecipeTitle id={rid} />
                  </li>
                ))}
                {rec.ranked_recipe_ids.length > 10 && <li className="list-none text-xs text-muted">… {rec.ranked_recipe_ids.length - 10} more in the ranked window</li>}
              </ol>
            )}
            <p className="mt-1 text-xs text-muted">The ranking is not a probability vector, and the rationale is provenance, not a prediction of your reaction.</p>
          </div>
          <div>
            <p className="font-semibold">Policy rationale exactly as returned</p>
            {why.kind === 'guarded' && (
              <p className="mt-0.5 text-xs">
                Decision <span className="mono">{shortHash(why.decision, 12)}</span>
              </p>
            )}
            <p className="mono mt-0.5 text-xs [overflow-wrap:anywhere]">{rec.rationale}</p>
          </div>
          <dl className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted">Recipe id</dt>
              <dd className="mono">{id}</dd>
            </div>
            {r?.tags && r.tags.length > 0 && (
              <div>
                <dt className="text-muted">Catalog tags</dt>
                <dd>{r.tags.slice(0, 14).join(' · ')}</dd>
              </div>
            )}
          </dl>
          {r?.recipe_url && (
            <p className="text-xs text-muted">
              Catalog source listing:{' '}
              <a href={r.recipe_url} target="_blank" rel="noopener noreferrer" className="text-teal underline">
                external link
              </a>{' '}
              (opens another site; no image is displayed).
            </p>
          )}
        </div>
      </details>
    </article>
  );
}
