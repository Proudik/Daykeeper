import { useMemo, useState } from 'react';
import type { ActivityItem, Matter, MatterRule, MatterRuleType, Provider, MatterConfidence } from '@/types';
import type { ResolvedSession, ScoredCandidate } from '@/lib/attribution/scoring-resolver';
import { MatterPicker } from './MatterPicker';
import {
  Mail,
  Calendar,
  MessageSquare,
  FileText,
  Globe,
  Inbox,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  CheckCircle2,
  EyeOff,
  X,
  Briefcase,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Sparkles,
  ArrowDownWideNarrow,
} from 'lucide-react';
import { formatTime, formatMinutes } from '@/lib/time';
import {
  GmailIcon,
  GoogleCalendarIcon,
  ChromeIcon,
  SingleCaseIcon,
  SlackIcon,
  AsanaIcon,
  JiraIcon,
  GitHubIcon,
  TrelloIcon,
  HubSpotIcon,
  NotionIcon,
  LinearIcon,
  ZendeskIcon,
  ClickUpIcon,
  GoogleIcon,
  MicrosoftIcon,
} from './BrandIcons';

type IconType = React.FC<{ size?: number; className?: string; style?: React.CSSProperties }>;

const PROVIDER_ICONS: Record<Provider, IconType> = {
  email: GmailIcon as IconType,
  calendar: GoogleCalendarIcon as IconType,
  chat: MessageSquare,
  documents: FileText,
  singlecase: SingleCaseIcon as IconType,
  browser: ChromeIcon as IconType,
  custom: FileText,
};

const PROVIDER_COLORS: Record<Provider, string> = {
  email: '#2563eb',
  calendar: '#dc2626',
  chat: '#059669',
  documents: '#7c3aed',
  singlecase: '#0891b2',
  browser: '#0d9488',
  custom: '#ea580c',
};

const MATTER_PALETTE = [
  '#2563eb', '#dc2626', '#059669', '#ea580c',
  '#7c3aed', '#0891b2', '#db2777', '#ca8a04',
  '#4f46e5', '#16a34a', '#e11d48', '#0d9488',
];

const CONFIDENCE_STYLES: Record<MatterConfidence, { label: string; color: string; bg: string }> = {
  confirmed: { label: 'Confirmed', color: '#15803d', bg: '#f0fdf4' },
  high: { label: 'High confidence', color: '#1d4ed8', bg: '#eff6ff' },
  medium: { label: 'Needs review', color: '#b45309', bg: '#fffbeb' },
  low: { label: 'Low confidence', color: '#9a3412', bg: '#fff7ed' },
  unassigned: { label: 'Unassigned', color: '#9f1239', bg: '#fef2f2' },
};

type SortMode = 'newest' | 'oldest' | 'confidence';

export interface ReviewCardListProps {
  items: ActivityItem[];
  sessions: ResolvedSession[];
  matters: Matter[];
  clients: { id: string; name: string }[];
  rules: MatterRule[];
  timezone?: string;
  recentMatterIds: string[];
  onAssign: (itemId: string, matterId: string) => void;
  onNonBillable: (itemId: string) => void;
  onIgnore: (itemId: string) => void;
  onCreateRule: (rule: { rule_type: MatterRuleType; value: string; matter_id: string }) => void;
  onUndo: (itemId: string) => void;
}

