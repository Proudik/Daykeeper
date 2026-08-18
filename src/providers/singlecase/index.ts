import type {
  ActivityItem,
  ActivityProvider,
  ActivityMeta,
  Provider,
  DateRange,
  Matter,
} from '@/types';
import type {
  SingleCaseActivity,
  SingleCaseTimeEntry,
  SingleCaseCase,
} from './types';
import {
  buildEmailLookup,
  type EmailLookupIndex,
  type EmailMatterMatch,
} from './lookups';
import { supabase } from '@/lib/supabase';
import { fetchScDocumentSignals } from '@/lib/signals';
import type { ScDocumentSignal } from '@/types/signals';

// ============================================================================
// SINGLECASE PROVIDER — loads org-scoped reference data from Supabase
//
// Matters, clients, contacts, and activity types are synced into Supabase
// by the admin's SingleCase connection. This factory loads them from the
// database (not from mock fixtures) and builds the lookup indices the
// attribution system needs.
//
// Activity items and existing time entries from SingleCase are not yet
// synced — the provider returns empty arrays for those.
// ============================================================================

export interface SingleCaseProviderData {
  provider: ActivityProvider;
  existingTimeEntries: SingleCaseTimeEntry[];
  cases: SingleCaseCase[];
  emailLookup: EmailLookupIndex;
  matters: Matter[];
  clients: { id: string; name: string }[];
  activityTypes: { id: string; name: string }[];
  contacts: { external_id: string; display_name: string; emails: string[] }[];
  matterContacts: { matter_id: string; contact_external_id: string; role: 'contact' | 'adversary' }[];
}

export async function createSingleCaseProvider(): Promise<SingleCaseProviderData> {
  // Get the user's org
  const { data: membership } = await supabase
    .from('organization_members')
    .select('org_id')
    .maybeSingle();

  if (!membership) {
    return emptyProviderData();
  }

  const orgId = (membership as { org_id: string }).org_id;

  // Load all org-scoped reference data in parallel
  const [
    { data: mattersData },
    { data: clientsData },
    { data: contactsData },
    { data: matterContactsData },
    { data: activityTypesData },
    { data: emailLookupData },
  ] = await Promise.all([
    supabase.from('matters').select('*').eq('org_id', orgId),
    supabase.from('clients').select('*').eq('org_id', orgId),
    supabase.from('contacts').select('*').eq('org_id', orgId),
    supabase.from('matter_contacts').select('*').eq('org_id', orgId),
    supabase.from('activity_types').select('*').eq('org_id', orgId).order('sort_order'),
    supabase.from('email_matter_lookup').select('*').eq('org_id', orgId),
  ]);

  const matters = (mattersData as Matter[] | null) ?? [];
  const clients = (clientsData as { id: string; external_id: string; name: string; primary_domain: string | null }[] | null) ?? [];
  const contacts = (contactsData as { id: string; external_id: string; display_name: string; emails: string[] }[] | null) ?? [];
  const matterContacts = (matterContactsData as { matter_id: string; contact_external_id: string; role: string }[] | null) ?? [];
  const activityTypes = (activityTypesData as { id: string; external_id: string; label: string }[] | null) ?? [];
  const emailLookupRows = (emailLookupData as { email_address: string; email_domain: string; matter_id: string; contact_external_id: string | null }[] | null) ?? [];

  // Build email lookup from the database rows
  const emailLookup = buildEmailLookupFromDb(matters, contacts, matterContacts, emailLookupRows);

  // Convert DB matters to SingleCaseCase shape (for toActivityItem)
  const cases: SingleCaseCase[] = matters.map((m) => ({
    id: m.external_id,
    case_id_visible: m.case_id_visible ?? '',
    name: m.name,
    case_no: m.case_no ?? '',
    court_case_no: m.court_case_no,
    client_id: m.client_external_id ?? '',
    parent_id: m.parent_external_id,
    project_state_id: m.project_state_id ?? '',
    currency: m.currency ?? 'CZK',
    language: (m.language === 'ces' || m.language === 'eng') ? m.language : 'ces',
    created: m.synced_at ?? new Date().toISOString(),
    responsible_user: m.responsible_user_id
      ? { id: m.responsible_user_id, first_name: '', last_name: m.responsible_user_name ?? '' }
      : null,
    custom_fields: Array.isArray(m.custom_fields)
      ? (m.custom_fields as { name: string; value: string }[])
      : Object.entries(m.custom_fields ?? {}).map(([name, value]) => ({ name, value: String(value) })),
    contacts: [],
    adversaries: [],
    courts: [],
    courts_global: [],
  }));

  const provider: ActivityProvider = {
    provider: 'singlecase' as Provider,
    label: 'SingleCase',
    async fetchActivity(dateRange: DateRange): Promise<ActivityItem[]> {
      const day = dateRange.start.slice(0, 10);
      const signals = await fetchScDocumentSignals(day);
      return signals.map((s) => scDocSignalToActivityItem(s));
    },
  };

  const existingTimeEntries: SingleCaseTimeEntry[] = [];

  return {
    provider,
    existingTimeEntries,
    cases,
    emailLookup,
    matters,
    clients: clients.map((c) => ({ id: c.external_id, name: c.name })),
    activityTypes: activityTypes.map((a) => ({ id: a.external_id, name: a.label })),
    contacts: contacts.map((c) => ({ external_id: c.external_id, display_name: c.display_name, emails: c.emails })),
    matterContacts: matterContacts.map((mc) => ({ matter_id: mc.matter_id, contact_external_id: mc.contact_external_id, role: mc.role as 'contact' | 'adversary' })),
  };
}

