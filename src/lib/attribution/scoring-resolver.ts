// Deterministic scoring resolver.
//
// Takes the estimator's sessions plus cached matters, contacts, and rules,
// and returns for each session a ranked list of candidate matters with scores
// and human-readable reasons. No AI model is involved — a lawyer must be able
// to see why work was attributed to a client.

import type {
  ActivityItem,
  Matter,
  MatterRule,
  MatterConfidence,
  Provider,
} from '@/types';
import type { EstimatedEntry } from '@/lib/estimator/types';
import type { EmailLookupIndex, EmailMatterMatch } from '@/providers/singlecase/lookups';
import { GENERIC_EMAIL_DOMAINS } from '@/providers/singlecase/constants';
import {
  SIGNAL_WEIGHTS,
  SCORING_THRESHOLDS,
  DEFAULT_CASE_REF_PATTERN,
} from './scoring-constants';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ScoredCandidate {
  matterId: string;
  matter: Matter;
  score: number;
  reasons: string[];
  isOverride: boolean;
}

export interface ResolvedSession {
  sessionId: string;
  sourceItemIds: string[];
  candidates: ScoredCandidate[];
  // The final decision
  matterId: string | null;
  matter: Matter | null;
  confidence: MatterConfidence;
  reason: string;
  isOverride: boolean;
}

export interface ResolverContext {
  matters: Matter[];
  contacts: ContactIndexEntry[];
  matterContacts: MatterContactEntry[];
  matterRules: MatterRule[];
  emailLookup: EmailLookupIndex;
  currentUserId: string | null;
  caseRefPattern?: RegExp;
}

export interface ContactIndexEntry {
  external_id: string;
  display_name: string;
  emails: string[];
}

export interface MatterContactEntry {
  matter_id: string; // matches Matter.id
  contact_external_id: string;
  role: 'contact' | 'adversary';
}

// ---------------------------------------------------------------------------
// resolveSessions — the entry point
// ---------------------------------------------------------------------------

export function resolveSessions(
  entries: EstimatedEntry[],
  sourceItems: ActivityItem[],
  ctx: ResolverContext,
): ResolvedSession[] {
  const itemsById = new Map<string, ActivityItem>();
  for (const item of sourceItems) itemsById.set(item.id, item);

  // Build lookup indexes once
  const matterByExternalId = new Map(ctx.matters.map((m) => [m.external_id, m]));
  const matterById = new Map(ctx.matters.map((m) => [m.id, m]));

  // Email address → MatterContactEntry[]
  const contactsByEmail = new Map<string, { matterId: string; role: 'contact' | 'adversary'; contact: ContactIndexEntry }[]>();
  for (const mc of ctx.matterContacts) {
    const contact = ctx.contacts.find((c) => c.external_id === mc.contact_external_id);
    if (!contact) continue;
    for (const email of contact.emails) {
      const key = email.toLowerCase();
      const list = contactsByEmail.get(key) ?? [];
      list.push({ matterId: mc.matter_id, role: mc.role, contact });
      contactsByEmail.set(key, list);
    }
  }

  // Domain → MatterContactEntry[] (non-generic only)
  const contactsByDomain = new Map<string, { matterId: string; role: 'contact' | 'adversary'; contact: ContactIndexEntry }[]>();
  for (const [email, matches] of contactsByEmail) {
    const domain = email.split('@')[1];
    if (!domain || GENERIC_EMAIL_DOMAINS.has(domain)) continue;
    const list = contactsByDomain.get(domain) ?? [];
    list.push(...matches);
    contactsByDomain.set(domain, list);
  }

  // Client primary_domain → client_external_id (from matters)
  const domainToClient = new Map<string, string>();
  for (const matter of ctx.matters) {
    // We don't have Client records here, but Matter has client_external_id.
    // The domain→client mapping is built from the emailLookup's byDomain index
    // cross-referenced with matters. For the resolver, we use the emailLookup
    // domain index which already excludes generic domains.
  }

  // Rules keyed by type:value
  const rulesByKey = new Map<string, MatterRule[]>();
  for (const rule of ctx.matterRules) {
    const key = `${rule.rule_type}:${rule.value.toLowerCase()}`;
    const list = rulesByKey.get(key) ?? [];
    list.push(rule);
    rulesByKey.set(key, list);
  }

  const pattern = ctx.caseRefPattern ?? DEFAULT_CASE_REF_PATTERN;

  // First pass: score every session independently
  const firstPass = entries.map((entry) => {
    const items = entry.sourceItemIds
      .map((id) => itemsById.get(id))
      .filter((i): i is ActivityItem => i !== undefined);
    return scoreOneSession(entry, items, {
      matters: ctx.matters,
      matterById,
      matterByExternalId,
      contacts: ctx.contacts,
      contactsByEmail,
      contactsByDomain,
      rulesByKey,
      currentUserId: ctx.currentUserId,
      pattern,
      emailLookup: ctx.emailLookup,
    });
  });

  // Second pass: adjacency boost (never chains)
  return applyAdjacencyBoost(firstPass, entries, SCORING_THRESHOLDS.adjacencyWindowMinutes, ctx.matters);
}