export function ReviewCardList({
  items,
  sessions,
  matters,
  clients,
  rules,
  timezone,
  recentMatterIds,
  onAssign,
  onNonBillable,
  onIgnore,
  onCreateRule,
  onUndo,
}: ReviewCardListProps) {
  const [openPickerId, setOpenPickerId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('newest');

  const itemsById = useMemo(() => {
    const map = new Map<string, ActivityItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const matterColorMap = useMemo(() => {
    const map = new Map<string, string>();
    matters.forEach((m, i) => map.set(m.id, MATTER_PALETTE[i % MATTER_PALETTE.length]));
    return map;
  }, [matters]);

  const sessionEarliestTime = (session: ResolvedSession): number => {
    let earliest = Infinity;
    for (const id of session.sourceItemIds) {
      const it = itemsById.get(id);
      if (it) earliest = Math.min(earliest, new Date(it.timestamp).getTime());
    }
    return earliest === Infinity ? 0 : earliest;
  };

  const sortedSessions = useMemo(() => {
    const confidenceOrder: Record<MatterConfidence, number> = {
      unassigned: 0,
      medium: 1,
      low: 2,
      high: 3,
      confirmed: 4,
    };
    const arr = [...sessions];
    arr.sort((a, b) => {
      if (sortMode === 'confidence') {
        if (confidenceOrder[a.confidence] !== confidenceOrder[b.confidence]) {
          return confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
        }
      }
      const aTime = sessionEarliestTime(a);
      const bTime = sessionEarliestTime(b);
      return sortMode === 'oldest' ? aTime - bTime : bTime - aTime;
    });
    return arr;
  }, [sessions, itemsById, sortMode]);

  const sessionDuration = (session: ResolvedSession): number => {
    let total = 0;
    for (const id of session.sourceItemIds) {
      const item = itemsById.get(id);
      if (!item) continue;
      if (item.endTimestamp) {
        total += Math.max(1, Math.round((new Date(item.endTimestamp).getTime() - new Date(item.timestamp).getTime()) / 60000));
      } else {
        total += item.durationMinutes ?? 5;
      }
    }
    return total;
  };

  const sessionTimeRange = (session: ResolvedSession): { start: string; end: string } | null => {
    let earliest: string | null = null;
    let latest: string | null = null;
    for (const id of session.sourceItemIds) {
      const item = itemsById.get(id);
      if (!item) continue;
      if (!earliest || item.timestamp < earliest) earliest = item.timestamp;
      const end = item.endTimestamp ?? item.timestamp;
      if (!latest || end > latest) latest = end;
    }
    if (!earliest) return null;
    return { start: earliest, end: latest ?? earliest };
  };

  function handleAssign(itemId: string, matterId: string) {
    onAssign(itemId, matterId);
    setOpenPickerId(null);
  }

  function handleCreateRule(itemId: string, ruleType: MatterRuleType, value: string, matterId: string) {
    onCreateRule({ rule_type: ruleType, value, matter_id: matterId });
  }

  const unassignedCount = sessions.filter((s) => s.matterId === null).length;

  return (
    <div className="space-y-3">
      {unassignedCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertCircle size={14} className="shrink-0" />
          <span>
            {unassignedCount} {unassignedCount === 1 ? 'entry' : 'entries'} need a matter assignment.
          </span>
        </div>
      )}

      {/* Sort controls */}
      {sessions.length > 0 && (
        <div className="flex items-center gap-2">
          <ArrowDownWideNarrow size={13} className="text-stone-400" />
          <span className="text-xs text-stone-400">Sort:</span>
          {(['newest', 'oldest', 'confidence'] as SortMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setSortMode(mode)}
              className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                sortMode === mode
                  ? 'bg-stone-700 text-white'
                  : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
              }`}
            >
              {mode === 'newest' ? 'Newest first' : mode === 'oldest' ? 'Oldest first' : 'Needs review'}
            </button>
          ))}
        </div>
      )}

      {sortedSessions.map((session) => {
        const sessionItems = session.sourceItemIds
          .map((id) => itemsById.get(id))
          .filter((i): i is ActivityItem => i !== undefined);
        if (sessionItems.length === 0) return null;

        const timeRange = sessionTimeRange(session);
        const duration = sessionDuration(session);
        const matter = session.matter;
        const matterColor = matter ? matterColorMap.get(matter.id) ?? '#78716c' : '#d97706';
        const confStyle = CONFIDENCE_STYLES[session.confidence];
        const isExpanded = expandedId === session.sessionId;
        const isPickerOpen = openPickerId === session.sessionId;
        const primaryItem = sessionItems[0];
        const Icon = primaryItem ? PROVIDER_ICONS[primaryItem.provider] : Mail;

        // Items shown as pills — exclude the primary item to avoid duplication
        const secondaryItems = sessionItems.slice(1);
        const visibleSecondary = isExpanded ? secondaryItems : secondaryItems.slice(0, 2);

        return (
          <div
            key={session.sessionId}
            className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition-shadow hover:shadow-md"
          >
            {/* Card header */}
            <div className="flex items-start gap-3 px-4 py-3">
              {/* Time column */}
              <div className="flex w-16 shrink-0 flex-col items-center pt-0.5">
                <span className="font-mono text-sm font-semibold text-stone-700">
                  {timeRange ? formatTime(timeRange.start, timezone) : '--'}
                </span>
                <span className="font-mono text-xs text-stone-400">
                  {timeRange && timeRange.end !== timeRange.start ? formatTime(timeRange.end, timezone) : ''}
                </span>
                <span className="mt-1 flex items-center gap-0.5 text-xs text-stone-500">
                  <Clock size={10} />
                  {formatMinutes(duration)}
                </span>
              </div>

              {/* Vertical accent bar */}
              <div
                className="mt-0.5 h-full w-1 shrink-0 self-stretch rounded-full"
                style={{ backgroundColor: matterColor, minHeight: '48px' }}
              />

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon size={16} className="shrink-0" />
                  <span className="text-sm font-medium text-stone-800">
                    {primaryItem?.summary ?? 'Activity session'}
                  </span>
                  {secondaryItems.length > 0 && (
                    <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
                      +{secondaryItems.length} more
                    </span>
                  )}
                </div>

                {/* Secondary source items (primary already shown above) */}
                {visibleSecondary.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {visibleSecondary.map((item) => {
                      const SIcon = PROVIDER_ICONS[item.provider];
                      return (
                        <span
                          key={item.id}
                          className="inline-flex items-center gap-1 rounded-md bg-stone-50 px-1.5 py-0.5 text-xs text-stone-600"
                        >
                          <SIcon size={12} />
                          <span className="max-w-[180px] truncate">{item.summary}</span>
                          {item.provider === 'email' && (
                            item.meta.direction === 'outgoing'
                              ? <ArrowUpRight size={9} className="text-blue-400" />
                              : <ArrowDownLeft size={9} className="text-emerald-400" />
                          )}
                        </span>
                      );
                    })}
                    {!isExpanded && secondaryItems.length > 2 && (
                      <button
                        onClick={() => setExpandedId(session.sessionId)}
                        className="rounded-md bg-stone-50 px-1.5 py-0.5 text-xs text-stone-500 hover:bg-stone-100"
                      >
                        +{secondaryItems.length - 2} more
                      </button>
                    )}
                  </div>
                )}

                {/* Attribution reason */}
                {session.reason && (
                  <p className="mt-1.5 text-xs text-stone-400">{session.reason}</p>
                )}
              </div>

              {/* Confidence badge */}
              <div className="shrink-0">
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: confStyle.bg, color: confStyle.color }}
                >
                  {session.confidence === 'confirmed' && <CheckCircle2 size={10} />}
                  {session.confidence === 'medium' && <AlertCircle size={10} />}
                  {session.confidence === 'unassigned' && <AlertCircle size={10} />}
                  {confStyle.label}
                </span>
              </div>
            </div>

            {/* Matter assignment bar */}
            <div className="flex items-center gap-2 border-t border-stone-100 bg-stone-50/50 px-4 py-2">
              {matter ? (
                <>
                  <Briefcase size={13} className="shrink-0 text-stone-400" />
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: matterColor }}
                  />
                  <span className="font-mono text-xs text-stone-600">
                    {matter.case_id_visible ?? matter.name}
                  </span>
                  <span className="truncate text-xs text-stone-500">{matter.name}</span>
                  <button
                    onClick={() => setOpenPickerId(isPickerOpen ? null : session.sessionId)}
                    className="ml-auto text-xs text-stone-500 underline hover:text-stone-800"
                  >
                    Change
                  </button>
                  <button
                    onClick={() => onUndo(session.sourceItemIds[0])}
                    className="text-xs text-stone-400 underline hover:text-stone-600"
                  >
                    Undo
                  </button>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1 text-xs font-medium text-amber-700">
                    <AlertCircle size={13} />
                    <span className="hidden sm:inline">No matter assigned</span>
                    <span className="sm:hidden">Unassigned</span>
                  </span>
                  {/* Mobile: stacked full-width action buttons */}
                  <div className="ml-auto flex w-full gap-1.5 sm:hidden">
                    <button
                      onClick={() => setOpenPickerId(isPickerOpen ? null : session.sessionId)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent-700 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-800"
                    >
                      <Briefcase size={14} /> Assign
                    </button>
                    <button
                      onClick={() => onNonBillable(session.sourceItemIds[0])}
                      className="flex items-center justify-center rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-600 hover:bg-stone-100"
                    >
                      <EyeOff size={14} />
                    </button>
                    <button
                      onClick={() => onIgnore(session.sourceItemIds[0])}
                      className="flex items-center justify-center rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-500 hover:bg-stone-100"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {/* Desktop: inline action buttons */}
                  <div className="ml-auto hidden items-center gap-1.5 sm:flex">
                    <button
                      onClick={() => setOpenPickerId(isPickerOpen ? null : session.sessionId)}
                      className="inline-flex items-center gap-1 rounded-md bg-accent-700 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-800"
                    >
                      <Briefcase size={12} /> Assign
                    </button>
                    <button
                      onClick={() => onNonBillable(session.sourceItemIds[0])}
                      className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
                    >
                      <EyeOff size={12} /> Non-billable
                    </button>
                    <button
                      onClick={() => onIgnore(session.sourceItemIds[0])}
                      className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-500 hover:bg-stone-100"
                    >
                      <X size={12} /> Ignore
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Matter picker dropdown */}
            {isPickerOpen && (
              <div className="border-t border-stone-100 bg-white px-4 py-2 animate-fade-in">
                <MatterPicker
                  anchorId={session.sessionId}
                  candidates={session.candidates as ScoredCandidate[]}
                  matters={matters}
                  clients={clients}
                  recentMatterIds={recentMatterIds}
                  currentMatterId={session.matterId}
                  onAssign={(matterId) => handleAssign(session.sourceItemIds[0], matterId)}
                  onNonBillable={() => { onNonBillable(session.sourceItemIds[0]); setOpenPickerId(null); }}
                  onIgnore={() => { onIgnore(session.sourceItemIds[0]); setOpenPickerId(null); }}
                  onClose={() => setOpenPickerId(null)}
                  onCreateRule={(rule) => handleCreateRule(session.sourceItemIds[0], rule.rule_type, rule.value, rule.matter_id)}
                />
              </div>
            )}

            {/* Expand/collapse toggle */}
            {secondaryItems.length > 2 && (
              <button
                onClick={() => setExpandedId(isExpanded ? null : session.sessionId)}
                className="flex w-full items-center justify-center gap-1 border-t border-stone-100 py-1.5 text-xs text-stone-400 hover:bg-stone-50"
              >
                {isExpanded ? (
                  <><ChevronUp size={12} /> Show less</>
                ) : (
                  <><ChevronDown size={12} /> Show all {sessionItems.length} items</>
                )}
              </button>
            )}
          </div>
        );
      })}

      {sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Sparkles size={24} className="text-stone-300" />
          <p className="mt-2 text-sm text-stone-500">Select activity items above to review them here.</p>
        </div>
      )}
    </div>
  );
}
