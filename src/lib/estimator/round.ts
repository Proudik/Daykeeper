import type { WorkSession, EstimatedEntry } from './types';
import type { RoundingMinutes } from '@/types';

// Stage 6: Round
// Apply the user's increment, rounding each entry independently, half up.
// (Half up = standard rounding: 0.5 rounds up, not banker's rounding.)
// Show the pre-rounding value on hover (stored as rawMinutes).

export function roundSessions(
  sessions: WorkSession[],
  increment: RoundingMinutes,
): EstimatedEntry[] {
  return sessions.map((session) => {
    const raw = session.estimatedMinutes;
    const rounded = increment === 0 ? raw : roundHalfUp(raw, increment);

    return {
      id: session.id,
      provider: session.provider,
      kind: session.kind,
      start: session.start,
      end: session.end,
      rawMinutes: raw,
      roundedMinutes: rounded,
      label: session.label,
      groupKey: session.groupKey,
      sourceItemIds: session.sourceItemIds,
      confidence: session.confidence,
      absorbed: session.absorbed,
      trimmed: session.trimmed,
      originalStart: session.originalStart,
      originalEnd: session.originalEnd,
    };
  });
}

// Round half up: e.g. 7.5 with increment 15 → 15, 22 with increment 15 → 30.
// Standard "round half away from zero" on the quotient.
function roundHalfUp(value: number, increment: number): number {
  const quotient = value / increment;
  const rounded = Math.round(quotient);
  // Math.round already rounds half up (0.5 → 1) for positive numbers
  return rounded * increment;
}