// ---------------------------------------------------------------------------
// First pass: score one session
// ---------------------------------------------------------------------------

interface ScoreContext {
  matters: Matter[];
  matterById: Map<string, Matter>;
  matterByExternalId: Map<string, Matter>;
  contacts: ContactIndexEntry[];
  contactsByEmail: Map<string, { matterId: string; role: 'contact' | 'adversary'; contact: ContactIndexEntry }[]>;
  contactsByDomain: Map<string, { matterId: string; role: 'contact' | 'adversary'; contact: ContactIndexEntry }[]>;
  rulesByKey: Map<string, MatterRule[]>;
  currentUserId: string | null;
  pattern: RegExp;
  emailLookup: EmailLookupIndex;
}

function scoreOneSession(
  entry: EstimatedEntry,
  items: ActivityItem[],
  ctx: ScoreContext,
): ResolvedSession {
  // --- Override 1: Email filed to a matter via Outlook add-in ---
  // Detected when a SingleCase email_filed activity item is among the source
  // items for this session (the Outlook add-in filed the thread to a case).
  // Check this BEFORE the generic SingleCase override so the reason says
  // "Outlook" rather than "SingleCase".
  const filedItem = items.find(
    (i) => i.provider === 'singlecase' && i.meta.scActivityKind === 'email_filed',
  );
  if (filedItem && filedItem.meta.caseId) {
    const matter = ctx.matterByExternalId.get(filedItem.meta.caseId);
    if (matter) {
      return {
        sessionId: entry.id,
        sourceItemIds: entry.sourceItemIds,
        candidates: [{
          matterId: matter.id,
          matter,
          score: 100,
          reasons: ['Filed to this matter from Outlook'],
          isOverride: true,
        }],
        matterId: matter.id,
        matter,
        confidence: 'confirmed',
        reason: 'Filed to this matter from Outlook',
        isOverride: true,
      };
    }
  }

  // --- Override 2: SingleCase with known matter (non-email_filed) ---
  if (entry.provider === 'singlecase') {
    const caseId = items.length > 0 ? (items[0].meta.caseId ?? null) : null;
    if (caseId) {
      const matter = ctx.matterByExternalId.get(caseId);
      if (matter) {
        return {
          sessionId: entry.id,
          sourceItemIds: entry.sourceItemIds,
          candidates: [{
            matterId: matter.id,
            matter,
            score: 100,
            reasons: ['Filed in this matter from SingleCase'],
            isOverride: true,
          }],
          matterId: matter.id,
          matter,
          confidence: 'confirmed',
          reason: 'Filed in this matter from SingleCase',
          isOverride: true,
        };
      }
    }
    return emptyResult(entry.id, entry.sourceItemIds);
  }

  // --- Gather all participant emails from the session's items ---
  const participantEmails = new Set<string>();
  for (const item of items) {
    if (item.meta.sender) participantEmails.add(item.meta.sender.toLowerCase());
    if (item.meta.recipient) participantEmails.add(item.meta.recipient.toLowerCase());
  }

  // --- Gather all text fields to search for case references ---
  const searchTexts: string[] = [];
  for (const item of items) {
    if (item.meta.subject) searchTexts.push(normalizeText(item.meta.subject));
    if (item.meta.fileName) searchTexts.push(normalizeText(item.meta.fileName));
    if (item.meta.ticketTitle) searchTexts.push(normalizeText(item.meta.ticketTitle));
    if (item.meta.title) searchTexts.push(normalizeText(item.meta.title));
    if (item.summary) searchTexts.push(normalizeText(item.summary));
    if (item.meta.bodySnippet) searchTexts.push(normalizeText(item.meta.bodySnippet));
  }
  // Also include the session label and absorbed labels — these survive even
  // when overlap resolution absorbs the email into a higher-priority session.
  searchTexts.push(normalizeText(entry.label));
  for (const absorbed of entry.absorbed) {
    searchTexts.push(normalizeText(absorbed.label));
  }

  // --- Score every matter ---
  const candidateMap = new Map<string, { score: number; reasons: string[] }>();

  for (const matter of ctx.matters) {
    const signals: { score: number; reason: string }[] = [];

    // Signal: document path in matter's known folder
    // (For mock: check if fileName contains matter case_id_visible or case_no)
    for (const item of items) {
      if (item.provider === 'documents' && item.meta.fileName) {
        const fn = item.meta.fileName.toLowerCase();
        if (matter.case_id_visible && fn.includes(matter.case_id_visible.toLowerCase())) {
          signals.push({ score: SIGNAL_WEIGHTS.documentPathInMatterFolder, reason: `Document in ${matter.case_id_visible} folder` });
          break;
        }
        if (matter.case_no && fn.includes(matter.case_no.toLowerCase())) {
          signals.push({ score: SIGNAL_WEIGHTS.documentPathInMatterFolder, reason: `Document in ${matter.case_no} folder` });
          break;
        }
      }
    }

    // Signal: case_id_visible / case_no / court_case_no matched in text
    const refs = extractCaseRefs(searchTexts, ctx.pattern);
    if (refs.length > 0) {
      const matterRefs = [
        matter.case_id_visible,
        matter.case_no,
        matter.court_case_no,
      ].filter(Boolean) as string[];
      for (const ref of refs) {
        if (matterRefs.some((mr) => mr.toLowerCase() === ref.toLowerCase())) {
          const refLabel = matter.case_id_visible && ref.toLowerCase() === matter.case_id_visible.toLowerCase()
            ? matter.case_id_visible
            : ref;
          signals.push({ score: SIGNAL_WEIGHTS.caseIdVisibleMatch, reason: `Case reference ${refLabel} found in text` });
          break;
        }
      }
    }

    // Signal: matter name found in email subject/body or calendar title
    // Exact label match (session label == matter name, or matter name appears as
    // a complete token sequence in any search text after stripping RE:/FW: etc.)
    // scores higher and uses a relaxed lead threshold so a uniquely-named session
    // is always auto-assigned.
    if (matter.name && matter.name.length > 3) {
      const matterNameNorm = normalizeText(matter.name).toLowerCase();
      const sessionLabelNorm = normalizeText(entry.label).toLowerCase();
      // Strip common email subject prefixes before comparing
      const strippedLabel = sessionLabelNorm.replace(/^(re|fw|fwd|tr|aw):\s*/i, '').trim();
      if (sessionLabelNorm === matterNameNorm || strippedLabel === matterNameNorm) {
        signals.push({ score: SIGNAL_WEIGHTS.exactLabelMatch, reason: `Session label exactly matches matter name "${matter.name}"` });
      } else {
        // Check if the matter name appears as a word-boundary match in any text
        // (covers subjects like "RE: Internal Know-How — some extra context")
        const escapedName = matterNameNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const boundaryRe = new RegExp(`(?:^|[\\s:,;(\\[])${escapedName}(?:[\\s.,;:)\\]]|$)`);
        let foundExact = false;
        for (const text of searchTexts) {
          if (text.toLowerCase() === matterNameNorm || boundaryRe.test(text.toLowerCase())) {
            foundExact = true;
            break;
          }
        }
        if (foundExact) {
          signals.push({ score: SIGNAL_WEIGHTS.exactLabelMatch, reason: `Session label exactly matches matter name "${matter.name}"` });
        } else {
          for (const text of searchTexts) {
            if (text.toLowerCase().includes(matterNameNorm)) {
              signals.push({ score: SIGNAL_WEIGHTS.matterNameInText, reason: `Matter name "${matter.name}" found in text` });
              break;
            }
          }
        }
      }
    }

    // Signal: user rule match
    for (const item of items) {
      const ruleCandidates = getCandidateRuleValues(item);
      for (const { ruleType, value } of ruleCandidates) {
        const key = `${ruleType}:${value.toLowerCase()}`;
        const rules = ctx.rulesByKey.get(key);
        if (rules && rules.length > 0) {
          const rule = rules[0];
          if (rule.matter_id === matter.id) {
            signals.push({ score: SIGNAL_WEIGHTS.userRuleMatch, reason: `Your rule: ${ruleType.replace(/_/g, ' ')} ${value}` });
          }
        }
      }
    }

    // Signal: exact email contact match (+10 per additional, cap 90)
    const matchingContacts = new Set<string>();
    let isAdversaryOnly = true;
    let hasContactMatch = false;
    for (const email of participantEmails) {
      const matches = ctx.contactsByEmail.get(email) ?? [];
      for (const m of matches) {
        if (m.matterId === matter.id) {
          matchingContacts.add(m.contact.external_id);
          if (m.role === 'contact') { hasContactMatch = true; isAdversaryOnly = false; }
          if (m.role === 'adversary') { hasContactMatch = true; }
        }
      }
    }

    if (hasContactMatch && !isAdversaryOnly) {
      const contactEntries = [...participantEmails].flatMap((email) =>
        (ctx.contactsByEmail.get(email) ?? []).filter((m) => m.matterId === matter.id && m.role === 'contact'),
      );
      const distinctContacts = new Set(contactEntries.map((c) => c.contact.external_id));
      const base = SIGNAL_WEIGHTS.exactEmailContact;
      const bonus = Math.min(
        (distinctContacts.size - 1) * SCORING_THRESHOLDS.exactEmailPerExtraContact,
        SCORING_THRESHOLDS.exactEmailCap - base,
      );
      const contactNames = [...distinctContacts].map((id) => {
        const c = ctx.contacts.find((ct) => ct.external_id === id);
        return c?.display_name ?? id;
      });
      const firstEmail = [...participantEmails].find((email) =>
        (ctx.contactsByEmail.get(email) ?? []).some((m) => m.matterId === matter.id && m.role === 'contact'),
      );
      signals.push({
        score: base + bonus,
        reason: `${firstEmail} is a contact on ${matter.case_id_visible ?? matter.name}`,
      });
    } else if (hasContactMatch && isAdversaryOnly) {
      const advEntries = [...participantEmails].flatMap((email) =>
        (ctx.contactsByEmail.get(email) ?? []).filter((m) => m.matterId === matter.id && m.role === 'adversary'),
      );
      const firstAdvEmail = [...participantEmails].find((email) =>
        (ctx.contactsByEmail.get(email) ?? []).some((m) => m.matterId === matter.id && m.role === 'adversary'),
      );
      signals.push({
        score: SIGNAL_WEIGHTS.adversaryMatch,
        reason: `${firstAdvEmail} is an adversary on ${matter.case_id_visible ?? matter.name}`,
      });
    }

    // Signal: domain matches client primary_domain
    // Skip if exact email already matched on this matter (avoid double-counting)
    const hasExactEmailMatch = signals.some((s) => s.reason.includes('is a contact on') || s.reason.includes('is an adversary on'));
    if (!hasExactEmailMatch) {
      for (const email of participantEmails) {
        const domain = email.split('@')[1];
        if (!domain || GENERIC_EMAIL_DOMAINS.has(domain)) continue;
        const domainMatches = ctx.contactsByDomain.get(domain) ?? [];
        const matterDomainMatches = domainMatches.filter((m) => m.matterId === matter.id);
        if (matterDomainMatches.length > 0) {
          const totalDomainMatches = domainMatches.length;
          const splitScore = Math.round(SIGNAL_WEIGHTS.domainPrimaryMatch / totalDomainMatches);
          signals.push({
            score: splitScore,
            reason: `Domain ${domain} belongs to this client${totalDomainMatches > 1 ? ` (${totalDomainMatches} cases share it)` : ''}`,
          });
          break;
        }
      }
    }

    // Signal: responsible_user boost (only if already scoring > 0)
    const preliminaryScore = signals.reduce((s, sig) => s + sig.score, 0);
    if (preliminaryScore > 0 && matter.responsible_user_id && matter.responsible_user_id === ctx.currentUserId) {
      signals.push({ score: SIGNAL_WEIGHTS.responsibleUserBoost, reason: `You are the responsible lawyer` });
    }

    // Signal: token overlap between matter/client name and session label
    const sessionLabel = entry.label.toLowerCase();
    const matterTokens = tokenize(`${matter.name} ${getMatterClientName(matter)}`);
    const sessionTokens = tokenize(sessionLabel);
    const overlap = matterTokens.filter((t) => sessionTokens.includes(t));
    if (overlap.length >= 2) {
      signals.push({ score: SIGNAL_WEIGHTS.tokenOverlap, reason: `Shares keywords: ${overlap.slice(0, 3).join(', ')}` });
    } else if (overlap.length === 1 && matterTokens.length <= 3) {
      signals.push({ score: SIGNAL_WEIGHTS.tokenOverlap, reason: `Shares keyword: ${overlap[0]}` });
    }

    // Signal: recent activity (tiebreaker — only if already scoring > 0)
    const scoreBeforeRecent = signals.reduce((s, sig) => s + sig.score, 0);
    if (scoreBeforeRecent > 0 && matter.last_activity_at) {
      const daysSince = daysBetween(matter.last_activity_at, entryStartIso(items));
      if (daysSince >= 0 && daysSince <= SCORING_THRESHOLDS.recentActivityDays) {
        signals.push({ score: SIGNAL_WEIGHTS.recentActivity, reason: `Active in the last ${SCORING_THRESHOLDS.recentActivityDays} days` });
      }
    }

    // Penalty: closed case (only when state_is_open is definitively false)
    if (matter.project_state_id !== null && !matter.state_is_open) {
      signals.push({ score: SIGNAL_WEIGHTS.closedCasePenalty, reason: `Matter is closed` });
    }

    // Sum signals
    const totalScore = signals.reduce((s, sig) => s + sig.score, 0);
    if (totalScore > 0) {
      candidateMap.set(matter.id, {
        score: totalScore,
        reasons: signals.map((s) => s.reason),
      });
    }
  }

  // Build sorted candidates
  const candidates: ScoredCandidate[] = [...candidateMap.entries()]
    .map(([matterId, { score, reasons }]) => {
      const matter = ctx.matterById.get(matterId)!;
      return { matterId, matter, score, reasons, isOverride: false };
    })
    .sort((a, b) => b.score - a.score);

  return makeDecision(entry.id, entry.sourceItemIds, candidates);
}

