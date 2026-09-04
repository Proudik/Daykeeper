import type {
  ActivityItem,
  DraftTimesheetEntry,
  RoundingMinutes,
  OutputLanguage,
  Matter,
  MatterRule,
} from '@/types';
import { estimate, type EstimateResult } from '@/lib/estimator';
import type { EstimatedEntry } from '@/lib/estimator/types';
import type { ResolvedSession } from '@/lib/attribution/scoring-resolver';
import { getClientName } from '@/lib/attribution/resolver-data';
import { supabase } from '@/lib/supabase';

// ============================================================================
// Generation pipeline — calls the generate-timesheet edge function ONCE per day
// with all sessions and their matter assignments. The model writes prose; the
// deterministic estimator decides time.
// ============================================================================

export interface GenerateResult {
  entries: DraftTimesheetEntry[];
  estimate: EstimateResult;
  errors: string[];
}

export interface GenerateOptions {
  timezone: string;
  workStart: string;
  workEnd: string;
  rounding: RoundingMinutes;
  targetHours: number;
  exclusionRules: { ruleType: string; value: string }[];
  language: OutputLanguage;
  redactClientNames: boolean;
  activityTypes: { id: string; label: string }[];
  matters: Matter[];
  clients: { id: string; name: string }[];
  rules: MatterRule[];
}

