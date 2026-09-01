import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { Matter, MatterRule, MatterRuleType, ActivityItem, Provider } from '@/types';
import type { ResolvedSession, ScoredCandidate } from '@/lib/attribution/scoring-resolver';
import { MatterPicker } from './MatterPicker';
import { GENERIC_EMAIL_DOMAINS } from '@/providers/singlecase/constants';
import {
  AlertCircle,
  CheckCircle2,
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  X,
  Layers,
  Sparkles,
  ArrowDownLeft,
  ArrowUpRight,
  Mail,
  Globe,
  Clock,
  EyeOff,
  Tag,
  ChevronUp,
  Plus,
} from 'lucide-react';
import { formatTime, formatMinutes } from '@/lib/time';
import { getBrowserItemMeta } from '@/providers/browser';

// Stable color palette for matter chips
const MATTER_PALETTE = [
  '#2563eb', '#dc2626', '#059669', '#ea580c',
  '#7c3aed', '#0891b2', '#db2777', '#ca8a04',
  '#4f46e5', '#16a34a', '#e11d48', '#0d9488',
];
const UNASSIGNED_COLOR = '#f59e0b';

const PROVIDER_DOT_COLORS: Record<Provider, string> = {
  email: '#2563eb',
  calendar: '#dc2626',
  chat: '#059669',
  documents: '#7c3aed',
  singlecase: '#0891b2',
  browser: '#0d9488',
  custom: '#ea580c',
};

export interface TrayItem {
  item: ActivityItem;
  session?: ResolvedSession;
}

export interface AssignmentTrayProps {
  items: ActivityItem[];
  sessions: ResolvedSession[];
  matters: Matter[];
  clients: { id: string; name: string }[];
  rules: MatterRule[];
  recentMatterIds: string[];
  onAssign: (itemId: string, matterId: string) => void;
  onNonBillable: (itemId: string) => void;
  onIgnore: (itemId: string) => void;
  onCreateRule: (rule: Omit<MatterRule, 'id' | 'created_at' | 'hit_count' | 'source'>) => void;
  onUndo: (itemId: string) => void;
  timezone?: string;
}

interface AssignmentState {
  // itemId → matterId (null = unassigned/ignored/non-billable)
  assignments: Map<string, string | null>;
  // itemId → 'ignored' | 'non-billable' | null
  status: Map<string, 'ignored' | 'non-billable' | null>;
  // itemId → previous state (for undo)
  previous: Map<string, { matterId: string | null; status: 'ignored' | 'non-billable' | null }>;
}