// ---------------------------------------------------------------------------
// Second pass: adjacency boost
// ---------------------------------------------------------------------------

function applyAdjacencyBoost(
  sessions: ResolvedSession[],
  entries: EstimatedEntry[],
  windowMinutes: number,
  matters: Matter[],
): ResolvedSession[] {
  // Build a map: session id → resolved matterId (only auto-assigned ones)
  const resolvedByStart = new Map<number, string | null>();
  const sessionByEntryId = new Map<string, ResolvedSession>();
  const entryById = new Map<string, EstimatedEntry>();

  for (let i = 0; i < sessions.length; i++) {
    sessionByEntryId.set(sessions[i].sessionId, sessions[i]);
    entryById.set(entries[i].id, entries[i]);
  }

  // For each session that was NOT auto-assigned (or is unassigned),
  // check if an adjacent session within 30 min resolved to a matter
  // that is a candidate here. Add adjacency boost.
  const result = sessions.map((s) => {
    if (s.isOverride) return s;
    const entry = entryById.get(s.sessionId)!;
    if (!entry) return s;

    // Find adjacent sessions
    const adjacentMatters = new Map<string, number>(); // matterId → boost count
    for (const otherEntry of entries) {
      if (otherEntry.id === entry.id) continue;
      const otherSession = sessionByEntryId.get(otherEntry.id);
      if (!otherSession || !otherSession.matterId) continue;
      // Only auto-assigned or confirmed sessions can seed adjacency
      if (otherSession.confidence === 'unassigned') continue;

      const gap = Math.abs(otherEntry.start - entry.end);
      const gap2 = Math.abs(entry.start - otherEntry.end);
      const minGap = Math.min(gap, gap2);
      if (minGap <= windowMinutes) {
        adjacentMatters.set(otherSession.matterId, (adjacentMatters.get(otherSession.matterId) ?? 0) + 1);
      }
    }

    if (adjacentMatters.size === 0) return s;

    // Apply boost to existing candidates, and create new ones for adjacent
    // matters that aren't already candidates
    const existingMatterIds = new Set(s.candidates.map((c) => c.matterId));
    const boostedCandidates = s.candidates.map((c) => {
      const boost = adjacentMatters.get(c.matterId);
      if (!boost) return c;
      return {
        ...c,
        score: c.score + SIGNAL_WEIGHTS.adjacentSessionSameMatter,
        reasons: [...c.reasons, `Adjacent session resolved to this matter`],
      };
    });

    // Add new candidates for adjacent matters not already in the list
    for (const [matterId] of adjacentMatters) {
      if (existingMatterIds.has(matterId)) continue;
      const matter = matters.find((m: Matter) => m.id === matterId);
      if (!matter) continue;
      boostedCandidates.push({
        matterId,
        matter,
        score: SIGNAL_WEIGHTS.adjacentSessionSameMatter,
        reasons: ['Adjacent session resolved to this matter'],
        isOverride: false,
      });
    }

    boostedCandidates.sort((a, b) => b.score - a.score);

    return makeDecision(s.sessionId, s.sourceItemIds, boostedCandidates);
  });

  return result;
}

