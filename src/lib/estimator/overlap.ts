import type { WorkSession, AbsorbedContext } from './types';
import type { Provider } from '@/types';

// Stage 3: Resolve overlaps
// A lawyer cannot bill two things at the same clock time. Where sessions
// overlap, apply priority: calendar > documents > chat > email.
// The lower-priority session is trimmed to the non-overlapping remainder.
// If it is fully consumed, mark it absorbed and attach it to the winning
// session as context rather than dropping it silently.

const PRIORITY: Record<Provider, number> = {
  singlecase: 5, // confirmed from source system — highest priority
  calendar: 4,
  documents: 3,
  chat: 2,
  email: 1,
  browser: 0, // passive browsing — lowest priority, absorbed by calendar etc.
  custom: 0,
};

export function resolveOverlaps(sessions: WorkSession[]): WorkSession[] {
  // Sort by priority (highest first), then by start time
  const sorted = [...sessions].sort((a, b) => {
    const pri = PRIORITY[b.provider] - PRIORITY[a.provider];
    if (pri !== 0) return pri;
    return a.start - b.start;
  });

  // Track occupied intervals from higher-priority sessions
  const occupied: Interval[] = [];
  const result: WorkSession[] = [];

  for (const session of sorted) {
    const overlaps = findOverlaps(session, occupied);

    if (overlaps.length === 0) {
      result.push(session);
      addInterval(occupied, session.start, session.end);
      continue;
    }

    // Trim the session to non-overlapping remainders
    const remainders = trimToRemainders(session, overlaps);

    if (remainders.length === 0) {
      // Fully consumed — absorb into the winning session
      const winner = findWinner(session, result);
      if (winner) {
        winner.absorbed.push({
          provider: session.provider,
          label: session.label,
          start: session.start,
          end: session.end,
          estimatedMinutes: session.estimatedMinutes,
        });
        // Downgrade winner confidence if it absorbs a lot
        if (winner.confidence === 'high') winner.confidence = 'medium';
      }
    } else {
      // Partially trimmed — keep the remainders as trimmed sessions
      for (const remainder of remainders) {
        const trimmed: WorkSession = {
          ...session,
          id: `${session.id}#${remainder.start}`,
          start: remainder.start,
          end: remainder.end,
          estimatedMinutes: Math.max(remainder.end - remainder.start, 2),
          trimmed: true,
          originalStart: session.start,
          originalEnd: session.end,
          confidence: downgradeConfidence(session.confidence),
        };
        result.push(trimmed);
        addInterval(occupied, remainder.start, remainder.end);
      }
    }
  }

  result.sort((a, b) => a.start - b.start);
  return result;
}

interface Interval {
  start: number;
  end: number;
}

function addInterval(list: Interval[], start: number, end: number): void {
  list.push({ start, end });
  list.sort((a, b) => a.start - b.start);
  // Merge contiguous intervals
  const merged: Interval[] = [];
  for (const iv of list) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  list.length = 0;
  list.push(...merged);
}

function findOverlaps(session: WorkSession, occupied: Interval[]): Interval[] {
  return occupied.filter((iv) => iv.start < session.end && iv.end > session.start);
}

function trimToRemainders(
  session: WorkSession,
  overlaps: Interval[],
): Interval[] {
  // Compute the non-overlapping parts of [session.start, session.end]
  let free: Interval[] = [{ start: session.start, end: session.end }];

  for (const ov of overlaps) {
    const next: Interval[] = [];
    for (const f of free) {
      // f = [f.start, f.end], ov = [ov.start, ov.end]
      if (ov.end <= f.start || ov.start >= f.end) {
        // No overlap
        next.push(f);
      } else {
        // Left remainder
        if (ov.start > f.start) {
          next.push({ start: f.start, end: ov.start });
        }
        // Right remainder
        if (ov.end < f.end) {
          next.push({ start: ov.end, end: f.end });
        }
      }
    }
    free = next;
  }

  // Filter out tiny remainders (< 2 min)
  return free.filter((f) => f.end - f.start >= 2);
}

function findWinner(
  session: WorkSession,
  result: WorkSession[],
): WorkSession | undefined {
  // Find the highest-priority session that overlaps the absorbed session
  let winner: WorkSession | undefined;
  for (const s of result) {
    if (s.start < session.end && s.end > session.start) {
      if (!winner || PRIORITY[s.provider] > PRIORITY[winner.provider]) {
        winner = s;
      }
    }
  }
  return winner;
}

function downgradeConfidence(c: 'high' | 'medium' | 'low'): 'high' | 'medium' | 'low' {
  if (c === 'high') return 'medium';
  if (c === 'medium') return 'low';
  return 'low';
}

// Exported for testing
export { PRIORITY, trimToRemainders, findOverlaps, addInterval };
export type { Interval };