export function AssignmentTray({
  items,
  sessions,
  matters,
  clients,
  rules,
  recentMatterIds,
  onAssign,
  onNonBillable,
  onIgnore,
  onCreateRule,
  onUndo,
  timezone,
}: AssignmentTrayProps) {
  const [assignments, setAssignments] = useState<Map<string, string | null>>(new Map());
  const [status, setStatus] = useState<Map<string, 'ignored' | 'non-billable' | null>>(new Map());
  const [previous, setPrevious] = useState<Map<string, { matterId: string | null; status: 'ignored' | 'non-billable' | null }>>(new Map());
  const [openPickerId, setOpenPickerId] = useState<string | null>(null);
  const [expandedBrowser, setExpandedBrowser] = useState<Set<string>>(new Set());
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [ruleStripItem, setRuleStripItem] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build session lookup
  const sessionByItem = useMemo(() => {
    const map = new Map<string, ResolvedSession>();
    for (const session of sessions) {
      for (const itemId of session.candidates.length > 0 ? session.candidates[0].matter ? [] : [] : []) {
        // not used here
      }
    }
    // Sessions map by session id, but we need item → session
    // The session's sourceItemIds are the item ids
    for (const session of sessions) {
      // We need to find the source item ids for this session
      // The resolver doesn't expose sourceItemIds directly on ResolvedSession,
      // but the session id corresponds to the entry id, which has sourceItemIds
    }
    return map;
  }, [sessions]);

  // Build item → session map from the sessions (each session has candidates,
  // and the session id corresponds to an entry that has sourceItemIds)
  // Actually, we need to pass the source item ids through. Let's use the
  // sessions' candidates' matter to build a reverse map.
  const itemToSession = useMemo(() => {
    const map = new Map<string, ResolvedSession>();
    // We need to match sessions to items. The session id is the entry id.
    // The entry has sourceItemIds. We need to pass those through.
    // For now, we'll match by index since sessions are 1:1 with entries.
    return map;
  }, [sessions]);

  // Initialize assignments from sessions
  useEffect(() => {
    const newAssignments = new Map<string, string | null>();
    const newStatus = new Map<string, 'ignored' | 'non-billable' | null>();
    for (const session of sessions) {
      // The session's candidates contain the matter, but we need to know
      // which items belong to this session. We'll use the session id as a key
      // and match it to items later.
      if (session.matterId) {
        // For now, assign all items in the session to the matter
        // We need the sourceItemIds — let's pass them through
      }
    }
    // We'll handle this differently — see below
  }, [sessions]);

  // Build item → session map from the sessions' sourceItemIds
  const itemSessions = useMemo(() => {
    const map = new Map<string, ResolvedSession>();
    for (const session of sessions) {
      for (const itemId of session.sourceItemIds) {
        map.set(itemId, session);
      }
    }
    return map;
  }, [sessions]);

  // Get current assignment for an item
  function getAssignment(itemId: string): string | null {
    // Check manual overrides first
    if (assignments.has(itemId)) return assignments.get(itemId) ?? null;
    // Fall back to resolver result
    const session = itemSessions.get(itemId);
    return session?.matterId ?? null;
  }

  function getStatus(itemId: string): 'ignored' | 'non-billable' | null {
    return status.get(itemId) ?? null;
  }

  // Handle assignment
  function handleAssign(itemId: string, matterId: string) {
    setPrevious((prev) => {
      const next = new Map(prev);
      next.set(itemId, { matterId: getAssignment(itemId), status: getStatus(itemId) });
      return next;
    });
    setAssignments((prev) => {
      const next = new Map(prev);
      next.set(itemId, matterId);
      return next;
    });
    setStatus((prev) => {
      const next = new Map(prev);
      next.set(itemId, null);
      return next;
    });
    setOpenPickerId(null);
    setRuleStripItem(itemId);
    onAssign(itemId, matterId);
  }

  function handleNonBillable(itemId: string) {
    setPrevious((prev) => {
      const next = new Map(prev);
      next.set(itemId, { matterId: getAssignment(itemId), status: getStatus(itemId) });
      return next;
    });
    setAssignments((prev) => {
      const next = new Map(prev);
      next.set(itemId, null);
      return next;
    });
    setStatus((prev) => {
      const next = new Map(prev);
      next.set(itemId, 'non-billable');
      return next;
    });
    setOpenPickerId(null);
    onNonBillable(itemId);
  }

  function handleIgnore(itemId: string) {
    setPrevious((prev) => {
      const next = new Map(prev);
      next.set(itemId, { matterId: getAssignment(itemId), status: getStatus(itemId) });
      return next;
    });
    setStatus((prev) => {
      const next = new Map(prev);
      next.set(itemId, 'ignored');
      return next;
    });
    setAssignments((prev) => {
      const next = new Map(prev);
      next.set(itemId, null);
      return next;
    });
    setOpenPickerId(null);
    onIgnore(itemId);
  }

  function handleUndo(itemId: string) {
    const prev = previous.get(itemId);
    if (!prev) return;
    setAssignments((prevMap) => {
      const next = new Map(prevMap);
      if (prev.matterId !== null) next.set(itemId, prev.matterId);
      else next.delete(itemId);
      return next;
    });
    setStatus((prevMap) => {
      const next = new Map(prevMap);
      if (prev.status !== null) next.set(itemId, prev.status);
      else next.delete(itemId);
      return next;
    });
    setPrevious((prevMap) => {
      const next = new Map(prevMap);
      next.delete(itemId);
      return next;
    });
    onUndo(itemId);
  }

  // Rule creation
  function handleCreateRule(itemId: string, ruleType: MatterRuleType, value: string, matterId: string) {
    onCreateRule({ user_id: '', matter_id: matterId, rule_type: ruleType, value });
    // Apply retroactively
    let retroactiveCount = 0;
    for (const otherItem of items) {
      if (otherItem.id === itemId) continue;
      if (getStatus(otherItem.id) === 'ignored') continue;
      if (matchesRule(otherItem, ruleType, value)) {
        setAssignments((prev) => {
          const next = new Map(prev);
          next.set(otherItem.id, matterId);
          return next;
        });
        setStatus((prev) => {
          const next = new Map(prev);
          next.set(otherItem.id, null);
          return next;
        });
        retroactiveCount++;
      }
    }
    setRuleStripItem(null);
    if (retroactiveCount > 0) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast(`Rule created — ${retroactiveCount} more ${retroactiveCount === 1 ? 'item' : 'items'} assigned.`);
      toastTimer.current = setTimeout(() => setToast(null), 4000);
    }
  }

  // Bulk selection
  function handleBulkClick(itemId: string, e: React.MouseEvent) {
    if (e.shiftKey && lastSelectedId) {
      const startIdx = items.findIndex((i) => i.id === lastSelectedId);
      const endIdx = items.findIndex((i) => i.id === itemId);
      if (startIdx !== -1 && endIdx !== -1) {
        const [from, to] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];
        const range = new Set(bulkSelected);
        for (let i = from; i <= to; i++) range.add(items[i].id);
        setBulkSelected(range);
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      setBulkSelected((prev) => {
        const next = new Set(prev);
        if (next.has(itemId)) next.delete(itemId);
        else next.add(itemId);
        return next;
      });
    } else {
      setBulkSelected(new Set([itemId]));
    }
    setLastSelectedId(itemId);
  }

  function bulkAssign(matterId: string) {
    for (const id of bulkSelected) {
      handleAssign(id, matterId);
    }
    setBulkSelected(new Set());
  }

  function bulkNonBillable() {
    for (const id of bulkSelected) handleNonBillable(id);
    setBulkSelected(new Set());
  }

  function bulkIgnore() {
    for (const id of bulkSelected) handleIgnore(id);
    setBulkSelected(new Set());
  }

  // Keyboard navigation
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (openPickerId) return; // picker handles its own keys
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        setFocusedIndex((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[focusedIndex];
        if (item) setOpenPickerId(item.id);
      } else if (e.key === 'u') {
        e.preventDefault();
        const item = items[focusedIndex];
        if (item) handleUndo(item.id);
      } else if (e.key === 'Escape') {
        setBulkSelected(new Set());
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openPickerId, focusedIndex, items]);

  // Scroll focused item into view
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const child = container.children[focusedIndex] as HTMLElement | undefined;
    if (child) child.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  // Auto-cluster: group unassigned items by sender or channel
  const clusters = useMemo(() => {
    const unassignedItems = items.filter((i) => {
      const s = getStatus(i.id);
      return s !== 'ignored' && s !== 'non-billable' && getAssignment(i.id) === null;
    });
    const bySender = new Map<string, ActivityItem[]>();
    const byChannel = new Map<string, ActivityItem[]>();
    for (const item of unassignedItems) {
      if (item.meta.sender) {
        const key = item.meta.sender;
        const list = bySender.get(key) ?? [];
        list.push(item);
        bySender.set(key, list);
      }
      if (item.meta.channel) {
        const key = item.meta.channel;
        const list = byChannel.get(key) ?? [];
        list.push(item);
        byChannel.set(key, list);
      }
    }
    const clusters: { key: string; label: string; items: ActivityItem[] }[] = [];
    for (const [sender, groupItems] of bySender) {
      if (groupItems.length >= 4) {
        clusters.push({ key: `sender:${sender}`, label: sender, items: groupItems });
      }
    }
    for (const [channel, groupItems] of byChannel) {
      if (groupItems.length >= 4) {
        clusters.push({ key: `channel:${channel}`, label: `#${channel}`, items: groupItems });
      }
    }
    return clusters;
  }, [items, assignments, status]);

  const matterColorMap = useMemo(() => {
    const map = new Map<string, string>();
    matters.forEach((m, i) => {
      map.set(m.id, MATTER_PALETTE[i % MATTER_PALETTE.length]);
    });
    return map;
  }, [matters]);

  const unassignedItems = items.filter((i) => {
    const s = getStatus(i.id);
    return s !== 'ignored' && s !== 'non-billable' && getAssignment(i.id) === null;
  });
  const assignedItems = items.filter((i) => {
    const s = getStatus(i.id);
    return s !== 'ignored' && s !== 'non-billable' && getAssignment(i.id) !== null;
  });
  const ignoredItems = items.filter((i) => getStatus(i.id) === 'ignored');
  const nonBillableItems = items.filter((i) => getStatus(i.id) === 'non-billable');

  // Group email items by threadId for stack rendering
  function groupItemsForRender(list: ActivityItem[]): RenderUnit[] {
    const threadMap = new Map<string, ActivityItem[]>();
    for (const item of list) {
      if (item.provider === 'email' && item.meta.threadId) {
        const tid = item.meta.threadId;
        const arr = threadMap.get(tid) ?? [];
        arr.push(item);
        threadMap.set(tid, arr);
      }
    }
    for (const [, arr] of threadMap) {
      arr.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }
    const seen = new Set<string>();
    const units: RenderUnit[] = [];
    for (const item of list) {
      if (item.provider === 'email' && item.meta.threadId) {
        const tid = item.meta.threadId;
        if (seen.has(tid)) continue;
        seen.add(tid);
        const threadItems = threadMap.get(tid)!;
        if (threadItems.length > 1) {
          units.push({ type: 'thread', threadId: tid, items: threadItems });
        } else {
          units.push({ type: 'single', item });
        }
      } else {
        units.push({ type: 'single', item });
      }
    }
    return units;
  }

  const unassignedCount = unassignedItems.length;
  const assignedCount = assignedItems.length;
  const ignoredCount = ignoredItems.length;
  const nonBillableCount = nonBillableItems.length;

  function renderItemRow(item: ActivityItem, idx: number) {
    const session = itemSessions.get(item.id);
    const matterId = getAssignment(item.id);
    const itemStatus = getStatus(item.id);
    const matter = matterId ? matters.find((m) => m.id === matterId) ?? null : null;
    const isFocused = idx === focusedIndex;
    const isBulkSelected = bulkSelected.has(item.id);
    const isIgnored = itemStatus === 'ignored';
    const isNonBillable = itemStatus === 'non-billable';

    if (isIgnored) {
      return (
        <div
          key={item.id}
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-400 ${
            isFocused ? 'ring-1 ring-stone-300' : ''
          }`}
          onClick={(e) => handleBulkClick(item.id, e)}
        >
          <X size={12} />
          <span className="line-through">{item.summary}</span>
          <button
            onClick={(e) => { e.stopPropagation(); handleUndo(item.id); }}
            className="ml-auto text-xs text-stone-400 underline hover:text-stone-600"
          >
            undo
          </button>
        </div>
      );
    }

    return (
      <div key={item.id} className="relative">
        <div
          className={`flex items-center gap-2 rounded-md border px-3 py-2 transition-colors ${
            isBulkSelected
              ? 'border-accent-300 bg-accent-50'
              : isFocused
              ? 'border-stone-300 bg-stone-50'
              : 'border-stone-200 bg-white hover:border-stone-300'
          } ${isNonBillable ? 'opacity-60' : ''}`}
          onClick={(e) => handleBulkClick(item.id, e)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/daykeeper-item', item.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: PROVIDER_DOT_COLORS[item.provider] }}
          />
          {item.provider === 'email' && (
            item.meta.direction === 'outgoing'
              ? <ArrowUpRight size={13} className="shrink-0 text-blue-500" title="Sent" />
              : <ArrowDownLeft size={13} className="shrink-0 text-emerald-500" title="Received" />
          )}
          {item.provider === 'email' && item.meta.threadId && (() => {
            const threadCount = items.filter(
              (i) => i.provider === 'email' && i.meta.threadId === item.meta.threadId,
            ).length;
            if (threadCount <= 1) return null;
            return (
              <span
                className="flex shrink-0 items-center gap-0.5 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500"
                title={`${threadCount} emails in this thread`}
              >
                <Mail size={9} />
                {threadCount}
              </span>
            );
          })()}
          <span className="font-mono text-xs text-stone-400">
            {formatTime(item.timestamp, timezone)}
          </span>
          {item.meta.url ? (
            <a
              href={item.meta.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={`flex-1 truncate text-sm hover:underline hover:text-accent-700 ${isNonBillable ? 'text-stone-500' : 'text-stone-700'}`}
            >
              {item.summary}
            </a>
          ) : (
            <span className={`flex-1 truncate text-sm ${isNonBillable ? 'text-stone-500' : 'text-stone-700'}`}>
              {item.summary}
            </span>
          )}
          {item.provider === 'browser' && (() => {
            const browserMeta = getBrowserItemMeta(item);
            const slotCount = browserMeta?.slotCount ?? 1;
            const isExpanded = expandedBrowser.has(item.id);
            const canExpand = slotCount > 1;
            return (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!canExpand) return;
                  setExpandedBrowser((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  });
                }}
                className={`flex shrink-0 items-center gap-1 rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 ${canExpand ? 'cursor-pointer hover:bg-teal-100' : 'cursor-default'}`}
                title={canExpand ? `${slotCount} time slots — click to ${isExpanded ? 'collapse' : 'expand'}` : 'Browser activity'}
              >
                <Globe size={9} />
                {canExpand ? (
                  <>
                    {slotCount} slots
                    <ChevronDown size={9} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </>
                ) : (
                  'Browser'
                )}
              </button>
            );
          })()}
          {item.durationMinutes && (
            <span className="flex shrink-0 items-center gap-1 text-xs text-stone-500">
              {item.provider === 'browser' && <Clock size={10} className="text-teal-500" />}
              {formatMinutes(item.durationMinutes)}
            </span>
          )}
          {matter ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpenPickerId(openPickerId === item.id ? null : item.id);
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-stone-200 px-2 py-0.5 text-xs transition-colors hover:border-stone-300"
              style={{
                borderBottomColor: session?.confidence === 'medium' ? '#f59e0b' : undefined,
                borderBottomWidth: session?.confidence === 'medium' ? 2 : 1,
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: matterColorMap.get(matter.id) ?? UNASSIGNED_COLOR }}
              />
              <span className="font-mono text-stone-600">
                {matter.case_id_visible ?? matter.name}
              </span>
            </button>
          ) : isNonBillable ? (
            <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
              Non-billable
            </span>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleIgnore(item.id);
              }}
              className="shrink-0 rounded-full border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-400 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-600"
              title="Ignore this item"
            >
              <EyeOff size={12} />
            </button>
          )}
          {(assignments.has(item.id) || status.has(item.id)) && (
            <button
              onClick={(e) => { e.stopPropagation(); handleUndo(item.id); }}
              className="shrink-0 text-xs text-stone-400 underline hover:text-stone-600"
            >
              undo
            </button>
          )}
        </div>
        {openPickerId === item.id && (
          <div className="absolute right-0 top-full z-50 mt-1">
            <MatterPicker
              anchorId={item.id}
              candidates={session?.candidates ?? []}
              matters={matters}
              clients={clients}
              recentMatterIds={recentMatterIds}
              currentMatterId={matterId}
              onAssign={(mid) => handleAssign(item.id, mid)}
              onNonBillable={() => handleNonBillable(item.id)}
              onIgnore={() => handleIgnore(item.id)}
              onClose={() => setOpenPickerId(null)}
              onCreateRule={(rule) => handleCreateRule(item.id, rule.rule_type, rule.value, rule.matter_id)}
            />
          </div>
        )}
        {item.provider === 'browser' && expandedBrowser.has(item.id) && (() => {
          const browserMeta = getBrowserItemMeta(item);
          if (!browserMeta || browserMeta.slots.length <= 1) return null;
          return (
            <div className="mt-1 ml-6 rounded-md border border-teal-100 bg-teal-50/40 px-3 py-2">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-teal-600">
                <Clock size={10} />
                {browserMeta.slots.length} time slots on {browserMeta.domain}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {browserMeta.slots.map((slot, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] text-stone-600 ring-1 ring-teal-100"
                  >
                    <span className="font-mono text-stone-500">
                      {formatTime(slot.time, timezone)}
                    </span>
                    <span className="text-teal-600">
                      {formatMinutes(Math.max(1, Math.round(slot.duration_s / 60)))}
                    </span>
                  </span>
                ))}
              </div>
              {browserMeta.hints.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {browserMeta.hints.map((h, i) => (
                    <span key={i} className="rounded bg-teal-100/60 px-1.5 py-0.5 text-[10px] text-teal-700">
                      {h}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
        {ruleStripItem === item.id && matter && (
          <RuleStrip
            item={item}
            matter={matter}
            onCreateRule={(ruleType, value) => handleCreateRule(item.id, ruleType, value, matter.id)}
            onDismiss={() => setRuleStripItem(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Auto-clusters */}
      {clusters.map((cluster) => (
        <ClusterGroup
          key={cluster.key}
          label={cluster.label}
          items={cluster.items}
          matters={matters}
          onAssignAll={(matterId) => {
            for (const item of cluster.items) handleAssign(item.id, matterId);
          }}
          onNonBillableAll={() => {
            for (const item of cluster.items) handleNonBillable(item.id);
          }}
          onIgnoreAll={() => {
            for (const item of cluster.items) handleIgnore(item.id);
          }}
        />
      ))}

      {/* Needs assignment section */}
      {unassignedCount > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-700">
              {unassignedCount}
            </span>
            <h3 className="text-sm font-semibold text-stone-700">Needs assignment</h3>
          </div>
          <div ref={containerRef} className="space-y-1">
            {groupItemsForRender(unassignedItems).map((unit) => {
              if (unit.type === 'thread') {
                return (
                  <ThreadStack
                    key={`thread-${unit.threadId}`}
                    threadId={unit.threadId}
                    threadItems={unit.items}
                    expanded={expandedThreads.has(unit.threadId)}
                    onToggle={() => {
                      setExpandedThreads((prev) => {
                        const next = new Set(prev);
                        if (next.has(unit.threadId)) next.delete(unit.threadId);
                        else next.add(unit.threadId);
                        return next;
                      });
                    }}
                    renderItem={(item) => renderItemRow(item, items.indexOf(item))}
                    timezone={timezone}
                  />
                );
              }
              return renderItemRow(unit.item, items.indexOf(unit.item));
            })}
          </div>
        </div>
      )}

      {/* Already assigned section */}
      {assignedCount > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-[11px] font-bold text-green-700">
              {assignedCount}
            </span>
            <h3 className="text-sm font-semibold text-stone-700">Already assigned</h3>
            {unassignedCount === 0 && ignoredCount === 0 && nonBillableCount === 0 && (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircle2 size={12} /> All done
              </span>
            )}
          </div>
          <div className="space-y-1">
            {groupItemsForRender(assignedItems).map((unit) => {
              if (unit.type === 'thread') {
                return (
                  <ThreadStack
                    key={`thread-${unit.threadId}`}
                    threadId={unit.threadId}
                    threadItems={unit.items}
                    expanded={expandedThreads.has(unit.threadId)}
                    onToggle={() => {
                      setExpandedThreads((prev) => {
                        const next = new Set(prev);
                        if (next.has(unit.threadId)) next.delete(unit.threadId);
                        else next.add(unit.threadId);
                        return next;
                      });
                    }}
                    renderItem={(item) => renderItemRow(item, items.indexOf(item))}
                    timezone={timezone}
                  />
                );
              }
              return renderItemRow(unit.item, items.indexOf(unit.item));
            })}
          </div>
        </div>
      )}

      {/* Non-billable section */}
      {nonBillableCount > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-200 text-[11px] font-bold text-stone-600">
              {nonBillableCount}
            </span>
            <h3 className="text-sm font-semibold text-stone-600">Non-billable</h3>
          </div>
          <div className="space-y-1">
            {groupItemsForRender(nonBillableItems).map((unit) => {
              if (unit.type === 'thread') {
                return (
                  <ThreadStack
                    key={`thread-${unit.threadId}`}
                    threadId={unit.threadId}
                    threadItems={unit.items}
                    expanded={expandedThreads.has(unit.threadId)}
                    onToggle={() => {
                      setExpandedThreads((prev) => {
                        const next = new Set(prev);
                        if (next.has(unit.threadId)) next.delete(unit.threadId);
                        else next.add(unit.threadId);
                        return next;
                      });
                    }}
                    renderItem={(item) => renderItemRow(item, items.indexOf(item))}
                    timezone={timezone}
                  />
                );
              }
              return renderItemRow(unit.item, items.indexOf(unit.item));
            })}
          </div>
        </div>
      )}

      {/* Ignored section */}
      {ignoredCount > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-100 text-[11px] font-bold text-stone-400">
              {ignoredCount}
            </span>
            <h3 className="text-sm font-semibold text-stone-400">Ignored</h3>
          </div>
          <div className="space-y-1">
            {groupItemsForRender(ignoredItems).map((unit) => {
              if (unit.type === 'thread') {
                return (
                  <ThreadStack
                    key={`thread-${unit.threadId}`}
                    threadId={unit.threadId}
                    threadItems={unit.items}
                    expanded={expandedThreads.has(unit.threadId)}
                    onToggle={() => {
                      setExpandedThreads((prev) => {
                        const next = new Set(prev);
                        if (next.has(unit.threadId)) next.delete(unit.threadId);
                        else next.add(unit.threadId);
                        return next;
                      });
                    }}
                    renderItem={(item) => renderItemRow(item, items.indexOf(item))}
                    timezone={timezone}
                  />
                );
              }
              return renderItemRow(unit.item, items.indexOf(unit.item));
            })}
          </div>
        </div>
      )}

      {/* Floating bulk action bar */}
      {bulkSelected.size > 1 && (
        <div className="sticky bottom-0 left-0 right-0 z-40 mt-2 flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2.5 shadow-lg">
          <span className="text-sm font-medium text-stone-700">
            {bulkSelected.size} items selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            <BulkAssignButton
              matters={matters}
              onAssign={bulkAssign}
            />
            <button
              onClick={bulkNonBillable}
              className="btn-secondary text-sm"
            >
              <FolderOpen size={14} /> Mark non-billable
            </button>
            <button
              onClick={bulkIgnore}
              className="btn-secondary text-sm"
            >
              <X size={14} /> Ignore
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-stone-800 px-4 py-2 text-sm text-white shadow-xl">
          <div className="flex items-center gap-2">
            <Sparkles size={14} />
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Rule creation strip ---

function RuleStrip({
  item,
  matter,
  onCreateRule,
  onDismiss,
}: {
  item: ActivityItem;
  matter: Matter;
  onCreateRule: (ruleType: MatterRuleType, value: string) => void;
  onDismiss: () => void;
}) {
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [showCustomTag, setShowCustomTag] = useState(false);
  const [customTag, setCustomTag] = useState('');

  const suggestions = useMemo(() => {
    const list: { ruleType: MatterRuleType; value: string; label: string }[] = [];
    const ref = matter.case_id_visible ?? matter.name;

    if (item.meta.sender) {
      const domain = item.meta.sender.split('@')[1];
      if (domain && !GENERIC_EMAIL_DOMAINS.has(domain)) {
        list.push({
          ruleType: 'email_domain',
          value: domain,
          label: `Always assign mail from @${domain} to ${ref}`,
        });
      }
      list.push({
        ruleType: 'email_address',
        value: item.meta.sender,
        label: `Always assign mail from ${item.meta.sender} to ${ref}`,
      });
    }

    if (item.meta.channel) {
      list.push({
        ruleType: 'chat_channel',
        value: item.meta.channel,
        label: `Always assign the #${item.meta.channel} channel to ${ref}`,
      });
    }

    if (item.meta.fileName) {
      const parts = item.meta.fileName.split('/');
      if (parts.length > 1) {
        const prefix = parts.slice(0, -1).join('/') + '/';
        list.push({
          ruleType: 'file_path_prefix',
          value: prefix,
          label: `Always assign files in ${prefix} to ${ref}`,
        });
      }
    }

    if (item.meta.ticketKey) {
      const prefix = item.meta.ticketKey.replace(/\d+$/, '*');
      list.push({
        ruleType: 'task_project',
        value: prefix,
        label: `Always assign ${prefix} tickets to ${ref}`,
      });
    }

    // Sort by specificity (most specific first), limit to 2
    return list.slice(0, 2);
  }, [item, matter]);

  const visibleSuggestions = suggestions.filter(
    (s) => !dismissedKeys.has(`${s.ruleType}:${s.value}`),
  );

  return (
    <div className="mt-1 rounded-md bg-accent-50 px-3 py-1.5">
      <div className="flex items-center gap-2">
        <Tag size={12} className="shrink-0 text-accent-500" />
        <div className="flex flex-wrap items-center gap-1.5">
          {visibleSuggestions.map((s) => {
            const key = `${s.ruleType}:${s.value}`;
            return (
              <span key={key} className="flex items-center gap-0.5 rounded-full border border-accent-200 bg-white pl-2.5 pr-1 py-0.5 text-xs text-accent-700 transition-colors hover:bg-accent-100">
                <button onClick={() => onCreateRule(s.ruleType, s.value)}>
                  {s.label}
                </button>
                <button
                  onClick={() => {
                    const next = new Set(dismissedKeys);
                    next.add(key);
                    setDismissedKeys(next);
                    if (next.size === suggestions.length && !showCustomTag) onDismiss();
                  }}
                  className="ml-0.5 rounded-full p-0.5 text-stone-400 hover:bg-stone-200 hover:text-stone-600"
                  title="Dismiss this suggestion"
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}
          {/* Custom keyword tag input */}
          {showCustomTag ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const tag = customTag.trim();
                if (tag) {
                  onCreateRule('keyword', tag);
                  setCustomTag('');
                  setShowCustomTag(false);
                }
              }}
              className="flex items-center gap-1"
            >
              <span className="flex items-center gap-0.5 rounded-full border border-accent-300 bg-white pl-2 pr-1 py-0.5 text-xs">
                <Tag size={10} className="text-accent-500" />
                <input
                  type="text"
                  value={customTag}
                  onChange={(e) => setCustomTag(e.target.value)}
                  placeholder="keyword…"
                  className="w-20 bg-transparent text-xs text-accent-700 outline-none placeholder:text-stone-400"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setShowCustomTag(false); setCustomTag(''); }
                  }}
                />
                <button
                  type="submit"
                  className="rounded-full p-0.5 text-accent-600 hover:bg-accent-100"
                  title="Create keyword rule"
                >
                  <Check size={11} />
                </button>
              </span>
            </form>
          ) : (
            <button
              onClick={() => setShowCustomTag(true)}
              className="flex items-center gap-1 rounded-full border border-dashed border-accent-300 px-2 py-0.5 text-xs text-accent-600 transition-colors hover:bg-accent-100"
            >
              <Plus size={10} />
              Custom tag
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Cluster group ---

function ClusterGroup({
  label,
  items,
  matters,
  onAssignAll,
  onNonBillableAll,
  onIgnoreAll,
}: {
  label: string;
  items: ActivityItem[];
  matters: Matter[];
  onAssignAll: (matterId: string) => void;
  onNonBillableAll: () => void;
  onIgnoreAll: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showAssignMenu, setShowAssignMenu] = useState(false);

  return (
    <div className="mb-2 rounded-lg border border-stone-200 bg-stone-50">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 px-3 py-2"
      >
        {collapsed ? <ChevronRight size={14} className="text-stone-400" /> : <ChevronDown size={14} className="text-stone-400" />}
        <Layers size={14} className="text-stone-400" />
        <span className="text-sm font-medium text-stone-600">{label}</span>
        <span className="text-xs text-stone-400">
          {items.length} items
        </span>
        <div className="ml-auto flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <div className="relative">
            <button
              onClick={() => setShowAssignMenu(!showAssignMenu)}
              className="rounded-md bg-accent-100 px-2 py-1 text-xs font-medium text-accent-700 hover:bg-accent-200"
            >
              Assign all {items.length}
            </button>
            {showAssignMenu && (
              <div className="absolute right-0 top-full z-50 mt-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-lg">
                {matters.filter((m) => m.state_is_open).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { onAssignAll(m.id); setShowAssignMenu(false); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-stone-50"
                  >
                    {m.case_id_visible && (
                      <span className="font-mono text-xs text-stone-500">{m.case_id_visible}</span>
                    )}
                    <span className="truncate text-stone-700">{m.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onNonBillableAll}
            className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-600 hover:bg-stone-200"
          >
            Non-billable
          </button>
          <button
            onClick={onIgnoreAll}
            className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-600 hover:bg-stone-200"
          >
            Ignore
          </button>
        </div>
      </button>
      {!collapsed && (
        <div className="border-t border-stone-200 px-3 py-1.5">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2 py-0.5 text-xs text-stone-500">
              <span className="font-mono">{formatTime(item.timestamp, timezone)}</span>
              <span className="truncate">{item.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Bulk assign button ---

function BulkAssignButton({
  matters,
  onAssign,
}: {
  matters: Matter[];
  onAssign: (matterId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="btn-primary text-sm"
      >
        Assign to…
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-lg">
          {matters.filter((m) => m.state_is_open).map((m) => (
            <button
              key={m.id}
              onClick={() => { onAssign(m.id); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-stone-50"
            >
              {m.case_id_visible && (
                <span className="font-mono text-xs text-stone-500">{m.case_id_visible}</span>
              )}
              <span className="truncate text-stone-700">{m.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Helpers ---

function matchesRule(item: ActivityItem, ruleType: MatterRuleType, value: string): boolean {
  const v = value.toLowerCase();
  switch (ruleType) {
    case 'email_address':
      return item.meta.sender?.toLowerCase() === v || item.meta.recipient?.toLowerCase() === v;
    case 'email_domain': {
      const senderDomain = item.meta.sender?.split('@')[1]?.toLowerCase();
      const recipientDomain = item.meta.recipient?.split('@')[1]?.toLowerCase();
      return senderDomain === v || recipientDomain === v;
    }
    case 'chat_channel':
      return item.meta.channel?.toLowerCase() === v;
    case 'file_path_prefix':
      return item.meta.fileName?.toLowerCase().startsWith(v) ?? false;
    case 'task_project': {
      const prefix = value.replace(/\*$/, '');
      return item.meta.ticketKey?.toLowerCase().startsWith(prefix.toLowerCase()) ?? false;
    }
    case 'calendar_series':
      return item.meta.title?.toLowerCase().includes(v) ?? false;
    case 'keyword':
      return item.meta.subject?.toLowerCase().includes(v) ?? false;
    default:
      return false;
  }
}

// --- Thread stack ---

type RenderUnit =
  | { type: 'single'; item: ActivityItem }
  | { type: 'thread'; threadId: string; items: ActivityItem[] };

function ThreadStack({
  threadId,
  threadItems,
  expanded,
  onToggle,
  renderItem,
  timezone,
}: {
  threadId: string;
  threadItems: ActivityItem[];
  expanded: boolean;
  onToggle: () => void;
  renderItem: (item: ActivityItem) => React.ReactNode;
  timezone: string;
}) {
  const count = threadItems.length;
  const latest = threadItems[0];
  const earliest = threadItems[count - 1];
  const totalDuration = threadItems.reduce((sum, item) => {
    if (item.endTimestamp) {
      return sum + Math.max(1, Math.round((new Date(item.endTimestamp).getTime() - new Date(item.timestamp).getTime()) / 60000));
    }
    return sum + (item.durationMinutes ?? 5);
  }, 0);

  const maxStack = Math.min(count, 4);

  return (
    <div className="relative">
      {/* Collapsed: stacked rows with offset — actual content peeks through */}
      {!expanded && count > 1 && (
        <div className="pointer-events-none absolute inset-0">
          {Array.from({ length: maxStack - 1 }).map((_, i) => {
            const layerIdx = maxStack - 2 - i; // back-to-front
            const item = threadItems[layerIdx + 1]; // skip latest (top card)
            if (!item) return null;
            const offset = (maxStack - 1 - layerIdx) * 4;
            return (
              <div
                key={i}
                className="absolute left-0 right-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-50"
                style={{
                  top: `${offset}px`,
                  zIndex: 0,
                  opacity: 0.5 - i * 0.1,
                }}
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <Mail size={12} className="shrink-0 text-stone-300" />
                  <div className="w-24 shrink-0 font-mono text-xs text-stone-400">
                    {formatTime(item.timestamp, timezone)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-stone-400">{item.summary}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        className={`relative rounded-lg border bg-white shadow-sm transition-all duration-300 ${expanded ? 'border-accent-300 shadow-md' : 'border-stone-200 hover:border-stone-300'}`}
        style={{ zIndex: 1 }}
      >
        {/* Thread header — clickable to expand/collapse */}
        <button
          onClick={onToggle}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
        >
          <div className="flex shrink-0 items-center gap-1">
            <Mail size={12} className="text-stone-400" />
            {latest.meta.direction === 'outgoing' ? (
              <ArrowUpRight size={12} className="text-blue-500" />
            ) : (
              <ArrowDownLeft size={12} className="text-emerald-500" />
            )}
          </div>
          <div className="w-24 shrink-0 font-mono text-xs text-stone-500">
            {formatTime(earliest.timestamp, timezone)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-stone-800">{latest.summary}</p>
            <p className="truncate text-xs text-stone-400">
              {latest.meta.direction === 'outgoing' ? `to ${latest.meta.recipient ?? ''}` : `from ${latest.meta.sender ?? ''}`}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
            <Layers size={9} />
            {count} {count === 1 ? 'email' : 'emails'}
          </span>
          <span className="shrink-0 text-xs text-stone-500">{formatMinutes(totalDuration)}</span>
          <div className="shrink-0 text-stone-400">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </button>

        {/* Expanded: accordion of all thread items */}
        {expanded && (
          <div className="border-t border-stone-100">
            <div className="space-y-0.5 px-2 py-1.5">
              {threadItems.map((item, i) => (
                <div
                  key={item.id}
                  className="animate-fade-in"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  {renderItem(item)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
