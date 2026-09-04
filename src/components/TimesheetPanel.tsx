import { useState, useMemo, useEffect, useRef } from 'react';
import type { DragEvent } from 'react';
import type { ActivityItem, DraftTimesheetEntry, Matter } from '@/types';
import type { EstimateResult } from '@/lib/estimator';
import { formatMinutes, formatHours } from '@/lib/time';
import {
  Briefcase,
  Clock,
  Save,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  FileDown,
  ChevronDown,
  ChevronRight,
  Maximize2,
  X,
  FileText,
  Globe,
  CalendarDays,
  MousePointer2,
  FolderOpen,
} from 'lucide-react';

interface TimesheetPanelProps {
  entries: DraftTimesheetEntry[];
  items: ActivityItem[];
  onEntriesChange: (entries: DraftTimesheetEntry[]) => void;
  matters: Matter[];
  estimate: EstimateResult | null;
  targetHours: number;
  existingRecordedMinutes: number;
  generating: boolean;
  generationErrors: string[];
  saving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  onSave: (entries: DraftTimesheetEntry[]) => void;
  onRegenerate: () => void;
  onDropSignal: (itemId: string, matterId: string) => void;
  onDropToEmpty?: (itemId: string) => void;
  onDropMatter?: (matterId: string) => void;
  onHoverEntry?: (itemIds: string[] | null) => void;
  hasAssignedSessions: boolean;
  lastDropMatterId: string | null;
}

const MATTER_PALETTE = [
  '#2563eb', '#dc2626', '#059669', '#ea580c',
  '#7c3aed', '#0891b2', '#db2777', '#ca8a04',
  '#4f46e5', '#16a34a', '#e11d48', '#0d9488',
];

