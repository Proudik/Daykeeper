import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { createSingleCaseProvider, checkPossibleDuplicate, type SingleCaseProviderData } from '@/providers/singlecase';
import { createMs365Provider, getMs365LastError, clearMs365LastError, type Ms365ProviderData } from '@/providers/microsoft365';
import { createGoogleProvider, getGoogleLastError, clearGoogleLastError, type GoogleProviderData } from '@/providers/google';
import { createCustomProvider, getCustomError, clearCustomError, type CustomProviderData } from '@/providers/custom';
import { createBrowserProvider } from '@/providers/browser';
import { createWebhookProvider } from '@/providers/webhook';
import { subscribeToDaySignals, subscribeToWebhookSignals, subscribeToScDocumentSignals, insertScDocumentSignal } from '@/lib/signals';
import type { SingleCaseTimeEntry } from '@/providers/singlecase/types';
import type {
  ActivityItem,
  ActivityProvider,
  DraftTimesheetEntry,
  Provider,
  Matter,
  ActivityType,
  ManualEntry,
  MatterRule,
} from '@/types';
import { formatMinutes, formatHours, todayLocal, minutesBetween } from '@/lib/time';
import { generateDraftEntries, type GenerateResult } from '@/lib/generate';
import type { EstimateResult } from '@/lib/estimator';
import { estimate } from '@/lib/estimator';
import {
  attributeEntries,
  groupByMatter,
  type AttributedEntry,
  type MatterGroup,
} from '@/lib/attribution';
import { resolveDay } from '@/lib/attribution/resolver-data';
import type { ResolvedSession } from '@/lib/attribution/scoring-resolver';
import { MatterPicker } from '@/components/MatterPicker';
import { AssignmentTray } from '@/components/AssignmentTray';
import { ReviewCardList } from '@/components/ReviewCardList';
import { ActivityList } from '@/components/ActivityList';
import { VerticalTimeline } from '@/components/VerticalTimeline';
import { TimesheetPanel } from '@/components/TimesheetPanel';
import { ManualEntryForm } from '@/components/ManualEntryForm';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Plus,
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  Inbox,
  Lock,
  Loader2,
  RefreshCw,
  ListChecks,
  FileText,
  Sparkles,
  FileEdit,
} from 'lucide-react';

interface DayViewProps {
  selectedDate: string;
  onDateChange: (d: string) => void;
}

type GroupMode = 'matter' | 'app' | 'review';

// Vibrant, distinct color palette for matters (up to 12 per day)
const MATTER_PALETTE = [
  '#2563eb', '#dc2626', '#059669', '#ea580c',
  '#7c3aed', '#0891b2', '#db2777', '#ca8a04',
  '#4f46e5', '#16a34a', '#e11d48', '#0d9488',
];

const UNASSIGNED_COLOR = '#f59e0b';

function applyManualOverrides(
  sessions: ResolvedSession[],
  entries: { id: string; sourceItemIds: string[] }[],
  overrides: Map<string, string | null>,
  matters: Matter[],
): ResolvedSession[] {
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const matterById = new Map(matters.map((m) => [m.id, m]));
  return sessions.map((s) => {
    const entry = entryById.get(s.sessionId);
    if (!entry) return s;
    let override: string | null | undefined = undefined;
    for (const itemId of entry.sourceItemIds) {
      if (overrides.has(itemId)) {
        override = overrides.get(itemId);
        break;
      }
    }
    if (override === undefined) return s;
    const matter = override ? matterById.get(override) ?? null : null;
    return {
      ...s,
      matterId: override,
      matter,
      confidence: override ? 'confirmed' as const : 'unassigned' as const,
      reason: override ? 'Manual assignment' : 'Manually unassigned',
      candidates: [],
    };
  });
}

