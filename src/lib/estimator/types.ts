import type { ActivityItem, Provider, RoundingMinutes } from '@/types';

// The normalized shape every activity item becomes after stage 1.
export interface NormalizedItem {
  id: string;
  provider: Provider;
  kind: string; // e.g. 'calendar.accepted', 'email.sent', 'chat.session'
  start: number; // minutes since midnight, in user's timezone
  end: number; // minutes since midnight (inclusive — end is the last active minute)
  weight: number; // baseline effort in minutes (before banding/overlap)
  label: string; // human-readable label for the session
  groupKey: string; // groups items into sessions (thread id, channel, ticket+hour, etc.)
  // Original metadata carried through for clustering and display.
  meta: ActivityItem['meta'];
  // Original timestamp strings (local) for display.
  startIso: string;
  endIso: string;
}

// A work session produced by the clustering stage.
export interface WorkSession {
  id: string;
  provider: Provider;
  kind: string;
  start: number; // minutes since midnight
  end: number; // minutes since midnight (inclusive)
  estimatedMinutes: number; // raw estimated effort
  label: string;
  groupKey: string;
  sourceItemIds: string[];
  confidence: 'high' | 'medium' | 'low';
  // Items absorbed by overlap resolution — kept as context, not billed.
  absorbed: AbsorbedContext[];
  // Whether this session was trimmed during overlap resolution.
  trimmed: boolean;
  // Original start/end before trimming (for display).
  originalStart?: number;
  originalEnd?: number;
}

export interface AbsorbedContext {
  provider: Provider;
  label: string;
  start: number;
  end: number;
  estimatedMinutes: number;
}

// After filtering + reconciliation, the final estimated entries.
export interface EstimatedEntry {
  id: string;
  provider: Provider;
  kind: string;
  start: number;
  end: number;
  rawMinutes: number; // pre-rounding
  roundedMinutes: number; // post-rounding
  label: string;
  groupKey: string;
  sourceItemIds: string[];
  confidence: 'high' | 'medium' | 'low';
  absorbed: AbsorbedContext[];
  trimmed: boolean;
  originalStart?: number;
  originalEnd?: number;
}

export interface Reconciliation {
  totalEstimatedMinutes: number;
  totalRoundedMinutes: number;
  daySpanMinutes: number; // first activity start to last activity end
  unaccountedGapMinutes: number; // daySpan - totalEstimated (can be negative if overlap-heavy)
  targetMinutes: number;
  targetMet: boolean;
}

export interface EstimateResult {
  entries: EstimatedEntry[];
  reconciliation: Reconciliation;
}

export interface EstimateOptions {
  timezone: string;
  workStart: string; // "HH:mm"
  workEnd: string; // "HH:mm"
  rounding: RoundingMinutes;
  targetHours: number;
  exclusionRules: ExclusionRuleInput[];
}

export interface ExclusionRuleInput {
  ruleType: string;
  value: string;
}