export async function generateDraftEntries(
  selectedItems: ActivityItem[],
  sessions: ResolvedSession[],
  options: GenerateOptions,
): Promise<GenerateResult> {
  if (selectedItems.length === 0 || sessions.length === 0) {
    return {
      entries: [],
      estimate: emptyEstimate(options.targetHours),
      errors: [],
    };
  }

  // Run the deterministic estimator for durations
  const estimateResult = estimate(selectedItems, {
    timezone: options.timezone,
    workStart: options.workStart,
    workEnd: options.workEnd,
    rounding: options.rounding,
    targetHours: options.targetHours,
    exclusionRules: options.exclusionRules,
  });

  // Build a map: session id → estimated entry (for durations)
  const entryBySessionId = new Map<string, EstimatedEntry>();
  for (const entry of estimateResult.entries) {
    entryBySessionId.set(entry.id, entry);
  }

  // Only include sessions that have a matter assigned
  const assignedSessions = sessions.filter((s) => s.matterId !== null);
  if (assignedSessions.length === 0) {
    return {
      entries: [],
      estimate: estimateResult,
      errors: [],
    };
  }

  // Build matter context for the edge function
  const matterContexts = assignedSessions
    .map((s) => s.matterId!)
    .filter((mid, i, arr) => arr.indexOf(mid) === i)
    .map((mid) => {
      const matter = options.matters.find((m) => m.id === mid);
      return {
        id: mid,
        case_id_visible: matter?.case_id_visible ?? null,
        case_name: matter?.name ?? '[Unknown]',
        client_name: matter ? getClientName(matter.client_external_id, options.clients) : null,
      };
    });

  // Merge sessions that share the same matter into a single block so the AI
  // writes one timesheet entry per matter (not one per activity item).
  const sessionsByMatter = new Map<string, ResolvedSession[]>();
  for (const session of assignedSessions) {
    const key = session.matterId!;
    const group = sessionsByMatter.get(key) ?? [];
    group.push(session);
    sessionsByMatter.set(key, group);
  }

  const sessionBlocks = Array.from(sessionsByMatter.entries()).map(([matterId, group]) => {
    const entries = group
      .map((s) => entryBySessionId.get(s.sessionId))
      .filter((e): e is EstimatedEntry => e !== undefined);

    const allItems = entries
      .flatMap((e) => e.sourceItemIds)
      .map((id) => selectedItems.find((i) => i.id === id))
      .filter((i): i is ActivityItem => i !== undefined);

    const mergedId = group[0].sessionId;
    const totalMinutes = entries.reduce((s, e) => s + e.roundedMinutes, 0);
    const starts = entries.map((e) => e.start).filter((v) => v !== undefined);
    const ends = entries.map((e) => e.end).filter((v) => v !== undefined);
    const minStart = starts.length > 0 ? Math.min(...starts) : 0;
    const maxEnd = ends.length > 0 ? Math.max(...ends) : 0;

    return {
      session_id: mergedId,
      matter_id: matterId,
      kind: entries[0]?.kind ?? mergedId,
      start: formatMinutes(minStart),
      end: formatMinutes(maxEnd),
      duration_minutes: totalMinutes,
      participants: extractParticipants(allItems),
      subjects: allItems.map((i) => i.meta.subject).filter(Boolean) as string[],
      document_titles: allItems.map((i) => i.meta.fileName).filter(Boolean) as string[],
      ticket_titles: allItems.map((i) => i.meta.ticketTitle).filter(Boolean) as string[],
      message_count: allItems.reduce((sum, i) => sum + (i.meta.messageCount ?? 0), 0) || null,
      attribution_reason: group[0].reason,
      _all_session_ids: group.map((s) => s.sessionId),
    };
  });

  const requestBody = {
    mode: "generate_day",
    matters: matterContexts,
    sessions: sessionBlocks,
    language: options.language === 'cs' ? 'ces' : 'eng',
    activity_types: options.activityTypes,
    redact_client_names: options.redactClientNames,
  };

  const response = await callEdgeFunction(requestBody);
  if (!response.ok) {
    // Fallback: create entries from estimator output with raw descriptions
    const fallbackEntries = createFallbackEntries(assignedSessions, entryBySessionId, selectedItems, options.matters, sessionsByMatter);
    return {
      entries: fallbackEntries,
      estimate: estimateResult,
      errors: [response.error ?? "Generation failed"],
    };
  }

  // Map the AI entries back to DraftTimesheetEntry with estimator durations.
  // Since sessions were merged by matter, the AI returns one entry per matter.
  // We need to expand source_session_ids back to all original session ids in
  // the merged group, then collect all estimated entries and source items.
  const mergedGroupByFirstId = new Map<string, string[]>();
  for (const [matterId, group] of sessionsByMatter) {
    const firstId = group[0].sessionId;
    mergedGroupByFirstId.set(firstId, group.map((s) => s.sessionId));
  }

  const aiEntries = response.entries ?? [];
  const allEntries: DraftTimesheetEntry[] = aiEntries.map((ai: AIEntry, idx: number) => {
    // Expand merged session ids back to all original session ids
    const allSessionIds = (ai.source_session_ids ?? []).flatMap((sid: string) =>
      mergedGroupByFirstId.get(sid) ?? [sid]);
    const sourceEntries = allSessionIds
      .map((sid: string) => entryBySessionId.get(sid))
      .filter((e): e is EstimatedEntry => e !== undefined);
    const totalMinutes = sourceEntries.reduce((s: number, e: EstimatedEntry) => s + e.roundedMinutes, 0);
    const sourceItemIds = sourceEntries.flatMap((e: EstimatedEntry) => e.sourceItemIds);
    const confidence = sourceEntries.every((e: EstimatedEntry) => e.confidence === 'high')
      ? 'high' : sourceEntries.some((e: EstimatedEntry) => e.confidence === 'low') ? 'low' : 'medium';

    const matterId = ai.matter_id ?? null;
    const session = assignedSessions.find((s) => allSessionIds.includes(s.sessionId));

    return {
      id: `draft-${idx}`,
      description: ai.description,
      suggestedMinutes: totalMinutes,
      confirmedMinutes: totalMinutes,
      activityType: options.activityTypes.find((a) => a.id === ai.activity_type_id)?.label ?? null,
      billable: ai.billable ?? true,
      confidence,
      sourceSummary: sourceEntries.map((e: EstimatedEntry) => `${e.provider} ${e.roundedMinutes}min`).join(", "),
      sourceItemIds,
      matterId,
      matterConfidence: (session?.confidence ?? 'high') as DraftTimesheetEntry['matterConfidence'],
      matterReason: session?.reason ?? null,
      attributionSource: 'estimator' as const,
      manualEntryId: null,
    } satisfies DraftTimesheetEntry;
  });

  // Find assigned matters the AI omitted — create fallback entries for them
  // so no assigned session is silently dropped from the timesheet.
  const coveredMatterIds = new Set(allEntries.map((e) => e.matterId));
  const missedMatters = Array.from(sessionsByMatter.entries()).filter(
    ([matterId]) => !coveredMatterIds.has(matterId),
  );
  for (const [matterId, group] of missedMatters) {
    const entries = group
      .map((s) => entryBySessionId.get(s.sessionId))
      .filter((e): e is EstimatedEntry => e !== undefined);
    const allSourceItemIds = entries.flatMap((e) => e.sourceItemIds);
    const items = allSourceItemIds
      .map((id) => selectedItems.find((i) => i.id === id))
      .filter((i): i is ActivityItem => i !== undefined);
    const totalMinutes = entries.reduce((s, e) => s + e.roundedMinutes, 0);
    const description = items.map((i) => i.summary).join("; ") || entries[0]?.label || "Manual entry required";
    const confidence = entries.every((e) => e.confidence === 'high') ? 'high' : entries.some((e) => e.confidence === 'low') ? 'low' : 'medium';

    allEntries.push({
      id: `fallback-${matterId}`,
      description,
      suggestedMinutes: totalMinutes,
      confirmedMinutes: totalMinutes,
      activityType: null,
      billable: true,
      confidence,
      sourceSummary: entries.map((e) => `${e.provider} ${e.roundedMinutes}min`).join(", "),
      sourceItemIds: allSourceItemIds,
      matterId,
      matterConfidence: group[0].confidence as DraftTimesheetEntry['matterConfidence'],
      matterReason: group[0].reason,
      attributionSource: 'estimator' as const,
      manualEntryId: null,
    });
  }

  return { entries: allEntries, estimate: estimateResult, errors: [] };
}

// --- Single-entry edit operations (haiku model) ---