function emptyProviderData(): SingleCaseProviderData {
  return {
    provider: {
      provider: 'singlecase' as Provider,
      label: 'SingleCase',
      async fetchActivity(dateRange: DateRange): Promise<ActivityItem[]> {
        const day = dateRange.start.slice(0, 10);
        const signals = await fetchScDocumentSignals(day);
        return signals.map((s) => scDocSignalToActivityItem(s));
      },
    },
    existingTimeEntries: [],
    cases: [],
    emailLookup: { byAddress: new Map(), byDomain: new Map() },
    matters: [],
    clients: [],
    activityTypes: [],
    contacts: [],
    matterContacts: [],
  };
}

function scDocSignalToActivityItem(s: ScDocumentSignal): ActivityItem {
  const meta: ActivityMeta = {
    caseId: s.case_id ?? undefined,
    caseName: s.case_name ?? undefined,
    caseIdVisible: s.case_id_visible ?? undefined,
    scActivityKind: 'document',
    fileName: s.file_name,
    revisionCount: s.revision_count,
    wordCount: s.word_count,
  };

  return {
    id: `scdoc-${s.id}`,
    provider: 'singlecase',
    timestamp: s.timestamp,
    endTimestamp: s.end_timestamp ?? undefined,
    durationMinutes: s.duration_minutes,
    summary: s.summary ?? `Editing ${s.file_name}`,
    meta,
  };
}

// Build EmailLookupIndex from database rows instead of mock fixtures
function buildEmailLookupFromDb(
  matters: Matter[],
  contacts: { id: string; external_id: string; display_name: string; emails: string[] }[],
  matterContacts: { matter_id: string; contact_external_id: string; role: string }[],
  emailLookupRows: { email_address: string; email_domain: string; matter_id: string; contact_external_id: string | null }[],
): EmailLookupIndex {
  const byAddress = new Map<string, EmailMatterMatch[]>();
  const byDomain = new Map<string, EmailMatterMatch[]>();

  // Build a map: matter internal id → external_id
  const matterIdToExternal = new Map<string, string>();
  for (const m of matters) {
    matterIdToExternal.set(m.id, m.external_id);
  }

  for (const row of emailLookupRows) {
    const matterExternal = matterIdToExternal.get(row.matter_id) ?? row.matter_id;
    const isAdversary = matterContacts.some(
      (mc) => mc.matter_id === row.matter_id && mc.contact_external_id === row.contact_external_id && mc.role === 'adversary',
    );
    const match: EmailMatterMatch = {
      email_address: row.email_address,
      email_domain: row.email_domain,
      matter_id: matterExternal,
      contact_external_id: row.contact_external_id ?? '',
      is_adversary: isAdversary,
    };

    const addrList = byAddress.get(row.email_address) ?? [];
    addrList.push(match);
    byAddress.set(row.email_address, addrList);

    const domainList = byDomain.get(row.email_domain) ?? [];
    domainList.push(match);
    byDomain.set(row.email_domain, domainList);
  }

  return { byAddress, byDomain };
}