// ---------------------------------------------------------------------------
// Decision logic
// ---------------------------------------------------------------------------

function makeDecision(sessionId: string, sourceItemIds: string[], candidates: ScoredCandidate[]): ResolvedSession {
  if (candidates.length === 0) {
    return emptyResult(sessionId, sourceItemIds);
  }

  const top = candidates[0];
  const second = candidates[1];
  const lead = second ? top.score - second.score : top.score;

  // Exact label match: session label == matter name — assign unconditionally,
  // no lead threshold required. This is as reliable as a SingleCase override.
  const isExactLabelMatch = top.reasons.some((r) => r.startsWith('Session label exactly matches'));
  if (isExactLabelMatch) {
    return {
      sessionId,
      sourceItemIds,
      candidates,
      matterId: top.matterId,
      matter: top.matter,
      confidence: 'high',
      reason: top.reasons[0],
      isOverride: false,
    };
  }

  // Auto-assign when top scores >= 70 and leads by >= 25.
  if (top.score >= SCORING_THRESHOLDS.autoAssignMinScore && lead >= SCORING_THRESHOLDS.autoAssignMinLead) {
    const confidence: MatterConfidence =
      top.score >= SCORING_THRESHOLDS.highConfidenceMin ? 'high' : 'medium';
    return {
      sessionId,
      sourceItemIds,
      candidates,
      matterId: top.matterId,
      matter: top.matter,
      confidence,
      reason: top.reasons[0],
      isOverride: false,
    };
  }

  // Otherwise — unassigned (including when two candidates both score high)
  return {
    sessionId,
    sourceItemIds,
    candidates,
    matterId: null,
    matter: null,
    confidence: 'unassigned',
    reason: candidates.length > 1 && lead < SCORING_THRESHOLDS.autoAssignMinLead
      ? `Two strong candidates: ${top.matter.case_id_visible ?? top.matter.name} (${top.score}) and ${second!.matter.case_id_visible ?? second!.matter.name} (${second!.score})`
      : 'Needs a matter',
    isOverride: false,
  };
}