export function DayView({ selectedDate, onDateChange }: DayViewProps) {
  const { profile } = useAuth();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [scProviderData, setScProviderData] = useState<SingleCaseProviderData | null>(null);
  const [ms365ProviderData, setMs365ProviderData] = useState<Ms365ProviderData | null>(null);
  const [googleProviderData, setGoogleProviderData] = useState<GoogleProviderData | null>(null);
  const [customProviders, setCustomProviders] = useState<CustomProviderData[]>([]);
  const [browserProvider, setBrowserProvider] = useState<ReturnType<typeof createBrowserProvider> | null>(null);
  const [webhookProvider, setWebhookProvider] = useState<ReturnType<typeof createWebhookProvider> | null>(null);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([]);
  const [existingTimeEntries, setExistingTimeEntries] = useState<SingleCaseTimeEntry[]>([]);
  const [overriddenDuplicates, setOverriddenDuplicates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<Provider>>(new Set());
  const [collapsedMatterSections, setCollapsedMatterSections] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [draftEntries, setDraftEntries] = useState<DraftTimesheetEntry[] | null>(null);
  const [estimateResult, setEstimateResult] = useState<EstimateResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generationErrors, setGenerationErrors] = useState<string[]>([]);
  const [groupMode, setGroupMode] = useState<GroupMode>('matter');
  const [showManualForm, setShowManualForm] = useState(false);
  const [matterRules, setMatterRules] = useState<MatterRule[]>([]);
  const [recentMatterIds, setRecentMatterIds] = useState<string[]>([]);
  const [manualOverrides, setManualOverrides] = useState<Map<string, string | null>>(new Map());
  const [providerError, setProviderError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [usedItemIds, setUsedItemIds] = useState<Set<string>>(new Set());
  const [autoGenEnabled, setAutoGenEnabled] = useState(true);
  const autoGenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastDropMatterId, setLastDropMatterId] = useState<string | null>(null);
  const [pendingDropItemId, setPendingDropItemId] = useState<string | null>(null);
  const [generationRevision, setGenerationRevision] = useState(0);
  const [mobileTab, setMobileTab] = useState<'signals' | 'timesheet'>('signals');
  const [isMobile, setIsMobile] = useState(false);

  // Force review mode on mobile for a cleaner phone experience
  useEffect(() => {
    const check = () => {
      const mobile = Boolean(document.querySelector('.simulate-mobile'));
      setIsMobile(mobile);
      if (mobile) setGroupMode('review');
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
    return () => observer.disconnect();
  }, []);

  const workStart = profile?.working_hours_start ?? '08:30';
  const workEnd = profile?.working_hours_end ?? '18:00';
  const rounding = profile?.rounding_minutes ?? 15;
  const targetHours = profile?.target_hours ?? 8;
  const language = profile?.output_language ?? 'en';

  // Fetch org data (matters, activity types, clients, SingleCase provider) once
  useEffect(() => {
    async function loadOrgData() {
      const { data: memberData } = await supabase
        .from('organization_members')
        .select('org_id')
        .eq('user_id', profile?.user_id ?? '')
        .maybeSingle();

      if (!memberData) return;

      const [mattersRes, typesRes, clientsRes, scData] = await Promise.all([
        supabase.from('matters').select('*').eq('org_id', memberData.org_id).eq('state_is_open', true),
        supabase.from('activity_types').select('*').eq('org_id', memberData.org_id).order('sort_order'),
        supabase.from('clients').select('external_id, name').eq('org_id', memberData.org_id),
        createSingleCaseProvider(),
      ]);

      setMatters((mattersRes.data as Matter[]) ?? []);
      setActivityTypes((typesRes.data as ActivityType[]) ?? []);
      setClients((clientsRes.data as { external_id: string; name: string }[] | null)?.map((c) => ({ id: c.external_id, name: c.name })) ?? []);
      setScProviderData(scData);

      // Create MS365 provider if the user has a connected email connection
      const { data: emailConn } = await supabase
        .from('connections')
        .select('connection_metadata')
        .eq('user_id', profile?.user_id ?? '')
        .eq('provider', 'email')
        .eq('status', 'connected')
        .maybeSingle();
      const upn = (emailConn?.connection_metadata as { upn?: string } | null)?.upn ?? null;
      if (upn) {
        const ms365Data = await createMs365Provider(upn);
        setMs365ProviderData(ms365Data);
      }

      // Create Google provider if org has Google connected and user has picked their email
      if (memberData.org_id) {
        const { data: googleToken } = await supabase
          .from('provider_tokens')
          .select('provider')
          .eq('org_id', memberData.org_id)
          .eq('provider', 'google')
          .maybeSingle();
        if (googleToken) {
          // Load the user's selected Google email from their connection row
          const { data: googleConn } = await supabase
            .from('connections')
            .select('connection_metadata')
            .eq('user_id', profile?.user_id ?? '')
            .eq('provider', 'calendar')
            .eq('status', 'connected')
            .maybeSingle();
          const googleEmail = (googleConn?.connection_metadata as { google_email?: string } | null)?.google_email ?? null;
          if (googleEmail) {
            const googleData = await createGoogleProvider(googleEmail);
            setGoogleProviderData(googleData);
          }
        }
      }
      // Load custom connectors for this org and create providers
      if (memberData.org_id) {
        const { data: customConns } = await supabase
          .from('custom_connectors')
          .select('id, name')
          .eq('org_id', memberData.org_id)
          .eq('status', 'active');
        if (customConns && customConns.length > 0) {
          setCustomProviders(customConns.map((c: { id: string; name: string }) => createCustomProvider(c.id, c.name)));
        }
      }
    }
    if (profile?.user_id) loadOrgData();
  }, [profile?.user_id]);

  // Create the webhook provider once the profile is available
  useEffect(() => {
    if (!profile?.timezone) return;
    setWebhookProvider(createWebhookProvider(profile.timezone));
  }, [profile?.timezone]);

  // Prefetch a full month of activity summaries in the background so the
  // month calendar shows dots for every day without needing to visit each one.
  useEffect(() => {
    async function prefetchMonth() {
      if (!profile?.user_id || !scProviderData) return;
      const d = new Date(selectedDate + 'T00:00:00');
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const start = `${monthStart.toISOString().slice(0, 10)}T00:00:00`;
      const end = `${monthEnd.toISOString().slice(0, 10)}T23:59:59`;

      const scProvider = scProviderData?.provider;
      const ms365Provider = ms365ProviderData?.provider;
      const googleProvider = googleProviderData?.provider;
      const browserProv = browserProvider?.provider;
      const webhookProv = webhookProvider?.provider;
      const providers = [scProvider, ms365Provider, googleProvider, ...customProviders, browserProv, webhookProv].filter((p): p is ActivityProvider => p !== null && p !== undefined);
      if (providers.length === 0) return;

      const results = await Promise.all(
        providers.map((p) => p.fetchActivity({ start, end }).catch(() => [] as ActivityItem[])),
      );
      const all = results.flat();
      if (all.length === 0) return;

      // Group by date
      const byDate = new Map<string, { providers: Set<Provider>; count: number }>();
      for (const item of all) {
        const dateKey = item.timestamp.slice(0, 10);
        const existing = byDate.get(dateKey) ?? { providers: new Set<Provider>(), count: 0 };
        existing.count++;
        if (item.provider !== 'singlecase') existing.providers.add(item.provider);
        byDate.set(dateKey, existing);
      }

      const rows = Array.from(byDate.entries()).map(([date, info]) => ({
        user_id: profile.user_id!,
        work_date: date,
        providers: Array.from(info.providers),
        item_count: info.count,
        updated_at: new Date().toISOString(),
      }));

      if (rows.length > 0) {
        await supabase.from('day_activity_summary').upsert(rows, { onConflict: 'user_id,work_date' });
      }
    }
    prefetchMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scProviderData, ms365ProviderData, googleProviderData, customProviders, browserProvider, webhookProvider, profile?.user_id]);

  // Fetch activity from all connected providers.
  // When `silent` is true (realtime signal update), preserve the user's
  // selections, draft entries, and overrides — just refresh the item list
  // and merge any new items into the selection.
  const fetchActivity = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setSelectedIds(new Set());
      setDraftEntries(null);
      setFocusedIndex(null);
      setOverriddenDuplicates(new Set());
    }

    try {
      const start = `${selectedDate}T00:00:00`;
      const end = `${selectedDate}T23:59:59`;

      // Build the list of connected providers from the connections table
      const { data: conns } = await supabase
        .from('connections')
        .select('provider')
        .eq('user_id', profile?.user_id ?? '')
        .eq('status', 'connected');

      const connectedProviders = (conns as { provider: string }[] | null)?.map((c) => c.provider) ?? [];

      // Only fetch from SingleCase if it's org-connected
      const scProvider = scProviderData?.provider;
      const ms365Provider = ms365ProviderData?.provider;
      const googleProvider = googleProviderData?.provider;
      const browserProv = browserProvider?.provider;
      const webhookProv = webhookProvider?.provider;
      const providers = [scProvider, ms365Provider, googleProvider, ...customProviders, browserProv, webhookProv].filter((p): p is ActivityProvider => p !== null && p !== undefined);

      const results = await Promise.all(
        providers.map((p) => p.fetchActivity({ start, end }).catch(() => [] as ActivityItem[])),
      );
      const all = results.flat().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      setItems(all);

      if (silent) {
        // Merge new items into existing selection without wiping current state
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const item of all) {
            if (!prev.has(item.id)) next.add(item.id);
          }
          return next;
        });
      } else {
        setSelectedIds(new Set(all.map((i) => i.id)));
      }

      // Persist a lightweight activity summary so the month calendar can show dots
      // for days that have activity but no saved timesheet yet.
      if (profile?.user_id && all.length > 0) {
        const uniqueProviders = Array.from(new Set(all.map((i) => i.provider).filter((p) => p !== 'singlecase')));
        await supabase.from('day_activity_summary').upsert(
          {
            user_id: profile.user_id,
            work_date: selectedDate,
            providers: uniqueProviders,
            item_count: all.length,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,work_date' },
        );
      }

      // Surface any provider errors so the user knows why activity is empty
      const ms365Err = getMs365LastError();
      const googleErr = getGoogleLastError();
      const customErr = getCustomError();
      const err = ms365Err ?? googleErr ?? customErr;
      setProviderError(err);
      if (!err) { clearMs365LastError(); clearGoogleLastError(); clearCustomError(); }

      // Load existing SingleCase time entries for this date
      setExistingTimeEntries(scProviderData?.existingTimeEntries ?? []);
    } catch (err) {
      console.error('fetchActivity error:', err);
      setProviderError(err instanceof Error ? err.message : 'Failed to load activity');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, scProviderData, ms365ProviderData, googleProviderData, customProviders, browserProvider, webhookProvider, profile?.user_id]);

  // Create the browser provider once the profile is available
  useEffect(() => {
    if (!profile?.timezone) return;
    setBrowserProvider(createBrowserProvider(profile.timezone));
  }, [profile?.timezone]);

  // Subscribe to realtime browser signal upserts for the selected day.
  // When a new signal arrives, refetch all browser signals for the day
  // so domain grouping and duration totals are recomputed correctly.
  useEffect(() => {
    if (!browserProvider) return;
    const unsub = subscribeToDaySignals(selectedDate, () => {
      fetchActivity(true);
    });
    return unsub;
  }, [selectedDate, browserProvider, profile?.timezone, fetchActivity]);

  // Subscribe to realtime webhook signal upserts for the selected day.
  useEffect(() => {
    if (!webhookProvider) return;
    const unsub = subscribeToWebhookSignals(selectedDate, () => {
      fetchActivity(true);
    });
    return unsub;
  }, [selectedDate, webhookProvider, fetchActivity]);

  // Subscribe to realtime SC document-editing signal upserts for the selected day.
  useEffect(() => {
    if (!scProviderData) return;
    const unsub = subscribeToScDocumentSignals(selectedDate, () => {
      fetchActivity(true);
    });
    return unsub;
  }, [selectedDate, scProviderData, fetchActivity]);

  // Load which activity items have already been used in a saved timesheet for this date
  useEffect(() => {
    async function loadUsedItems() {
      if (!profile?.user_id) return;
      const { data: ts } = await supabase
        .from('timesheets')
        .select('id')
        .eq('user_id', profile.user_id)
        .eq('work_date', selectedDate);
      const tsIds = (ts ?? []).map((t) => t.id);
      if (tsIds.length === 0) { setUsedItemIds(new Set()); return; }
      const { data: entries } = await supabase
        .from('timesheet_entries')
        .select('source_item_ids')
        .in('timesheet_id', tsIds);
      const ids = new Set<string>();
      for (const row of entries ?? []) {
        const arr = (row as { source_item_ids: string[] }).source_item_ids ?? [];
        for (const id of arr) ids.add(id);
      }
      setUsedItemIds(ids);
    }
    loadUsedItems();
  }, [selectedDate, profile?.user_id, saveSuccess]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  // Fetch manual entries for this date
  useEffect(() => {
    async function loadManual() {
      if (!profile?.user_id) return;
      const { data } = await supabase
        .from('manual_entries')
        .select('*')
        .eq('user_id', profile.user_id)
        .eq('work_date', selectedDate);
      setManualEntries((data as ManualEntry[]) ?? []);
    }
    loadManual();
  }, [selectedDate, profile?.user_id, showManualForm]);

  // Keyboard shortcut: Cmd/Ctrl+Enter to generate
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleGenerate();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, draftEntries]);

  const flatIds = useMemo(() => items.map((i) => i.id), [items]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleProviderAll(provider: Provider, select: boolean) {
    const providerIds = items.filter((i) => i.provider === provider).map((i) => i.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (select) providerIds.forEach((id) => next.add(id));
      else providerIds.forEach((id) => next.delete(id));
      return next;
    });
  }

  function toggleSection(provider: Provider) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  }

  function toggleMatterSection(key: string) {
    setCollapsedMatterSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedItems = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds],
  );

  // For the summary bar, only count non-brief items (>=10 min) that are selected.
  // Brief items live in a separate "Quick activities" section and shouldn't inflate the main count.
  const visibleSelectedItems = useMemo(() => {
    const tz = profile?.timezone;
    return selectedItems.filter((i) => {
      const dur = i.endTimestamp ? minutesBetween(i.timestamp, i.endTimestamp, tz) : i.durationMinutes ?? 0;
      return !(dur > 0 && dur < 10);
    });
  }, [selectedItems, profile?.timezone]);

  const generatedItemIds = useMemo(
    () => new Set((draftEntries ?? []).flatMap((entry) => entry.sourceItemIds)),
    [draftEntries],
  );

  // Live estimate as user toggles items (deterministic, no AI call)
  const liveEstimate = useMemo(() => {
    if (visibleSelectedItems.length === 0) return null;
    const estResult = estimate(visibleSelectedItems, {
      timezone: profile?.timezone ?? 'Europe/Prague',
      workStart,
      workEnd,
      rounding,
      targetHours,
      exclusionRules: [],
    });
    return estResult;
  }, [visibleSelectedItems, profile, workStart, workEnd, rounding, targetHours]);

  // Run estimator + scoring resolver for the assignment tray
  const resolvedSessions = useMemo<ResolvedSession[]>(() => {
    if (visibleSelectedItems.length === 0) return [];
    const estResult = estimate(visibleSelectedItems, {
      timezone: profile?.timezone ?? 'Europe/Prague',
      workStart,
      workEnd,
      rounding,
      targetHours,
      exclusionRules: [],
    });
    if (!scProviderData) return [];
    const raw = resolveDay(
      estResult.entries, visibleSelectedItems,
      matters, scProviderData.contacts, scProviderData.matterContacts,
      scProviderData.emailLookup, 'current-user', matterRules,
    );
    if (manualOverrides.size === 0) return raw;
    return applyManualOverrides(raw, estResult.entries, manualOverrides, matters);
  }, [visibleSelectedItems, profile, workStart, workEnd, rounding, targetHours, matterRules, matters, scProviderData, manualOverrides]);

  // Also keep the old attribution for timeline coloring
  const matterGroups = useMemo<MatterGroup[]>(() => {
    if (visibleSelectedItems.length === 0) return [];
    const estResult = estimate(visibleSelectedItems, {
      timezone: profile?.timezone ?? 'Europe/Prague',
      workStart,
      workEnd,
      rounding,
      targetHours,
      exclusionRules: [],
    });
    const attributed = attributeEntries(estResult.entries, visibleSelectedItems, {
      emailLookup: scProviderData?.emailLookup ?? { byAddress: new Map(), byDomain: new Map() },
      matterRules,
      matters,
    });
    return groupByMatter(attributed, matters);
  }, [visibleSelectedItems, matters, profile, workStart, workEnd, rounding, targetHours, matterRules, scProviderData]);

  const unassignedGroup = matterGroups.find((g) => g.isUnassigned && !g.isInternal);
  const internalGroups = matterGroups.filter((g) => g.isInternal);
  const billableGroups = matterGroups.filter((g) => !g.isUnassigned && !g.isInternal);

  // Count unassigned items from the resolver (for generation gating)
  const unassignedCount = useMemo(() => {
    return resolvedSessions.filter((s) => s.matterId === null).length;
  }, [resolvedSessions]);

  // Already recorded time entries from SingleCase
  const recordedMinutes = existingTimeEntries.reduce((s, e) => s + e.duration_minutes, 0);

  // Detect possible duplicates: sessions that overlap existing SingleCase entries
  const duplicateItemIds = useMemo(() => {
    const dupes = new Set<string>();
    for (const item of items) {
      if (item.provider === 'singlecase') continue; // SC items are the source of truth
      const caseId = item.meta.caseId ?? null;
      const { isDuplicate } = checkPossibleDuplicate(
        item.timestamp,
        item.endTimestamp ?? item.timestamp,
        caseId,
        existingTimeEntries,
      );
      if (isDuplicate) dupes.add(item.id);
    }
    return dupes;
  }, [items, existingTimeEntries]);

  // Items available for generation (excluding duplicates the user hasn't overridden)
  const generationItems = useMemo(() => {
    return visibleSelectedItems.filter((item) => {
      if (!duplicateItemIds.has(item.id)) return true;
      return overriddenDuplicates.has(item.id);
    });
  }, [visibleSelectedItems, duplicateItemIds, overriddenDuplicates]);

  function toggleDuplicateOverride(itemId: string) {
    setOverriddenDuplicates((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  const pendingRegen = useRef(false);

  async function handleGenerate() {
    if (generating) {
      pendingRegen.current = true;
      return;
    }
    if (generationItems.length === 0) return;
    setGenerating(true);
    try {
      // Run estimator to get sessions for the resolver
      const estResult = estimate(generationItems, {
        timezone: profile?.timezone ?? 'Europe/Prague',
        workStart,
        workEnd,
        rounding,
        targetHours,
        exclusionRules: [],
      });
      const scData = scProviderData!;
      const rawSessions = resolveDay(
        estResult.entries, generationItems,
        matters, scData.contacts, scData.matterContacts,
        scData.emailLookup, 'current-user', matterRules,
      );
      const sessions = manualOverrides.size > 0
        ? applyManualOverrides(rawSessions, estResult.entries, manualOverrides, matters)
        : rawSessions;

      const sessionsForGeneration = sessions.filter((s) => s.matterId !== null);

      const result = await generateDraftEntries(generationItems, sessionsForGeneration, {
        timezone: profile?.timezone ?? 'Europe/Prague',
        workStart,
        workEnd,
        rounding,
        targetHours,
        exclusionRules: [],
        language,
        redactClientNames: false,
        activityTypes: activityTypes.map((a) => ({ id: a.id, label: a.label })),
        matters,
        clients,
        rules: matterRules,
      });
      setDraftEntries(result.entries);
      setEstimateResult(result.estimate);
      setGenerationErrors(result.errors);
    } catch (err) {
      console.error('Generation failed:', err);
      setGenerationErrors([err instanceof Error ? err.message : 'Generation failed']);
    } finally {
      setGenerating(false);
      if (pendingRegen.current) {
        pendingRegen.current = false;
        setTimeout(() => handleGenerate(), 0);
      }
    }
  }

  async function handleSave(entries: DraftTimesheetEntry[]) {
    if (!profile || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const { data: ts, error: tsError } = await supabase
        .from('timesheets')
        .upsert(
          {
            user_id: profile.user_id,
            work_date: selectedDate,
            status: 'draft',
            model_used: 'heuristic-v1',
            source_providers: Array.from(new Set(visibleSelectedItems.map((i) => i.provider))),
            total_minutes: entries.filter((e) => e.billable).reduce((s, e) => s + e.confirmedMinutes, 0),
          },
          { onConflict: 'user_id,work_date' },
        )
        .select('id')
        .single();

      if (tsError || !ts) {
        setSaveError(tsError?.message ?? 'Failed to save timesheet');
        return;
      }

      const { error: delError } = await supabase.from('timesheet_entries').delete().eq('timesheet_id', ts.id);
      if (delError) {
        setSaveError(delError.message);
        return;
      }

      const { error: insError } = await supabase.from('timesheet_entries').insert(
        entries.map((e, i) => ({
          timesheet_id: ts.id,
          user_id: profile.user_id,
          sort_order: i,
          description: e.description,
          suggested_minutes: e.suggestedMinutes,
          confirmed_minutes: e.confirmedMinutes,
          activity_type: e.activityType,
          billable: e.billable,
          confidence: e.confidence,
          source_summary: e.sourceSummary,
          source_item_ids: e.sourceItemIds,
          matter_id: e.matterId,
          matter_confidence: e.matterConfidence,
          matter_reason: e.matterReason,
          attribution_source: e.attributionSource,
          manual_entry_id: e.manualEntryId,
        })),
      );
      if (insError) {
        setSaveError(insError.message);
        return;
      }

      await supabase.from('audit_log').insert({
        action: 'save_timesheet',
        detail: `${entries.length} entries saved for ${selectedDate}`,
      });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save timesheet');
    } finally {
      setSaving(false);
    }
  }

  function handleManualSaved(entry: ManualEntry) {
    setManualEntries((prev) => [...prev, entry]);
    setShowManualForm(false);
  }

  async function handleSimulateDocEdit() {
    const now = new Date();
    const tz = profile?.timezone ?? 'Europe/Prague';
    const localNow = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const hour = localNow.getHours();
    const minute = localNow.getMinutes();

    const startMin = Math.max(0, hour * 60 + minute - 45);
    const durationMin = 15 + Math.floor(Math.random() * 30);
    const endMin = startMin + durationMin;

    const startHour = Math.floor(startMin / 60);
    const startMinute = startMin % 60;
    const endHour = Math.floor(endMin / 60);
    const endMinute = endMin % 60;

    const dayStr = selectedDate;
    const startTime = `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;

    const startIso = new Date(`${dayStr}T${startTime}:00`).toISOString();
    const endIso = new Date(`${dayStr}T${endTime}:00`).toISOString();

    const docNames = [
      'Purchase_Agreement_v3.docx',
      'NDA_TechCorp_final.docx',
      'Litigation_Memo_case142.docx',
      'Contract_Review_draft.docx',
      'Motion_to_Dismiss.docx',
      'Settlement_Draft.docx',
    ];
    const fileName = docNames[Math.floor(Math.random() * docNames.length)];
    const wordCount = 200 + Math.floor(Math.random() * 1800);
    const revisionCount = 1 + Math.floor(Math.random() * 4);

    const matter = matters.length > 0 ? matters[Math.floor(Math.random() * matters.length)] : null;

    await insertScDocumentSignal({
      day: dayStr,
      timestamp: startIso,
      end_timestamp: endIso,
      duration_minutes: durationMin,
      file_name: fileName,
      case_id: matter?.external_id ?? null,
      case_name: matter?.name ?? null,
      case_id_visible: matter?.case_id_visible ?? null,
      word_count: wordCount,
      revision_count: revisionCount,
      summary: `Editing ${fileName}${matter ? ` · ${matter.case_id_visible ?? matter.name}` : ''}`,
    });
  }

  function handlePreviewDrop(itemId: string, matterId: string) {
    setSelectedIds((prev) => new Set(prev).add(itemId));
    setGenerationRevision((revision) => revision + 1);
    setLastDropMatterId(matterId);
    setRecentMatterIds((prev) => [matterId, ...prev.filter((id) => id !== matterId)].slice(0, 10));
    setManualOverrides((prev) => {
      const next = new Map(prev);
      next.set(itemId, matterId);
      return next;
    });
  }

  function closePendingDropPicker() {
    setPendingDropItemId(null);
  }

  function assignPendingDrop(matterId: string) {
    if (!pendingDropItemId) return;
    const itemId = pendingDropItemId;
    setSelectedIds((prev) => new Set(prev).add(itemId));
    setGenerationRevision((revision) => revision + 1);
    setLastDropMatterId(matterId);
    setRecentMatterIds((prev) => [matterId, ...prev.filter((id) => id !== matterId)].slice(0, 10));
    setManualOverrides((prev) => {
      const next = new Map(prev);
      next.set(itemId, matterId);
      return next;
    });
    setPendingDropItemId(null);
  }

  // Track which assigned session ids have matters, for auto-generation
  const assignedSessionSignature = useMemo(() => {
    return resolvedSessions
      .filter((s) => s.matterId !== null)
      .map((s) => `${s.sessionId}:${s.matterId}`)
      .sort()
      .join('|');
  }, [resolvedSessions]);

  const hasAssignedSessions = assignedSessionSignature.length > 0;
  const pendingDropSession = pendingDropItemId
    ? resolvedSessions.find((session) => session.sourceItemIds.includes(pendingDropItemId)) ?? null
    : null;

  // Auto-generate: when the set of assigned sessions changes and auto-gen is on,
  // debounce-regenerate the timesheet preview.
  useEffect(() => {
    if (!autoGenEnabled) return;
    if (!hasAssignedSessions) {
      setDraftEntries(null);
      setEstimateResult(null);
      setGenerationErrors([]);
      return;
    }
    if (autoGenTimer.current) clearTimeout(autoGenTimer.current);
    autoGenTimer.current = setTimeout(() => {
      handleGenerate();
    }, 800);
    return () => {
      if (autoGenTimer.current) clearTimeout(autoGenTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedSessionSignature, autoGenEnabled, generationRevision]);

  return (
    <div className="flex h-full flex-col view-transition">
      {/* Running totals bar */}
      <div className="shrink-0 border-b border-stone-200 bg-white px-4 py-2.5">
        {/* Mobile: centered compact summary */}
        <div className="flex items-center justify-center gap-3 text-sm sm:hidden">
          <span className="text-stone-500">
            Selected: <span className="font-semibold text-stone-800">{visibleSelectedItems.length}</span>
          </span>
          <span className="text-stone-300">·</span>
          <span className="text-stone-500">
            Estimated: <span className="font-semibold text-stone-800">{formatMinutes(liveEstimate?.reconciliation.totalRoundedMinutes ?? 0)}</span>
          </span>
        </div>
        {/* Desktop: full summary with controls */}
        <div className="hidden flex-wrap items-center justify-between gap-y-2 sm:flex">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-stone-500">
              Selected: <span className="font-medium text-stone-800">{visibleSelectedItems.length}</span> items
            </span>
            <span className="text-stone-300">|</span>
            <span className="text-stone-500">
              Estimated: <span className="font-medium text-stone-800">{formatMinutes(liveEstimate?.reconciliation.totalRoundedMinutes ?? 0)}</span>
            </span>
            {existingTimeEntries.length > 0 && (
              <>
                <span className="text-stone-300">|</span>
                <span className="text-stone-500">
                  Recorded: <span className="font-medium text-stone-700">{formatMinutes(recordedMinutes)}</span>
                </span>
                <span className="text-stone-300">|</span>
                <span className="text-stone-500">
                  Remaining: <span className="font-medium text-stone-800">{formatMinutes(Math.max(0, (targetHours * 60) - recordedMinutes))}</span>
                </span>
              </>
            )}
            {liveEstimate && liveEstimate.reconciliation.daySpanMinutes > 0 && (
              <>
                <span className="text-stone-300">|</span>
                <span className="text-stone-500">
                  Day span: <span className="font-medium text-stone-800">{formatMinutes(liveEstimate.reconciliation.daySpanMinutes)}</span>
                </span>
                <span className="text-stone-300">|</span>
                <span className="text-stone-500">
                  Gap: <span className="font-medium text-stone-800">{formatMinutes(liveEstimate.reconciliation.unaccountedGapMinutes)}</span>
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSimulateDocEdit}
              title="Simulate SingleCase document editing"
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-cyan-700 transition-colors hover:bg-cyan-50"
            >
              <FileEdit size={14} />
              <span className="hidden lg:inline">Simulate doc edit</span>
            </button>
            <button
              onClick={() => fetchActivity()}
              disabled={loading}
              title="Refresh activity"
              className="flex items-center justify-center rounded-md p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin-slow' : ''} />
            </button>
            {/* Group mode toggle */}
            <div className="flex shrink-0 items-center gap-1 rounded-md bg-stone-100 p-0.5">
            <button
              onClick={() => setGroupMode('matter')}
              className={`rounded px-2 py-1 text-xs font-medium ${groupMode === 'matter' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`}
            >
              Matter
            </button>
            <button
              onClick={() => setGroupMode('app')}
              className={`rounded px-2 py-1 text-xs font-medium ${groupMode === 'app' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`}
            >
              App
            </button>
            <button
              onClick={() => setGroupMode('review')}
              className={`rounded px-2 py-1 text-xs font-medium ${groupMode === 'review' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`}
            >
              Review
            </button>
          </div>
          </div>
        </div>
      </div>

      {/* Split content: activity on left, timesheet panel on right */}
      <div className="flex flex-1 flex-col overflow-hidden sm:flex-row">
        {/* Left pane — activity sessions */}
        <div className={`flex-1 overflow-auto px-4 py-4 ${mobileTab === 'signals' ? 'block' : 'hidden'} sm:block`}>
          {/* Manual entries */}
          {manualEntries.length > 0 && (
            <div className="mb-4 space-y-1.5">
              {manualEntries.map((entry) => {
                const matter = matters.find((m) => m.id === entry.matter_id);
                return (
                  <div key={entry.id} className="card flex items-center gap-3 px-3 py-2">
                    <span className="rounded bg-accent-100 px-1.5 py-0.5 text-xs font-medium text-accent-800">
                      Manual
                    </span>
                    <Clock size={12} className="text-stone-400" />
                    <span className="text-sm text-stone-800">{entry.description}</span>
                    <span className="ml-auto text-xs text-stone-500">
                      {formatMinutes(entry.duration_minutes)}
                      {matter ? ` · ${matter.case_id_visible ?? matter.name}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Already recorded in SingleCase */}
          {existingTimeEntries.length > 0 && (
            <div className="mb-4">
              <div className="mb-1.5 flex items-center gap-2">
                <Lock size={14} className="text-stone-400" />
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Already recorded in SingleCase
                </span>
                <span className="text-xs text-stone-400">
                  {formatMinutes(recordedMinutes)} — excluded from generation
                </span>
              </div>
              <div className="space-y-1">
                {existingTimeEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-1.5">
                    <span className="font-mono text-xs text-stone-500">{entry.start_time}</span>
                    <span className="text-sm text-stone-700">{entry.description}</span>
                    <span className="ml-auto text-xs text-stone-500">
                      {formatMinutes(entry.duration_minutes)} · {entry.case_name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Possible duplicates */}
          {duplicateItemIds.size > 0 && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="text-amber-600" />
                <span className="text-xs font-medium text-amber-800">
                  {duplicateItemIds.size} {duplicateItemIds.size === 1 ? 'item' : 'items'} may already be recorded in SingleCase
                </span>
              </div>
              <div className="mt-1.5 space-y-1">
                {items
                  .filter((i) => duplicateItemIds.has(i.id))
                  .map((item) => (
                    <div key={item.id} className="flex items-center gap-2 text-xs">
                      <span className="text-stone-600">{item.summary}</span>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">already recorded</span>
                      <button
                        onClick={() => toggleDuplicateOverride(item.id)}
                        className={`text-xs ${
                          overriddenDuplicates.has(item.id)
                            ? 'text-accent-700 underline'
                            : 'text-stone-500 underline hover:text-stone-800'
                        }`
                      }
                      >
                        {overriddenDuplicates.has(item.id) ? 'Include anyway' : 'Override'}
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-3 animate-fade-in">
              <div className="flex items-center gap-2 text-sm text-stone-400">
                <Loader2 size={14} className="animate-spin-slow" />
                Loading activity...
              </div>
              {[...Array(6)].map((_, i) => (
                <div key={i} className="card p-3" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="flex items-center gap-3">
                    <div className="skeleton h-4 w-4 rounded" />
                    <div className="skeleton h-3 w-20" />
                    <div className="flex-1 space-y-1.5">
                      <div className="skeleton h-3.5 w-3/4" />
                      <div className="skeleton h-2.5 w-1/2" />
                    </div>
                    <div className="skeleton h-3 w-12" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              {providerError ? (
                <>
                  <div className="flex items-center gap-2 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 max-w-md">
                    <AlertCircle size={16} className="shrink-0" />
                    <span className="text-left">
                      {providerError}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-stone-400">
                    Check your connections in Settings to make sure everything is still linked correctly.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-stone-500">No activity found for this day.</p>
                  <p className="mt-2 text-xs text-stone-400">
                    Connect your work applications in Settings to start seeing activity.
                  </p>
                </>
              )}
            </div>
          ) : groupMode === 'review' ? (
            <ReviewCardList
              items={visibleSelectedItems}
              sessions={resolvedSessions}
              matters={matters}
              clients={clients}
              rules={matterRules}
              timezone={profile?.timezone}
              recentMatterIds={recentMatterIds}
              onAssign={(itemId, matterId) => {
                setRecentMatterIds((prev) => [matterId, ...prev.filter((id) => id !== matterId)].slice(0, 10));
                setManualOverrides((prev) => { const next = new Map(prev); next.set(itemId, matterId); return next; });
              }}
              onNonBillable={(itemId) => {
                setManualOverrides((prev) => { const next = new Map(prev); next.set(itemId, null); return next; });
              }}
              onIgnore={(itemId) => {
                setManualOverrides((prev) => { const next = new Map(prev); next.set(itemId, null); return next; });
              }}
              onCreateRule={async (rule) => {
                const newRule: MatterRule = {
                  ...rule,
                  id: `rule-${Date.now()}`,
                  created_at: new Date().toISOString(),
                  hit_count: 0,
                  source: 'user_confirmed',
                  user_id: profile?.user_id ?? '',
                } as MatterRule;
                setMatterRules((prev) => [...prev, newRule]);
                if (profile?.user_id) {
                  await supabase.from('matter_rules').insert({
                    user_id: profile.user_id,
                    matter_id: rule.matter_id,
                    rule_type: rule.rule_type,
                    value: rule.value,
                    source: 'user_confirmed',
                  });
                }
              }}
              onUndo={(itemId) => {
                setManualOverrides((prev) => { const next = new Map(prev); next.delete(itemId); return next; });
              }}
            />
          ) : groupMode === 'matter' ? (
            <div className="flex gap-3">
              <div className="min-w-0 flex-1">
                <AssignmentTray
                  items={visibleSelectedItems}
                  sessions={resolvedSessions}
                  matters={matters}
                  clients={clients}
                  rules={matterRules}
                  recentMatterIds={recentMatterIds}
                  timezone={profile?.timezone}
                  onAssign={(itemId, matterId) => {
                    setRecentMatterIds((prev) => [matterId, ...prev.filter((id) => id !== matterId)].slice(0, 10));
                    setManualOverrides((prev) => { const next = new Map(prev); next.set(itemId, matterId); return next; });
                  }}
                  onNonBillable={(itemId) => {
                    setManualOverrides((prev) => { const next = new Map(prev); next.set(itemId, null); return next; });
                  }}
                  onIgnore={(itemId) => {
                    setManualOverrides((prev) => { const next = new Map(prev); next.set(itemId, null); return next; });
                  }}
                  onCreateRule={async (rule) => {
                    const newRule: MatterRule = {
                      ...rule,
                      id: `rule-${Date.now()}`,
                      created_at: new Date().toISOString(),
                      hit_count: 0,
                      source: 'user_confirmed',
                    };
                    setMatterRules((prev) => [...prev, newRule]);
                    if (profile?.user_id) {
                      await supabase.from('matter_rules').insert({
                        user_id: profile.user_id,
                        matter_id: rule.matter_id,
                        rule_type: rule.rule_type,
                        value: rule.value,
                        source: 'user_confirmed',
                      });
                    }
                  }}
                  onUndo={(itemId) => {
                    setManualOverrides((prev) => { const next = new Map(prev); next.delete(itemId); return next; });
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <div className="sticky top-3 hidden w-[260px] shrink-0 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm lg:block">
                <div className="border-b border-stone-100 bg-stone-50 px-4 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">Day flow</div>
                  <div className="mt-0.5 text-[10px] text-stone-400">10-minute-plus signals</div>
                </div>
                <div className="max-h-[calc(100vh-13rem)] overflow-y-auto">
                <VerticalTimeline
                  items={items}
                  timezone={profile?.timezone}
                  workStart={workStart}
                  workEnd={workEnd}
                  usedItemIds={usedItemIds}
                  generatedItemIds={generatedItemIds}
                />
                </div>
              </div>
              <div className="card min-w-0 flex-1 overflow-hidden">
                <ActivityList
                  items={items}
                  selectedIds={selectedIds}
                  onToggle={toggle}
                  collapsedSections={collapsedSections}
                  onToggleSection={toggleSection}
                  onToggleProviderAll={toggleProviderAll}
                  focusedIndex={focusedIndex}
                  onFocusIndex={setFocusedIndex}
                  flatIds={flatIds}
                  usedItemIds={usedItemIds}
                  generatedItemIds={generatedItemIds}
                  timezone={profile?.timezone}
                  onDragStart={() => undefined}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right pane — live timesheet panel */}
        <div className={`relative w-full shrink-0 p-3 sm:w-[380px] ${mobileTab === 'timesheet' ? 'flex flex-col' : 'hidden'} sm:flex sm:flex-col`}>
          <TimesheetPanel
            entries={draftEntries ?? []}
            onEntriesChange={(e) => setDraftEntries(e)}
            matters={matters}
            estimate={estimateResult}
            targetHours={targetHours}
            existingRecordedMinutes={recordedMinutes}
            generating={generating}
            generationErrors={generationErrors}
            saving={saving}
            saveError={saveError}
            saveSuccess={saveSuccess}
            onSave={handleSave}
            onRegenerate={handleGenerate}
            onDropSignal={handlePreviewDrop}
            onDropToEmpty={(itemId) => setPendingDropItemId(itemId)}
            hasAssignedSessions={hasAssignedSessions}
            lastDropMatterId={lastDropMatterId}
          />
          {pendingDropSession && pendingDropItemId && (
            <div className="absolute inset-0 z-30 flex items-end justify-center bg-black/20 sm:right-5 sm:top-5 sm:inset-auto sm:items-start sm:justify-start">
              <MatterPicker
                anchorId={pendingDropItemId}
                candidates={pendingDropSession.candidates}
                matters={matters}
                clients={clients}
                recentMatterIds={recentMatterIds}
                currentMatterId={null}
                onAssign={assignPendingDrop}
                onNonBillable={() => {
                  setManualOverrides((prev) => {
                    const next = new Map(prev);
                    next.set(pendingDropItemId, null);
                    return next;
                  });
                  setPendingDropItemId(null);
                }}
                onIgnore={closePendingDropPicker}
                onClose={closePendingDropPicker}
              />
            </div>
          )}
        </div>
      </div>

      {/* Mobile tab switcher */}
      <div className="flex shrink-0 border-t border-stone-200 bg-white sm:hidden">
        <button
          onClick={() => setMobileTab('signals')}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
            mobileTab === 'signals' ? 'border-b-2 border-accent-500 text-accent-700' : 'text-stone-500'
          }`
        }
        >
          <ListChecks size={16} />
          Signals
        </button>
        <button
          onClick={() => setMobileTab('timesheet')}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
            mobileTab === 'timesheet' ? 'border-b-2 border-accent-500 text-accent-700' : 'text-stone-500'
          }`}
        >
          <FileText size={16} />
          Timesheet
        </button>
      </div>

      {/* Bottom bar: Add manually + auto-gen toggle (desktop only) */}
      <div className="hidden shrink-0 border-t border-stone-200 bg-white px-4 py-3 sm:block">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowManualForm(true)}
              className="btn-secondary text-sm"
            >
              <Plus size={16} /> Add manually
            </button>
            <label className="flex items-center gap-1.5 text-xs text-stone-500">
              <input
                type="checkbox"
                checked={autoGenEnabled}
                onChange={(e) => setAutoGenEnabled(e.target.checked)}
                className="rounded accent-accent-600"
              />
              Auto-generate
            </label>
          </div>
          {!autoGenEnabled && (
            <button
              onClick={handleGenerate}
              disabled={generationItems.length === 0 || generating}
              className={`btn-primary relative overflow-hidden ${generating ? 'progress-shimmer' : ''}`}
            >
              {generating ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin-slow" />
                  Generating...
                </span>
              ) : (
                `Generate timesheet`
              )}
            </button>
          )}
        </div>
      </div>

      {/* Mobile: sticky generate button */}
      <div className="shrink-0 border-t border-stone-200 bg-white px-4 py-3 sm:hidden">
        <button
          onClick={handleGenerate}
          disabled={generationItems.length === 0 || generating}
          className={`btn-primary relative w-full overflow-hidden ${generating ? 'progress-shimmer' : ''}`}
        >
          {generating ? (
            <span className="flex items-center gap-2">
              <Loader2 size={16} className="animate-spin-slow" />
              Generating...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Sparkles size={16} />
              Generate timesheet
            </span>
          )}
        </button>
      </div>

      {/* Manual entry modal */}
      {showManualForm && (
        <ManualEntryForm
          workDate={selectedDate}
          matters={matters}
          activityTypes={activityTypes}
          onSaved={handleManualSaved}
          onCancel={() => setShowManualForm(false)}
        />
      )}

    </div>
  );
}

// --- Matter-grouped view ----------------------------------------------------

interface MatterGroupedViewProps {
  groups: MatterGroup[];
  internalGroups: MatterGroup[];
  unassignedGroup: MatterGroup | undefined;
  collapsedSections: Set<string>;
  onToggleSection: (key: string) => void;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  items: ActivityItem[];
  flatIds: string[];
  focusedIndex: number | null;
  onFocusIndex: (i: number | null) => void;
  collapsedProviders: Set<Provider>;
  onToggleProvider: (p: Provider) => void;
  onToggleProviderAll: (p: Provider, select: boolean) => void;
}

function MatterGroupedView({
  groups,
  internalGroups,
  unassignedGroup,
  collapsedSections,
  onToggleSection,
  selectedIds,
  onToggle,
  items,
  flatIds,
  focusedIndex,
  onFocusIndex,
  collapsedProviders,
  onToggleProvider,
  onToggleProviderAll,
}: MatterGroupedViewProps) {
  return (
    <div className="space-y-3">
      {/* Unassigned tray */}
      {unassignedGroup && unassignedGroup.entries.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-stone-100 bg-gradient-to-r from-stone-50 to-white px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100">
              <AlertCircle size={16} className="text-stone-500" />
            </span>
            <span className="text-sm font-semibold text-stone-800">
              {unassignedGroup.entries.length} {unassignedGroup.entries.length === 1 ? 'entry' : 'entries'} need a matter
            </span>
            <span className="ml-auto text-xs font-medium text-stone-500">
              {formatMinutes(unassignedGroup.totalMinutes)}
            </span>
            <button
              onClick={() => onToggleSection('__unassigned')}
              className="text-stone-400 transition-colors hover:text-stone-600"
            >
              {collapsedSections.has('__unassigned') ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
          {!collapsedSections.has('__unassigned') && (
            <div className="divide-y divide-stone-100">
              {unassignedGroup.entries.map((entry) => (
                <UnassignedEntryRow
                  key={entry.id}
                  entry={entry}
                  items={items}
                  selectedIds={selectedIds}
                  onToggle={onToggle}
                  flatIds={flatIds}
                  focusedIndex={focusedIndex}
                  onFocusIndex={onFocusIndex}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-1.5 text-sm text-green-700">
          <CheckCircle2 size={14} />
          All activity assigned to a matter.
        </div>
      )}

      {/* Billable matter sections */}
      {groups.map((group) => {
        const key = group.matterId ?? '__no-matter';
        const collapsed = collapsedSections.has(key);
        return (
          <MatterSection
            key={key}
            group={group}
            collapsed={collapsed}
            onToggleSection={() => onToggleSection(key)}
            selectedIds={selectedIds}
            onToggleItem={onToggle}
            items={items}
            flatIds={flatIds}
            focusedIndex={focusedIndex}
            onFocusIndex={onFocusIndex}
            collapsedProviders={collapsedProviders}
            onToggleProvider={onToggleProvider}
            onToggleProviderAll={onToggleProviderAll}
          />
        );
      })}

      {/* Non-billable / internal section */}
      {internalGroups.length > 0 && (
        <div className="rounded-lg border border-stone-200 bg-stone-50">
          <button
            onClick={() => onToggleSection('__internal')}
            className="flex w-full items-center gap-2 px-4 py-2.5"
          >
            {collapsedSections.has('__internal') ? <ChevronRight size={16} className="text-stone-400" /> : <ChevronDown size={16} className="text-stone-400" />}
            <FolderOpen size={14} className="text-stone-400" />
            <span className="text-sm font-medium text-stone-600">Non-billable / Internal</span>
            <span className="text-xs text-stone-400">
              {internalGroups.reduce((s, g) => s + g.totalMinutes, 0)} min
            </span>
          </button>
          {!collapsedSections.has('__internal') && (
            <div className="border-t border-stone-200">
              {internalGroups.map((group) => (
                <MatterSection
                  key={group.matterId}
                  group={group}
                  collapsed={false}
                  onToggleSection={() => {}}
                  selectedIds={selectedIds}
                  onToggleItem={onToggle}
                  items={items}
                  flatIds={flatIds}
                  focusedIndex={focusedIndex}
                  onFocusIndex={onFocusIndex}
                  collapsedProviders={collapsedProviders}
                  onToggleProvider={onToggleProvider}
                  onToggleProviderAll={onToggleProviderAll}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ignored section — always collapsed */}
      <div className="rounded-lg border border-stone-200 bg-stone-50">
        <button
          onClick={() => onToggleSection('__ignored')}
          className="flex w-full items-center gap-2 px-4 py-2.5"
        >
          {collapsedSections.has('__ignored') ? <ChevronRight size={16} className="text-stone-400" /> : <ChevronDown size={16} className="text-stone-400" />}
          <Inbox size={14} className="text-stone-400" />
          <span className="text-sm font-medium text-stone-500">Ignored</span>
        </button>
      </div>
    </div>
  );
}

function MatterSection({
  group,
  collapsed,
  onToggleSection,
  selectedIds,
  onToggleItem,
  items,
  flatIds,
  focusedIndex,
  onFocusIndex,
  collapsedProviders,
  onToggleProvider,
  onToggleProviderAll,
}: {
  group: MatterGroup;
  collapsed: boolean;
  onToggleSection: () => void;
  selectedIds: Set<string>;
  onToggleItem: (id: string) => void;
  items: ActivityItem[];
  flatIds: string[];
  focusedIndex: number | null;
  onFocusIndex: (i: number | null) => void;
  collapsedProviders: Set<Provider>;
  onToggleProvider: (p: Provider) => void;
  onToggleProviderAll: (p: Provider, select: boolean) => void;
}) {
  const matter = group.matter;
  const allSourceIds = group.entries.flatMap((e) => e.sourceItemIds);
  const sectionItems = items.filter((i) => allSourceIds.includes(i.id));

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggleSection}
        className="flex w-full items-center gap-2 border-b border-stone-200 bg-stone-50 px-4 py-2.5"
      >
        {collapsed ? <ChevronRight size={16} className="text-stone-400" /> : <ChevronDown size={16} className="text-stone-400" />}
        <span className="text-sm font-semibold text-stone-800">
          {matter?.case_id_visible ?? matter?.name ?? group.label}
        </span>
        {matter && (
          <span className="text-xs text-stone-500">
            {matter.name}
          </span>
        )}
        <span className="ml-auto text-sm font-medium text-stone-700">
          {formatHours(group.totalMinutes)}
        </span>
      </button>

      {/* Items */}
      {!collapsed && sectionItems.length > 0 && (
        <ActivityList
          items={sectionItems}
          selectedIds={selectedIds}
          onToggle={onToggleItem}
          collapsedSections={collapsedProviders}
          onToggleSection={onToggleProvider}
          onToggleProviderAll={onToggleProviderAll}
          focusedIndex={focusedIndex}
          onFocusIndex={onFocusIndex}
          flatIds={flatIds}
        />
      )}
    </div>
  );
}

function UnassignedEntryRow({
  entry,
  items,
  selectedIds,
  onToggle,
  flatIds,
  focusedIndex,
  onFocusIndex,
}: {
  entry: AttributedEntry;
  items: ActivityItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  flatIds: string[];
  focusedIndex: number | null;
  onFocusIndex: (i: number | null) => void;
}) {
  const entryItems = items.filter((i) => entry.sourceItemIds.includes(i.id));
  return (
    <div className="rounded-md bg-white/60 px-2 py-1.5">
      <div className="flex items-center gap-2 text-xs text-stone-600">
        <span className="font-medium">{formatMinutes(entry.roundedMinutes)}</span>
        <span className="text-stone-400">·</span>
        <span>{entry.label}</span>
        <span className="ml-auto text-stone-400">{entry.attribution.reason}</span>
      </div>
      {entryItems.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {entryItems.map((item) => {
            const selected = selectedIds.has(item.id);
            return (
              <button
                key={item.id}
                onClick={() => onToggle(item.id)}
                className={`rounded px-1.5 py-0.5 text-xs ${
                  selected ? 'bg-stone-200 text-stone-700' : 'text-stone-400 hover:bg-stone-100'
                }`}
              >
                {item.summary}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