export type EditOperation = 'expand' | 'shorten' | 'formal' | 'rephrase' | 'translate';

export async function editEntryDescription(
  description: string,
  operation: EditOperation,
  targetLanguage: OutputLanguage,
): Promise<string> {
  const requestBody = {
    mode: "edit",
    entry_description: description,
    edit_operation: operation,
    target_language: targetLanguage === 'cs' ? 'ces' : 'eng',
    activity_types: [],
  };

  const response = await callEdgeFunction(requestBody);
  if (!response.ok) {
    throw new Error(response.error ?? "Edit failed");
  }

  return response.description ?? description;
}

// --- Edge function call ---

interface AIEntry {
  description: string;
  activity_type_id: string;
  billable: boolean;
  source_session_ids: string[];
  matter_id?: string | null;
  notes: string | null;
}

interface EdgeFunctionResponse {
  ok: boolean;
  error?: string;
  entries?: AIEntry[];
  description?: string;
  raw?: string;
}

async function callEdgeFunction(body: unknown): Promise<EdgeFunctionResponse> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) {
    return { ok: false, error: "Not authenticated" };
  }

  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-timesheet`;
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMsg = `Request failed (${response.status})`;
    try {
      const parsed = JSON.parse(errorBody);
      errorMsg = parsed.error ?? errorMsg;
    } catch {
      // not JSON
    }
    return { ok: false, error: errorMsg };
  }

  const data = await response.json();
  if (data.error) {
    return { ok: false, error: data.error, raw: data.raw };
  }

  return {
    ok: true,
    entries: data.entries,
    description: data.description,
  };
}

// --- Fallback entries (when AI generation fails) ---

function createFallbackEntries(
  sessions: ResolvedSession[],
  entryBySessionId: Map<string, EstimatedEntry>,
  sourceItems: ActivityItem[],
  matters: Matter[],
  sessionsByMatter: Map<string, ResolvedSession[]>,
): DraftTimesheetEntry[] {
  // Merge by matter, same as the AI path
  return Array.from(sessionsByMatter.entries()).map(([matterId, group]) => {
    const entries = group
      .map((s) => entryBySessionId.get(s.sessionId))
      .filter((e): e is EstimatedEntry => e !== undefined);
    const allSourceItemIds = entries.flatMap((e) => e.sourceItemIds);
    const items = allSourceItemIds
      .map((id) => sourceItems.find((i) => i.id === id))
      .filter((i): i is ActivityItem => i !== undefined);
    const totalMinutes = entries.reduce((s, e) => s + e.roundedMinutes, 0);
    const description = items.map((i) => i.summary).join("; ") || entries[0]?.label || "Manual entry required";
    const confidence = entries.every((e) => e.confidence === 'high') ? 'high' : entries.some((e) => e.confidence === 'low') ? 'low' : 'medium';

    return {
      id: `fallback-${matterId}`,
      description,
      suggestedMinutes: totalMinutes,
      confirmedMinutes: totalMinutes,
      activityType: null,
      billable: true,
      confidence,
      sourceSummary: entries.map((e) => `${e.provider} ${e.roundedMinutes}min`).join(", "),
      sourceItemIds: allSourceItemIds,
      matterId,
      matterConfidence: group[0].confidence as DraftTimesheetEntry['matterConfidence'],
      matterReason: group[0].reason,
      attributionSource: 'estimator' as const,
      manualEntryId: null,
    };
  });
}

// --- Helpers ---

function extractParticipants(items: ActivityItem[]): string[] {
  const names: string[] = [];
  for (const item of items) {
    if (item.meta.sender) {
      const name = item.meta.sender.split("@")[0].split(".").map(
        (part) => part.charAt(0).toUpperCase() + part.slice(1)
      ).join(" ");
      names.push(name);
    }
    if (item.meta.recipient) {
      const name = item.meta.recipient.split("@")[0].split(".").map(
        (part) => part.charAt(0).toUpperCase() + part.slice(1)
      ).join(" ");
      names.push(name);
    }
  }
  return [...new Set(names)].slice(0, 8);
}

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function emptyEstimate(targetHours: number): EstimateResult {
  return {
    entries: [],
    reconciliation: {
      totalEstimatedMinutes: 0,
      totalRoundedMinutes: 0,
      daySpanMinutes: 0,
      unaccountedGapMinutes: 0,
      targetMinutes: targetHours * 60,
      targetMet: false,
    },
  };
}

// Kept for backwards compatibility but now async
export function regenerateWithInstruction(
  _entries: DraftTimesheetEntry[],
  _items: ActivityItem[],
  _instruction: string,
  _rounding: RoundingMinutes,
  _language: OutputLanguage,
  _options: {
    timezone: string;
    workStart: string;
    workEnd: string;
    targetHours: number;
    exclusionRules: { ruleType: string; value: string }[];
  },
): GenerateResult {
  return {
    entries: _entries,
    estimate: emptyEstimate(_options.targetHours),
    errors: [],
  };
}
