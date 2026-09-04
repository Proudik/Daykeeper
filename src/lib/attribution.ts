import type {
  ActivityItem,
  MatterRule,
  EmailMatterLookup,
  Matter,
  AttributionResult,
  MatterConfidence,
  Provider,
} from '@/types';
import type { EstimatedEntry } from '@/lib/estimator/types';
import type { EmailLookupIndex, EmailMatterMatch } from '@/providers/singlecase/lookups';

export interface AttributionContext {
  emailLookup: EmailLookupIndex | EmailMatterLookup[];
  matterRules: MatterRule[];
  matters: Matter[];
}

export interface AttributedEntry extends EstimatedEntry {
  attribution: AttributionResult;
}

export function attributeEntries(
  entries: EstimatedEntry[],
  sourceItems: ActivityItem[],
  ctx: AttributionContext,
): AttributedEntry[] {
  const emailByAddress = new Map<string, EmailMatterLookup[]>();
  const emailByDomain = new Map<string, EmailMatterLookup[]>();

  if ('byAddress' in ctx.emailLookup && 'byDomain' in ctx.emailLookup) {
    const idx = ctx.emailLookup as EmailLookupIndex;
    for (const [addr, matches] of idx.byAddress) {
      emailByAddress.set(addr, matches.map((m: EmailMatterMatch) => ({
        id: '', org_id: '', email_address: m.email_address, email_domain: m.email_domain,
        matter_id: m.matter_id, contact_external_id: m.contact_external_id ?? '',
      })));
    }
    for (const [domain, matches] of idx.byDomain) {
      emailByDomain.set(domain, matches.map((m: EmailMatterMatch) => ({
        id: '', org_id: '', email_address: m.email_address, email_domain: m.email_domain,
        matter_id: m.matter_id, contact_external_id: m.contact_external_id ?? '',
      })));
    }
  } else {
    for (const row of ctx.emailLookup as EmailMatterLookup[]) {
      const addrList = emailByAddress.get(row.email_address) ?? [];
      addrList.push(row);
      emailByAddress.set(row.email_address, addrList);
      const domainList = emailByDomain.get(row.email_domain) ?? [];
      domainList.push(row);
      emailByDomain.set(row.email_domain, domainList);
    }
  }

  const rulesByKey = new Map<string, MatterRule[]>();
  for (const rule of ctx.matterRules ?? []) {
    const key = `${rule.rule_type}:${rule.value.toLowerCase()}`;
    const list = rulesByKey.get(key) ?? [];
    list.push(rule);
    rulesByKey.set(key, list);
  }

  const itemsById = new Map<string, ActivityItem>();
  for (const item of sourceItems) itemsById.set(item.id, item);

  return entries.map((entry) => {
    const attribution = attributeOne(entry, itemsById, emailByAddress, emailByDomain, rulesByKey, ctx.matters);
    return { ...entry, attribution };
  });
}

function attributeOne(
  entry: EstimatedEntry,
  itemsById: Map<string, ActivityItem>,
  emailByAddress: Map<string, EmailMatterLookup[]>,
  emailByDomain: Map<string, EmailMatterLookup[]>,
  rulesByKey: Map<string, MatterRule[]>,
  matters: Matter[],
): AttributionResult {
  const items = entry.sourceItemIds
    .map((id) => itemsById.get(id))
    .filter((i): i is ActivityItem => i !== undefined);

  if (items.length === 0) {
    return { matterId: null, confidence: 'unassigned', reason: 'No source items', source: 'estimator' };
  }

  // SingleCase items arrive with the case already known — confirmed, never scored
  if (entry.provider === 'singlecase') {
    const caseId = items[0].meta.caseId ?? null;
    if (caseId) {
      const matter = matters.find((m) => m.external_id === caseId);
      return {
        matterId: matter?.id ?? null,
        confidence: 'confirmed',
        reason: `SingleCase: ${items[0].meta.caseName ?? caseId}`,
        source: 'singlecase',
      };
    }
    return { matterId: null, confidence: 'unassigned', reason: 'SingleCase item without case id', source: 'singlecase' };
  }

  // 1. Check personal matter_rules first (highest priority)
  const ruleMatch = matchByRules(items, rulesByKey, matters);
  if (ruleMatch) return ruleMatch;

  // 2. Check email_matter_lookup by email address
  const emailMatch = matchByEmail(items, emailByAddress, emailByDomain, matters);
  if (emailMatch) return emailMatch;

  // 3. Calendar events: try to match by title keyword against matter names
  const calendarMatch = matchCalendarByTitle(items, matters);
  if (calendarMatch) return calendarMatch;

  // 4. Emails: try to match by subject against matter names
  const emailSubjectMatch = matchEmailBySubject(items, matters);
  if (emailSubjectMatch) return emailSubjectMatch;

  // 5. Documents/tasks: try to match by file name / ticket key against matter names
  const docTaskMatch = matchDocOrTask(items, matters);
  if (docTaskMatch) return docTaskMatch;

  // 5. No match — unassigned
  return {
    matterId: null,
    confidence: 'unassigned',
    reason: 'No matching matter rule or contact',
    source: 'estimator',
  };
}

function matchByRules(
  items: ActivityItem[],
  rulesByKey: Map<string, MatterRule[]>,
  matters: Matter[],
): AttributionResult | null {
  for (const item of items) {
    const candidates = getCandidateRuleValues(item);
    for (const { ruleType, value } of candidates) {
      const key = `${ruleType}:${value.toLowerCase()}`;
      const rules = rulesByKey.get(key);
      if (rules && rules.length > 0) {
        const rule = rules[0];
        if (rule.matter_id === null) {
          return { matterId: null, confidence: 'confirmed', reason: `Rule: ${ruleType} "${value}" → non-billable`, source: 'estimator' };
        }
        const matter = matters.find((m) => m.id === rule.matter_id);
        return { matterId: rule.matter_id, confidence: 'confirmed', reason: `Rule: ${ruleType} "${value}" → ${matter?.name ?? rule.matter_id}`, source: 'estimator' };
      }
    }
  }
  return null;
}

