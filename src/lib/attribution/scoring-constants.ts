// Signal weights and decision thresholds for the deterministic scoring resolver.
// Exported as one object so they can be tuned without touching resolver logic.

export const SIGNAL_WEIGHTS = {
  // Overrides — skip scoring entirely, confidence is confirmed.
  singlecaseKnownMatter: 'override' as const,
  outlookFiledToMatter: 'override' as const,

  // Strong signals
  documentPathInMatterFolder: 95,
  caseIdVisibleMatch: 90,
  exactLabelMatch: 92,
  matterNameInText: 80,
  userRuleMatch: 75,
  exactEmailContact: 70, // +10 per additional distinct matching contact, cap 90
  adversaryMatch: 55,

  // Moderate signals
  domainPrimaryMatch: 40,
  adjacentSessionSameMatter: 25, // second pass only, never chains
  responsibleUserBoost: 15, // boost only, never standalone
  tokenOverlap: 15,

  // Tiebreaker
  recentActivity: 5, // last 14 days

  // Penalty
  closedCasePenalty: -60, // only when state_is_open is definitively false
} as const;

export const SCORING_THRESHOLDS = {
  autoAssignMinScore: 70,
  autoAssignMinLead: 25,
  highConfidenceMin: 85,
  mediumConfidenceMin: 70,
  exactEmailPerExtraContact: 10,
  exactEmailCap: 90,
  adjacencyWindowMinutes: 30,
  recentActivityDays: 14,
} as const;

// Default case reference pattern: matches both YYYY-NNNN (e.g. 2016-0001)
// and YYYY/NNNN (e.g. 2024/0417) formats — SingleCase's visible case reference.
// Also matches court case numbers like "33C 7777/2023" via the court_case_no field.
// Configurable in Settings — passed to the resolver, not imported here.
export const DEFAULT_CASE_REF_PATTERN = /\b(\d{4})[-/](\d{4})\b/g;

// Generic domains never used for domain-based attribution.
// Re-exported from the SingleCase constants for the resolver's convenience.
export { GENERIC_EMAIL_DOMAINS } from '@/providers/singlecase/constants';