export function TimesheetPanel({
  entries,
  items,
  onEntriesChange,
  matters,
  estimate,
  targetHours,
  existingRecordedMinutes,
  generating,
  generationErrors,
  saving,
  saveError,
  saveSuccess,
  onSave,
  onRegenerate,
  onDropSignal,
  onDropToEmpty,
  onDropMatter,
  onHoverEntry,
  hasAssignedSessions,
  lastDropMatterId,
}: TimesheetPanelProps) {
  const [collapsedMatters, setCollapsedMatters] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dropFlash, setDropFlash] = useState<string | null>(null);
  const [emptyDropActive, setEmptyDropActive] = useState(false);
  const [matterDropActive, setMatterDropActive] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [signalContexts, setSignalContexts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (lastDropMatterId) {
      setDropFlash(lastDropMatterId);
      const t = setTimeout(() => setDropFlash(null), 1200);
      return () => clearTimeout(t);
    }
  }, [lastDropMatterId]);

  const matterColorMap = useMemo(() => {
    const map = new Map<string, string>();
    matters.forEach((m, i) => map.set(m.id, MATTER_PALETTE[i % MATTER_PALETTE.length]));
    return map;
  }, [matters]);

  const matterGroups = useMemo(() => {
    const groups = new Map<string, DraftTimesheetEntry[]>();
    for (const entry of entries) {
      const key = entry.matterId ?? '__unassigned';
      const list = groups.get(key) ?? [];
      list.push(entry);
      groups.set(key, list);
    }
    return groups;
  }, [entries]);

  const totalMinutes = entries.reduce((s, e) => s + e.confirmedMinutes, 0);
  const totalBillableMinutes = entries
    .filter((e) => e.billable)
    .reduce((s, e) => s + e.confirmedMinutes, 0);
  const targetMinutes = targetHours * 60;
  const progressPct = Math.min(100, (totalBillableMinutes / targetMinutes) * 100);
  const barColor =
    totalBillableMinutes > 24 * 60
      ? '#dc2626'
      : totalBillableMinutes < targetMinutes
        ? '#f59e0b'
        : '#0d9488';

  function toggleMatter(key: string) {
    setCollapsedMatters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function updateEntry(id: string, patch: Partial<DraftTimesheetEntry>) {
    onEntriesChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function handleMatterDrop(event: DragEvent<HTMLDivElement>, matterId: string) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = event.dataTransfer.getData('text/daykeeper-item');
    setDropTarget(null);
    if (itemId) onDropSignal(itemId, matterId);
  }

  function handleWholeMatterDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const matterId = event.dataTransfer.getData('text/daykeeper-matter');
    setMatterDropActive(false);
    if (matterId && onDropMatter) onDropMatter(matterId);
  }

  function copyAll() {
    const text = entries
      .map((e, i) => `${i + 1}. ${formatMinutes(e.confirmedMinutes)} — ${e.activityType ?? 'General'}\n   ${e.description}`)
      .join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [entries.length]);

  return (
    <div className="relative flex h-full flex-col overflow-visible rounded-2xl border border-stone-200/80 bg-white shadow-xl shadow-stone-300/30">
      {/* Header */}
      <div className="shrink-0 border-b border-stone-200 bg-gradient-to-b from-stone-50 to-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-100">
              <Sparkles size={15} className="text-accent-700" />
            </div>
            <div>
              <button
                onClick={() => entries.length > 0 && setInspectorOpen(true)}
                disabled={entries.length === 0}
                className="text-left transition-colors hover:text-accent-700 disabled:cursor-default"
                title="Open detailed timesheet editor"
              >
                <h3 className="text-sm font-semibold text-stone-800">Timesheet Preview</h3>
              <p className="text-[11px] text-stone-400">
                {hasAssignedSessions
                  ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · ${formatMinutes(totalMinutes)}`
                  : 'Assign matters to generate'}
                </p>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => entries.length > 0 && setInspectorOpen(true)}
              disabled={entries.length === 0}
              className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-accent-700 disabled:opacity-30"
              title="Open detailed editor"
            >
              <Maximize2 size={14} />
            </button>
            <button
              onClick={copyAll}
              disabled={entries.length === 0}
              className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
              title="Copy as text"
            >
              <FileDown size={14} />
            </button>
            <button
              onClick={onRegenerate}
              disabled={generating || !hasAssignedSessions}
              className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
              title="Regenerate"
            >
              <RefreshCw size={14} className={generating ? 'animate-spin-slow' : ''} />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {entries.length > 0 && (
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-[11px] text-stone-500">
              <span>{formatMinutes(totalBillableMinutes)} of {formatHours(targetMinutes)}</span>
              <span>{Math.round(progressPct)}%</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPct}%`, backgroundColor: barColor }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {generating && <GeneratingMessage />}
        {generationErrors.length > 0 ? (
          <div className="space-y-2">
            {generationErrors.map((err, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{err}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {Array.from(matterGroups.entries()).map(([matterKey, groupEntries]) => {
              const matter = matters.find((m) => m.id === matterKey);
              const color = matter ? matterColorMap.get(matter.id) ?? '#78716c' : '#d97706';
              const collapsed = collapsedMatters.has(matterKey);
              const groupMinutes = groupEntries.reduce((s, e) => s + e.confirmedMinutes, 0);

              const isCardGenerating = generating && lastDropMatterId === matterKey;
              const isDropFlash = dropFlash === matterKey && !isCardGenerating;

              return (
                <div
                  key={matterKey}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDragEnter={() => matter && setDropTarget(matter.id)}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDropTarget(null);
                    }
                  }}
                  onDrop={(event) => matter && handleMatterDrop(event, matter.id)}
                  className={`overflow-hidden rounded-xl border shadow-sm transition-all duration-200 hover-lift ${
                    dropTarget === matter?.id
                      ? 'border-accent-300 bg-accent-50/50 ring-2 ring-inset ring-accent-300'
                      : isDropFlash
                        ? 'border-accent-200 bg-accent-50/30 drop-pulse'
                        : 'border-stone-200 bg-white'
                  }`}
                  style={{ animation: 'fadeInUp 0.3s ease-out both' }}
                >
                  {/* Matter header */}
                  <button
                    onClick={() => toggleMatter(matterKey)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors"
                  >
                    {collapsed ? <ChevronRight size={14} className="text-stone-400 transition-transform duration-200" /> : <ChevronDown size={14} className="text-stone-400 transition-transform duration-200" />}
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full transition-transform duration-200" style={{ backgroundColor: color }} />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-stone-800">
                        {matter?.case_id_visible ?? matter?.name ?? 'Unassigned'}
                      </span>
                      {matter && (
                        <span className="block truncate text-[11px] text-stone-400">{matter.name}</span>
                      )}
                    </div>
                    {isCardGenerating && (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-accent-700">
                        <Loader2 size={12} className="animate-spin-slow" />
                        Generating
                      </span>
                    )}
                    <span className="shrink-0 text-xs font-medium text-stone-600">
                      {formatMinutes(groupMinutes)}
                    </span>
                  </button>

                  {/* Entries */}
                  {!collapsed && (
                    <div className="divide-y divide-stone-100 border-t border-stone-100">
                      {groupEntries.map((entry, i) => (
                        <div
                          key={entry.id}
                          style={{ animation: `fadeInUp 0.3s ease-out ${i * 60}ms both` }}
                          onMouseEnter={() => onHoverEntry?.(entry.sourceItemIds ?? null)}
                          onMouseLeave={() => onHoverEntry?.(null)}
                        >
                          <EntryRow
                            entry={entry}
                            color={color}
                            onUpdate={(patch) => updateEntry(entry.id, patch)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Drop zone for dragging a whole case into the timesheet */}
        {onDropMatter && !generating && (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              if (!matterDropActive) setMatterDropActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setMatterDropActive(false);
              }
            }}
            onDrop={handleWholeMatterDrop}
            className={`mb-2 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-2.5 text-center transition-all duration-200 ${
              matterDropActive
                ? 'border-accent-400 bg-accent-50/60 scale-[1.01]'
                : 'border-stone-200 bg-stone-50/40'
            }`}
          >
            <FolderOpen size={15} className={matterDropActive ? 'text-accent-600' : 'text-stone-300'} />
            <p className={`text-xs ${matterDropActive ? 'text-accent-700' : 'text-stone-400'}`}>
              {matterDropActive ? 'Drop case to generate timesheet' : 'Drag a case here to add all its signals'}
            </p>
          </div>
        )}

        {/* Persistent drop zone for unassigned signals */}
        {!generating && generationErrors.length === 0 && (
          <div
            onDragOver={(event) => {
              if (!onDropToEmpty) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDragEnter={() => onDropToEmpty && setEmptyDropActive(true)}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setEmptyDropActive(false);
              }
            }}
            onDrop={(event) => {
              if (!onDropToEmpty) return;
              event.preventDefault();
              const itemId = event.dataTransfer.getData('text/daykeeper-item');
              setEmptyDropActive(false);
              if (itemId) onDropToEmpty(itemId);
            }}
          >
            <EmptyState hasAssigned={hasAssignedSessions} dropActive={emptyDropActive} compact={entries.length > 0} />
          </div>
        )}
      </div>

      {/* Footer */}
      {entries.length > 0 && (
        <div className="shrink-0 border-t border-stone-200 bg-gradient-to-b from-white to-stone-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-stone-500">
              {existingRecordedMinutes > 0 && (
                <span className="text-stone-400">
                  Already recorded: {formatMinutes(existingRecordedMinutes)} ·{' '}
                </span>
              )}
              <span>
                Draft: <span className="font-semibold text-stone-800">{formatMinutes(totalMinutes)}</span>
              </span>
            </div>
            <button
              onClick={() => onSave(entries)}
              disabled={saving}
              className={`btn-primary text-sm ${saving ? 'progress-shimmer' : ''}`}
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin-slow" />
                  Saving...
                </span>
              ) : saveSuccess ? (
                <span className="flex items-center gap-2">
                  <CheckCircle2 size={14} />
                  Saved
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Save size={14} />
                  Save timesheet
                </span>
              )}
            </button>
          </div>
          {saveError && (
            <div className="mt-2 flex items-center gap-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">
              <AlertCircle size={12} />
              {saveError}
            </div>
          )}
        </div>
      )}
      <div
        className={`absolute right-0 top-0 z-40 flex h-full w-[min(620px,calc(100vw-24px))] flex-col rounded-2xl border border-stone-200 bg-white shadow-2xl shadow-stone-900/20 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          inspectorOpen ? 'translate-x-0' : 'translate-x-[calc(100%+24px)]'
        }`}
        aria-hidden={!inspectorOpen}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-stone-200 bg-stone-50/95 px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-700">Detailed editor</p>
            <h2 className="mt-1 text-base font-semibold text-stone-900">Timesheet signals</h2>
            <p className="mt-0.5 text-xs text-stone-500">Edit each entry and add context to its source signals.</p>
          </div>
          <button
            onClick={() => setInspectorOpen(false)}
            className="rounded-lg p-2 text-stone-400 transition-colors hover:bg-white hover:text-stone-800"
            title="Close detailed editor"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-stone-50/60 p-4">
          <div className="space-y-4">
            {entries.map((entry, index) => {
              const sourceItems = (entry.sourceItemIds ?? [])
                .map((id) => items.find((item) => item.id === id))
                .filter((item): item is ActivityItem => Boolean(item));
              return (
                <div key={entry.id} className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
                  <div className="border-b border-stone-100 px-4 py-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">Entry {index + 1}</span>
                      <label className="flex items-center gap-2 text-xs text-stone-500">
                        <input
                          type="checkbox"
                          checked={entry.billable}
                          onChange={(event) => updateEntry(entry.id, { billable: event.target.checked })}
                          className="rounded accent-accent-600"
                        />
                        Billable
                      </label>
                    </div>
                    <textarea
                      value={entry.description}
                      onChange={(event) => updateEntry(entry.id, { description: event.target.value })}
                      rows={3}
                      className="w-full resize-y rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm leading-relaxed text-stone-800 outline-none transition focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-100"
                      aria-label={`Edit entry ${index + 1} description`}
                    />
                    <div className="mt-2 flex items-center gap-2 text-xs text-stone-500">
                      <Clock size={13} />
                      <span>Minutes</span>
                      <input
                        type="number"
                        min={0}
                        value={entry.confirmedMinutes}
                        onChange={(event) => updateEntry(entry.id, { confirmedMinutes: Math.max(0, Number(event.target.value) || 0) })}
                        className="w-16 rounded-md border border-stone-200 px-2 py-1 text-center text-stone-700 outline-none focus:border-accent-500"
                      />
                    </div>
                  </div>
                  <div className="space-y-2 px-4 py-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-stone-600">
                      <FileText size={13} className="text-accent-600" />
                      Source signals
                      <span className="font-normal text-stone-400">{sourceItems.length}</span>
                    </div>
                    {sourceItems.length === 0 ? (
                      <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-400">No source details available.</p>
                    ) : sourceItems.map((item) => {
                      const Icon = item.provider === 'calendar' ? CalendarDays : item.provider === 'browser' ? Globe : MousePointer2;
                      const context = signalContexts[item.id] ?? '';
                      return (
                        <div key={item.id} className="rounded-lg border border-stone-100 bg-stone-50/70 p-3">
                          <div className="flex items-start gap-2">
                            <Icon size={14} className="mt-0.5 shrink-0 text-stone-400" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-stone-700">{item.summary}</p>
                              <p className="mt-0.5 text-[11px] text-stone-400">{item.provider} · {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{item.durationMinutes ? ` · ${item.durationMinutes} min` : ''}</p>
                            </div>
                          </div>
                          <textarea
                            value={context}
                            onChange={(event) => {
                              const nextContext = event.target.value;
                              setSignalContexts((prev) => ({ ...prev, [item.id]: nextContext }));
                              if (sourceItems.length === 1) {
                                updateEntry(entry.id, { description: nextContext || entry.description });
                              }
                            }}
                            placeholder="Add context for this signal..."
                            rows={2}
                            className="mt-2 w-full resize-y rounded-md border border-stone-200 bg-white px-2.5 py-2 text-xs text-stone-700 outline-none transition placeholder:text-stone-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
                            aria-label={`Add context for ${item.summary}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex shrink-0 justify-end border-t border-stone-200 bg-white px-5 py-3">
          <button onClick={() => setInspectorOpen(false)} className="btn-primary text-sm">Done editing</button>
        </div>
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  color,
  onUpdate,
}: {
  entry: DraftTimesheetEntry;
  color: string;
  onUpdate: (patch: Partial<DraftTimesheetEntry>) => void;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-stone-700">{entry.description}</p>
          <div className="mt-1.5 flex items-center gap-2">
            {entry.activityType && (
              <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
                {entry.activityType}
              </span>
            )}
            <span className="flex items-center gap-0.5 text-[11px] text-stone-400">
              <Clock size={10} />
              <input
                type="number"
                value={entry.confirmedMinutes}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 0;
                  onUpdate({ confirmedMinutes: Math.max(0, val) });
                }}
                className="w-10 border-b border-transparent bg-transparent text-stone-600 outline-none hover:border-stone-300 focus:border-accent-500"
              />
              min
            </span>
            {!entry.billable && (
              <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-400">
                Non-billable
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneratingMessage() {
  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-accent-100 bg-accent-50/70 px-3 py-2.5 animate-fade-in">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-100">
        <Sparkles size={12} className="text-accent-700" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-accent-900">Daykeeper</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-accent-800">
          <span>Generating your timesheet</span>
          <span className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1 w-1 rounded-full bg-accent-500"
                style={{ animation: `pulse-soft 1s ease-in-out ${i * 0.2}s infinite` }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  hasAssigned,
  dropActive,
  compact = false,
}: {
  hasAssigned: boolean;
  dropActive: boolean;
  compact?: boolean;
}) {
  const borderClass = dropActive
    ? 'border-accent-400 bg-accent-50/60 scale-[1.02]'
    : 'border-stone-200 bg-stone-50/50';
  const iconBgClass = dropActive ? 'bg-accent-100' : 'bg-stone-100';
  const iconColorClass = dropActive ? 'text-accent-600' : 'text-stone-300';

  if (compact) {
    return (
      <div
        className={`flex items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-4 text-center transition-all duration-200 ${borderClass}`}
      >
        <Briefcase size={16} className={iconColorClass} />
        <p className="text-xs text-stone-400">
          {dropActive ? 'Drop to pick a matter' : 'Drag another signal here to assign it'}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-12 text-center transition-all duration-200 ${borderClass}`}
    >
      <div className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors duration-200 ${iconBgClass}`}>
        <Briefcase size={20} className={`transition-colors duration-200 ${iconColorClass}`} />
      </div>
      <p className="mt-3 text-sm text-stone-500">
        {hasAssigned
          ? 'Generating preview...'
          : dropActive
            ? 'Drop to assign a matter'
            : 'No matters assigned yet.'}
      </p>
      {!hasAssigned && !dropActive && (
        <p className="mt-1 text-xs text-stone-400">
          Assign activity to matters on the left, or drag a signal here to pick a matter.
        </p>
      )}
    </div>
  );
}