// Convert a SingleCase activity item to the shared ActivityItem shape.
function toActivityItem(sc: SingleCaseActivity, cases: SingleCaseCase[]): ActivityItem {
  const caseRef = cases.find((c) => c.id === sc.case_id);
  const meta: ActivityMeta = {
    caseId: sc.case_id,
    caseName: sc.case_name,
    caseIdVisible: caseRef?.case_id_visible,
    scActivityKind: sc.kind,
  };

  switch (sc.kind) {
    case 'document':
      return {
        id: sc.id,
        provider: 'singlecase' as Provider,
        timestamp: sc.timestamp,
        endTimestamp: sc.end_timestamp,
        durationMinutes: sc.duration_minutes,
        summary: sc.summary,
        meta: {
          ...meta,
          fileName: sc.file_name,
          revisionCount: undefined,
        },
      };

    case 'note':
      return {
        id: sc.id,
        provider: 'singlecase' as Provider,
        timestamp: sc.timestamp,
        summary: sc.summary,
        meta: {
          ...meta,
          noteTitle: sc.note_title,
        },
      };

    case 'email_filed':
      return {
        id: sc.id,
        provider: 'singlecase' as Provider,
        timestamp: sc.timestamp,
        summary: sc.summary,
        meta: {
          ...meta,
          sender: sc.email_sender,
          recipient: sc.email_recipient,
          subject: sc.email_subject,
          threadId: sc.email_thread_id,
          direction: 'incoming',
        },
      };

    case 'task':
      return {
        id: sc.id,
        provider: 'singlecase' as Provider,
        timestamp: sc.timestamp,
        durationMinutes: sc.duration_minutes,
        summary: sc.summary,
        meta: {
          ...meta,
          ticketKey: sc.task_key,
          ticketTitle: sc.task_title,
          taskEventType: 'worklog',
        },
      };
  }
}

// Helper: check if a session from another provider overlaps an existing
// SingleCase time entry on the same case within 15 minutes.
export function checkPossibleDuplicate(
  sessionStart: string,
  sessionEnd: string,
  sessionCaseId: string | null,
  existingEntries: SingleCaseTimeEntry[],
): { isDuplicate: boolean; overlappingEntry?: SingleCaseTimeEntry } {
  if (!sessionCaseId) return { isDuplicate: false };

  const sessionStartMin = parseTimeToMinutes(sessionStart);
  const sessionEndMin = sessionEnd ? parseTimeToMinutes(sessionEnd) : sessionStartMin + 1;

  for (const entry of existingEntries) {
    if (entry.case_id !== sessionCaseId) continue;
    const entryStartMin = parseTimeToMinutes(entry.start_time);
    const entryEndMin = entryStartMin + entry.duration_minutes;
    if (
      sessionStartMin < entryEndMin + 15 &&
      sessionEndMin > entryStartMin - 15
    ) {
      return { isDuplicate: true, overlappingEntry: entry };
    }
  }
  return { isDuplicate: false };
}

function parseTimeToMinutes(isoLocal: string): number {
  const time = isoLocal.slice(0, 10).includes('-')
    ? isoLocal.slice(11, 16)
    : isoLocal.slice(0, 5);
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export type { SingleCaseActivity, SingleCaseTimeEntry, SingleCaseCase } from './types';
