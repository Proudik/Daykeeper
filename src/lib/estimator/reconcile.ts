import type { WorkSession, Reconciliation } from './types';

// Stage 5: Reconcile
// Compute total estimated minutes. Compare against the span from first to
// last activity of the day. Return three numbers: total estimated, day span,
// and unaccounted gap. Never scale numbers to hit a target.

export function reconcile(
  sessions: WorkSession[],
  targetMinutes: number,
): Reconciliation {
  const totalEstimatedMinutes = sessions.reduce(
    (sum, s) => sum + s.estimatedMinutes,
    0,
  );

  const daySpanMinutes = computeDaySpan(sessions);

  const unaccountedGapMinutes = Math.max(0, daySpanMinutes - totalEstimatedMinutes);

  return {
    totalEstimatedMinutes,
    totalRoundedMinutes: totalEstimatedMinutes, // updated after rounding
    daySpanMinutes,
    unaccountedGapMinutes,
    targetMinutes,
    targetMet: totalEstimatedMinutes >= targetMinutes,
  };
}

function computeDaySpan(sessions: WorkSession[]): number {
  if (sessions.length === 0) return 0;
  const start = Math.min(...sessions.map((s) => s.start));
  const end = Math.max(...sessions.map((s) => s.end));
  return Math.max(0, end - start);
}