function emptyResult(sessionId: string, sourceItemIds: string[] = []): ResolvedSession {
  return {
    sessionId,
    sourceItemIds,
    candidates: [],
    matterId: null,
    matter: null,
    confidence: 'unassigned',
    reason: 'No signal matched any matter',
    isOverride: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCandidateRuleValues(item: ActivityItem): { ruleType: string; value: string }[] {
  const candidates: { ruleType: string; value: string }[] = [];
  const m = item.meta;
  switch (item.provider) {
    case 'email':
      if (m.sender) {
        candidates.push({ ruleType: 'email_address', value: m.sender });
        const d = m.sender.split('@')[1];
        if (d) candidates.push({ ruleType: 'email_domain', value: d });
      }
      if (m.recipient) {
        candidates.push({ ruleType: 'email_address', value: m.recipient });
        const d = m.recipient.split('@')[1];
        if (d) candidates.push({ ruleType: 'email_domain', value: d });
      }
      if (m.subject) candidates.push({ ruleType: 'keyword', value: m.subject });
      break;
    case 'chat':
      if (m.channel) candidates.push({ ruleType: 'chat_channel', value: m.channel });
      break;
    case 'calendar':
      if (m.title) candidates.push({ ruleType: 'calendar_series', value: m.title });
      break;
    case 'documents':
      if (m.fileName) candidates.push({ ruleType: 'file_path_prefix', value: m.fileName });
      break;
  }
  return candidates;
}

function extractCaseRefs(texts: string[], pattern: RegExp): string[] {
  const refs: string[] = [];
  for (const text of texts) {
    const localPattern = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = localPattern.exec(text)) !== null) {
      refs.push(match[0]);
    }
  }
  return refs;
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .toLowerCase()
    .split(/[\s\-,.;:!?()[\]{}'"'/\\]+/)
    .filter((t) => t.length >= 3)
    .filter((t) => !STOP_WORDS.has(t));
}