function getCandidateRuleValues(item: ActivityItem): { ruleType: string; value: string }[] {
  const candidates: { ruleType: string; value: string }[] = [];
  const m = item.meta;
  switch (item.provider) {
    case 'email':
      if (m.sender) { candidates.push({ ruleType: 'email_address', value: m.sender }); const d = m.sender.split('@')[1]; if (d) candidates.push({ ruleType: 'email_domain', value: d }); }
      if (m.recipient) { candidates.push({ ruleType: 'email_address', value: m.recipient }); const d = m.recipient.split('@')[1]; if (d) candidates.push({ ruleType: 'email_domain', value: d }); }
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

function matchByEmail(
  items: ActivityItem[],
  emailByAddress: Map<string, EmailMatterLookup[]>,
  emailByDomain: Map<string, EmailMatterLookup[]>,
  matters: Matter[],
): AttributionResult | null {
  for (const item of items) {
    if (item.provider !== 'email') continue;
    const m = item.meta;
    for (const addr of [m.sender, m.recipient].filter(Boolean) as string[]) {
      const rows = emailByAddress.get(addr);
      if (rows && rows.length > 0) {
        const matter = matters.find((mt) => mt.id === rows[0].matter_id);
        return { matterId: rows[0].matter_id, confidence: 'high', reason: `Contact email ${addr} → ${matter?.name ?? rows[0].matter_id}`, source: 'estimator' };
      }
    }
    for (const addr of [m.sender, m.recipient].filter(Boolean) as string[]) {
      const domain = addr.split('@')[1];
      if (!domain) continue;
      const rows = emailByDomain.get(domain);
      if (rows && rows.length === 1) {
        const matter = matters.find((mt) => mt.id === rows[0].matter_id);
        return { matterId: rows[0].matter_id, confidence: 'medium', reason: `Domain ${domain} → ${matter?.name ?? rows[0].matter_id}`, source: 'estimator' };
      }
      if (rows && rows.length > 1) {
        return { matterId: null, confidence: 'low', reason: `Domain ${domain} matches ${rows.length} matters — ambiguous`, source: 'estimator' };
      }
    }
  }
  return null;
}

function matchCalendarByTitle(items: ActivityItem[], matters: Matter[]): AttributionResult | null {
  for (const item of items) {
    if (item.provider !== 'calendar') continue;
    const title = item.meta.title ?? item.summary;
    for (const matter of matters) {
      if (matter.is_internal) continue;
      if (title.toLowerCase().includes(matter.name.toLowerCase()) && matter.name.length > 3) {
        return { matterId: matter.id, confidence: 'medium', reason: `Calendar title contains matter name "${matter.name}"`, source: 'estimator' };
      }
    }
  }
  return null;
}

function matchEmailBySubject(items: ActivityItem[], matters: Matter[]): AttributionResult | null {
  for (const item of items) {
    if (item.provider !== 'email') continue;
    const subject = item.meta.subject ?? '';
    if (!subject) continue;
    for (const matter of matters) {
      if (matter.is_internal) continue;
      if (matter.name.length > 3 && subject.toLowerCase().includes(matter.name.toLowerCase())) {
        return { matterId: matter.id, confidence: 'medium', reason: `Email subject contains matter name "${matter.name}"`, source: 'estimator' };
      }
    }
  }
  return null;
}

function matchDocOrTask(items: ActivityItem[], matters: Matter[]): AttributionResult | null {
  for (const item of items) {
    if (item.provider === 'documents') {
      const fileName = item.meta.fileName ?? '';
      for (const matter of matters) {
        if (matter.is_internal) continue;
        const words = matter.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        if (words.length > 0 && words.every((w) => fileName.toLowerCase().includes(w))) {
          return { matterId: matter.id, confidence: 'medium', reason: `File name matches matter "${matter.name}"`, source: 'estimator' };
        }
      }
    }
  }
  return null;
}

export interface MatterGroup {
  matterId: string | null;
  matter: Matter | null;
  label: string;
  entries: AttributedEntry[];
  totalMinutes: number;
  isInternal: boolean;
  isUnassigned: boolean;
}

export function groupByMatter(entries: AttributedEntry[], matters: Matter[]): MatterGroup[] {
  const byMatter = new Map<string | null, MatterGroup>();
  const matterMap = new Map(matters.map((m) => [m.id, m]));
  for (const entry of entries) {
    const matterId = entry.attribution.matterId;
    let group = byMatter.get(matterId);
    if (!group) {
      const matter = matterId ? (matterMap.get(matterId) ?? null) : null;
      group = {
        matterId, matter,
        label: matter?.name ?? (matter?.is_internal ? 'Non-billable / Internal' : 'Needs a matter'),
        entries: [], totalMinutes: 0,
        isInternal: matter?.is_internal ?? false,
        isUnassigned: matterId === null,
      };
      byMatter.set(matterId, group);
    }
    group.entries.push(entry);
    group.totalMinutes += entry.roundedMinutes;
  }
  return Array.from(byMatter.values()).sort((a, b) => {
    if (a.isInternal && !b.isInternal) return -1;
    if (!a.isInternal && b.isInternal) return 1;
    return b.totalMinutes - a.totalMinutes;
  });
}
