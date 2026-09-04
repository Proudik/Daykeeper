import { useState, useMemo, useEffect, useRef } from 'react';
import type { DragEvent } from 'react';
import type { ActivityItem, DraftTimesheetEntry, Matter } from '@/types';
import type { EstimateResult } from '@/lib/estimator';
import { formatMinutes, formatHours } from '@/lib/time';
import { providerColors } from '@/components/TimelineStrip';
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
  X,
  FileText,
  Globe,
  CalendarDays,
  MousePointer2,
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
  onHoverEntry,
  hasAssignedSessions,
  lastDropMatterId,
}: TimesheetPanelProps) {
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dropFlash, setDropFlash] = useState<string | null>(null);
  const [emptyDropActive, setEmptyDropActive] = useState(false);
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

  const expandedEntry = expandedEntryId ? entries.find((entry) => entry.id === expandedEntryId) ?? null : null;

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

  function copyAll() {
    const text = entries
      .map((e, i) => `${i + 1}. ${formatMinutes(e.confirmedMinutes)} — ${e.activityType ?? 'General'}\n   ${e.description}`)
      .join('\n\n');
    navigator.clipboard.writeText(text);
  }

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [entries.length]);

  // Close on Escape or click-away
  useEffect(() => {
    if (!expandedEntryId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedEntryId(null);
    };
    const handleClickAway = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-timesheet-panel]')) setExpandedEntryId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickAway);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickAway);
    };
  }, [expandedEntryId]);

  return (
    <div data-timesheet-panel className={`absolute inset-y-3 right-3 z-20 flex flex-col overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-xl shadow-stone-300/30 transition-[width] duration-300 ease-out ${expandedEntry ? 'w-[min(68vw,950px)]' : 'w-[calc(100%-12px)]'}`}>
      {/* Header */}
      <div className="shrink-0 border-b border-stone-200 bg-gradient-to-b from-stone-50 to-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-100">
              <Sparkles size={15} className="text-accent-700" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-stone-800">Timesheet Preview</h3>
              <p className="text-[10px] text-stone-400">
                {hasAssignedSessions
                  ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · ${formatMinutes(totalMinutes)}`
                  : 'Assign matters to generate'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
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
            <div className="flex items-center justify-between text-[10px] text-stone-500">
              <span>{formatMinutes(totalBillableMinutes)} of {formatHours(targetMinutes)}</span>
              <span>{Math.round(progressPct)}%</span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-stone-200">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPct}%`, backgroundColor: barColor }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className={`relative flex-1 overflow-y-auto px-4 py-3 ${expandedEntry ? 'pr-[48%]' : ''}`}>
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
                  style={{ animation: 'fadeInUp 0.3s ease-out both', borderLeftColor: color, borderLeftWidth: '3px' }}
                >
                  {/* Matter header */}
                  <div className="flex w-full items-center gap-2 px-3 py-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-stone-800">
                        {matter?.name ?? 'Unassigned'}
                      </span>
                      {matter?.case_id_visible && (
                        <span className="block truncate text-[10px] font-mono text-stone-400">{matter.case_id_visible}</span>
                      )}
                    </div>
                    {isCardGenerating && (
                      <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-accent-700">
                        <Loader2 size={11} className="animate-spin-slow" />
                        Generating
                      </span>
                    )}
                    <span className="shrink-0 text-[11px] font-medium text-stone-600">
                      {formatMinutes(groupMinutes)}
                    </span>
                  </div>

                  {/* Entries — each individually expandable to the left */}
                  <div className="divide-y divide-stone-100 border-t border-stone-100">
                    {groupEntries.map((entry, i) => (
                      <div
                        key={entry.id}
                        style={{ animation: `fadeInUp 0.3s ease-out ${i * 60}ms both` }}
                        onMouseEnter={() => onHoverEntry?.(entry.sourceItemIds ?? null)}
                        onMouseLeave={() => onHoverEntry?.(null)}
                      >
                        <ExpandableEntryRow
                          entry={entry}
                          color={color}
                          isExpanded={expandedEntryId === entry.id}
                          onToggle={() =>
                            setExpandedEntryId((prev) => (prev === entry.id ? null : entry.id))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {expandedEntry && (
          <EntryEditorPanel
            entry={expandedEntry}
            items={items}
            color={expandedEntry.matterId ? matterColorMap.get(expandedEntry.matterId) ?? '#78716c' : '#d97706'}
            signalContexts={signalContexts}
            setSignalContexts={setSignalContexts}
            onUpdate={(patch) => updateEntry(expandedEntry.id, patch)}
            onClose={() => setExpandedEntryId(null)}
          />
        )}

        {/* Full drop zone when no entries yet */}
        {!generating && generationErrors.length === 0 && !expandedEntry && entries.length === 0 && (
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
            <EmptyState hasAssigned={hasAssignedSessions} dropActive={emptyDropActive} />
          </div>
        )}
        {/* Compact drop zone when entries already exist */}
        {!generating && generationErrors.length === 0 && !expandedEntry && entries.length > 0 && onDropToEmpty && (
          <div
            className="mt-1"
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setEmptyDropActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setEmptyDropActive(false);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const itemId = event.dataTransfer.getData('text/daykeeper-item');
              setEmptyDropActive(false);
              if (itemId) onDropToEmpty(itemId);
            }}
          >
            <CompactDropZone dropActive={emptyDropActive} />
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
    </div>
  );
}

function ExpandableEntryRow({
  entry,
  color,
  isExpanded,
  onToggle,
}: {
  entry: DraftTimesheetEntry;
  color: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="transition-colors duration-150">
      <button
        onClick={onToggle}
        className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-stone-50 ${
          isExpanded ? 'bg-accent-50/40 ring-1 ring-inset ring-accent-200' : ''
        }`}
      >
        <div className="mt-1 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <p className={`text-xs leading-relaxed text-stone-700 ${isExpanded ? 'font-medium' : ''}`}>
            {entry.description}
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            {entry.activityType && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-600">
                {entry.activityType}
              </span>
            )}
            <span className="flex items-center gap-0.5 text-[10px] text-stone-400">
              <Clock size={9} />
              {entry.confirmedMinutes} min
            </span>
            {!entry.billable && (
              <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[9px] text-stone-400">
                Non-billable
              </span>
            )}
            <span className="ml-auto text-[9px] text-stone-300">
              {isExpanded ? 'Editing' : 'Edit'}
            </span>
          </div>
        </div>
      </button>
    </div>
  );
}

function EntryEditorPanel({
  entry,
  items,
  color,
  signalContexts,
  setSignalContexts,
  onUpdate,
  onClose,
}: {
  entry: DraftTimesheetEntry;
  items: ActivityItem[];
  color: string;
  signalContexts: Record<string, string>;
  setSignalContexts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onUpdate: (patch: Partial<DraftTimesheetEntry>) => void;
  onClose: () => void;
}) {
  const sourceItems = (entry.sourceItemIds ?? [])
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is ActivityItem => Boolean(item));

  return (
    <aside className="animate-slide-in-right absolute inset-y-0 right-0 z-10 flex w-[46%] min-w-[300px] flex-col rounded-2xl border-l border-stone-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between border-b border-stone-200 bg-gradient-to-b from-stone-50 to-white px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-xs font-semibold text-stone-800">Edit Entry</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
          title="Close"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-3">
          <label className="mb-1 block text-[9px] font-semibold uppercase tracking-wide text-stone-400">
            Description
          </label>
          <textarea
            value={entry.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            rows={3}
            className="w-full resize-y rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs leading-relaxed text-stone-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-stone-400" />
            <input
              type="number"
              min={0}
              value={entry.confirmedMinutes}
              onChange={(e) => onUpdate({ confirmedMinutes: Math.max(0, Number(e.target.value) || 0) })}
              className="w-14 rounded-md border border-stone-200 bg-white px-2 py-1 text-center text-xs text-stone-700 outline-none focus:border-accent-500"
            />
            <span className="text-[11px] text-stone-400">min</span>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-stone-600">
            <input
              type="checkbox"
              checked={entry.billable}
              onChange={(e) => onUpdate({ billable: e.target.checked })}
              className="rounded accent-accent-600"
            />
            Billable
          </label>
          {entry.activityType && (
            <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
              {entry.activityType}
            </span>
          )}
        </div>

        {sourceItems.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-stone-400">
              <FileText size={11} className="text-accent-600" />
              Source signals
              <span className="font-normal text-stone-300">{sourceItems.length}</span>
            </div>
            <div className="space-y-1.5">
              {sourceItems.map((item) => {
                const Icon = item.provider === 'calendar' ? CalendarDays : item.provider === 'browser' ? Globe : MousePointer2;
                const context = signalContexts[item.id] ?? '';
                const sourceColor = providerColors[item.provider] ?? '#78716c';
                return (
                  <div key={item.id} className="rounded-lg border bg-white p-2.5" style={{ borderColor: `${sourceColor}30`, backgroundColor: `${sourceColor}08` }}>
                    <div className="flex items-start gap-2">
                      <Icon size={12} className="mt-0.5 shrink-0" style={{ color: sourceColor }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-stone-700">{item.summary}</p>
                        <p className="mt-0.5 text-[9px]" style={{ color: sourceColor }}>
                          {item.provider} · {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {item.durationMinutes ? ` · ${item.durationMinutes} min` : ''}
                        </p>
                      </div>
                    </div>
                    <textarea
                      value={context}
                      onChange={(e) => {
                        const nextContext = e.target.value;
                        setSignalContexts((prev) => ({ ...prev, [item.id]: nextContext }));
                        if (sourceItems.length === 1) onUpdate({ description: nextContext || entry.description });
                      }}
                      placeholder="Add context for this signal..."
                      rows={2}
                      className="mt-1.5 w-full resize-y rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-700 outline-none transition placeholder:text-stone-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function GeneratingMessage() {
  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-accent-100 bg-accent-50/70 px-3 py-2.5 animate-fade-in">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-100">
        <Sparkles size={12} className="text-accent-700" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-accent-900">Daykeeper</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-accent-800">
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
}: {
  hasAssigned: boolean;
  dropActive: boolean;
}) {
  const borderClass = dropActive
    ? 'border-accent-400 bg-accent-50/60 scale-[1.02]'
    : 'border-stone-200 bg-stone-50/50';
  const iconBgClass = dropActive ? 'bg-accent-100' : 'bg-stone-100';
  const iconColorClass = dropActive ? 'text-accent-600' : 'text-stone-300';

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-12 text-center transition-all duration-200 ${borderClass}`}
    >
      <div className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors duration-200 ${iconBgClass}`}>
        <Briefcase size={20} className={`transition-colors duration-200 ${iconColorClass}`} />
      </div>
      <p className="mt-3 text-xs text-stone-500">
        {hasAssigned
          ? 'Generating preview...'
          : dropActive
            ? 'Drop to assign a matter'
            : 'No matters assigned yet.'}
      </p>
      {!hasAssigned && !dropActive && (
        <p className="mt-1 text-[11px] text-stone-400">
          Assign activity to matters on the left, or drag a signal here to pick a matter.
        </p>
      )}
    </div>
  );
}

function CompactDropZone({ dropActive }: { dropActive: boolean }) {
  const borderClass = dropActive
    ? 'border-accent-400 bg-accent-50/60'
    : 'border-stone-200 bg-stone-50/50';
  return (
    <div
      className={`flex items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-3 text-center transition-all duration-200 ${borderClass}`}
    >
      <Briefcase size={14} className={dropActive ? 'text-accent-600' : 'text-stone-300'} />
      <p className="text-xs text-stone-400">
        {dropActive ? 'Drop to pick a matter' : 'Drag another signal here to assign it'}
      </p>
    </div>
  );
}