// Normalize text for comparison: convert Unicode dashes/hyphens to ASCII,
// replace non-breaking spaces and other whitespace variants with regular
// spaces, collapse multiple spaces, and trim — so that "Internal Know‑How"
// (non-breaking hyphen) or "Internal\u00A0Know-How" (non-breaking space)
// both match "Internal Know-How".
function normalizeText(text: string): string {
  return text
    .replace(/[\u2010-\u2015\u2212\uFE63\uFF0D]/g, '-')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/\u200C|\u200D|\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'his', 'how', 'its', 'may', 'new',
  'now', 'old', 'see', 'way', 'who', 'did', 'get', 'let', 'say', 'she', 'too',
  'use', 'this', 'that', 'with', 'from', 'have', 'been', 'will', 'they', 'them',
  'what', 'when', 'your', 'their', 'there', 'where', 'which', 'would', 'could',
  'should', 'about', 'into', 'than', 'then', 'also', 'more', 'some', 'such',
  'only', 'very', 'over', 'under', 'just', 'like', 'make', 'made', 'after',
  'before', 'other', 'these', 'those', 'upon', 'within', 'without', 'among',
]);

function getMatterClientName(matter: Matter): string {
  // We don't have the Client object here, but the matter name often includes
  // client context. For token overlap, the matter name alone is sufficient.
  return '';
}

function daysBetween(isoDate: string, referenceIso: string): number {
  const d1 = new Date(isoDate.slice(0, 10));
  const d2 = new Date((referenceIso || new Date().toISOString()).slice(0, 10));
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function entryStartIso(items: ActivityItem[]): string {
  if (items.length === 0) return new Date().toISOString();
  return items[0].timestamp;
}
