import type { WorkSession } from './types';
import type { ExclusionRuleInput } from './types';

// Stage 4: Filter
// Drop sessions matching exclusion rules. Drop sessions under 2 minutes
// unless they belong to a group totalling more than 6 minutes.

export function filterSessions(
  sessions: WorkSession[],
  rules: ExclusionRuleInput[],
): WorkSession[] {
  const afterExclusion = applyExclusionRules(sessions, rules);
  return applyMinimumDuration(afterExclusion);
}

function applyExclusionRules(
  sessions: WorkSession[],
  rules: ExclusionRuleInput[],
): WorkSession[] {
  if (rules.length === 0) return sessions;

  return sessions.filter((session) => {
    for (const rule of rules) {
      if (matchesRule(session, rule)) return false;
    }
    return true;
  });
}

function matchesRule(session: WorkSession, rule: ExclusionRuleInput): boolean {
  const value = rule.value.toLowerCase();
  const label = session.label.toLowerCase();

  switch (rule.ruleType) {
    case 'email_domain':
      if (session.provider !== 'email') return false;
      return label.toLowerCase().includes(value) || session.label.toLowerCase().includes(value);
    case 'chat_channel':
      if (session.provider !== 'chat') return false;
      return session.groupKey.toLowerCase().includes(value);
    case 'calendar_keyword':
      if (session.provider !== 'calendar') return false;
      return label.includes(value);
    default:
      return false;
  }
}

function applyMinimumDuration(sessions: WorkSession[]): WorkSession[] {
  // Group sessions by groupKey to check the group total
  const byGroup = new Map<string, WorkSession[]>();
  for (const s of sessions) {
    const list = byGroup.get(s.groupKey) ?? [];
    list.push(s);
    byGroup.set(s.groupKey, list);
  }

  const groupTotals = new Map<string, number>();
  for (const [key, group] of byGroup) {
    groupTotals.set(key, group.reduce((sum, s) => sum + s.estimatedMinutes, 0));
  }

  return sessions.filter((s) => {
    if (s.estimatedMinutes >= 2) return true;
    // Under 2 min — keep only if the group total exceeds 6 min
    return (groupTotals.get(s.groupKey) ?? 0) > 6;
  });
}
