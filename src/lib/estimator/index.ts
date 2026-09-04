import type { ActivityItem } from '@/types';
import type { EstimateResult, EstimateOptions, EstimatedEntry, Reconciliation } from './types';
import { normalize } from './normalize';
import { cluster } from './cluster';
import { resolveOverlaps } from './overlap';
import { filterSessions } from './filter';
import { reconcile } from './reconcile';
import { roundSessions } from './round';

// The full estimation pipeline, in order:
// 1. Normalize — every activity item becomes a NormalizedItem in the user's timezone.
// 2. Cluster — group items into work sessions by provider-specific rules.
// 3. Resolve overlaps — trim or absorb overlapping sessions by priority.
// 4. Filter — drop excluded and sub-minimum sessions.
// 5. Reconcile — compute totals and gap.
// 6. Round — apply the user's rounding increment per entry.

export function estimate(
  items: ActivityItem[],
  options: EstimateOptions,
): EstimateResult {
  const normalized = normalize(items);
  const sessions = cluster(normalized);
  const resolved = resolveOverlaps(sessions, options.protectedItemIds);
  const filtered = filterSessions(resolved, options.exclusionRules);
  const reconciliation = reconcile(filtered, options.targetHours * 60);
  const entries = roundSessions(filtered, options.rounding);

  // Update reconciliation with rounded total
  const totalRounded = entries.reduce((sum, e) => sum + e.roundedMinutes, 0);
  const finalReconciliation: Reconciliation = {
    ...reconciliation,
    totalRoundedMinutes: totalRounded,
    unaccountedGapMinutes: Math.max(0, reconciliation.daySpanMinutes - totalRounded),
  };

  return { entries, reconciliation: finalReconciliation };
}

// Re-export individual stages for testing
export { normalize } from './normalize';
export { cluster } from './cluster';
export { resolveOverlaps } from './overlap';
export { filterSessions } from './filter';
export { reconcile } from './reconcile';
export { roundSessions } from './round';
export type * from './types';
