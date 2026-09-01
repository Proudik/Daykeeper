import { useState, useMemo, useEffect, useRef } from 'react';
import type { ActivityItem, DraftTimesheetEntry, RoundingMinutes, OutputLanguage, Matter } from '@/types';
import type { EstimateResult } from '@/lib/estimator';
import { formatMinutes, formatHours, roundMinutes } from '@/lib/time';
import { editEntryDescription, type EditOperation } from '@/lib/generate';
import { getClientName } from '@/lib/attribution/resolver-data';
import { MatterPicker } from '@/components/MatterPicker';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  MoreVertical,
  Copy,
  FileDown,
  RefreshCw,
  Trash2,
  Split,
  Combine,
  Languages,
  Maximize2,
  Minimize2,
  PenLine,
  ArrowRightLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Loader2,
  AlertCircle,
  Check,
} from 'lucide-react';

interface TimesheetResultViewProps {
  entries: DraftTimesheetEntry[];
  onEntriesChange: (entries: DraftTimesheetEntry[]) => void;
  sourceItems: ActivityItem[];
  rounding: RoundingMinutes;
  targetHours: number;
  language: OutputLanguage;
  estimate: EstimateResult | null;
  matters: Matter[];
  clients: { id: string; name: string }[];
  existingRecordedMinutes: number;
  generationErrors?: string[];
  onBack: () => void;
  onSave: (entries: DraftTimesheetEntry[]) => void;
  onMoveEntry: (entryId: string, newMatterId: string) => void;
  onRegenerateMatter: (matterId: string) => void;
  saving?: boolean;
  saveError?: string | null;
  saveSuccess?: boolean;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-red-100 text-red-800',
};

const CONFIDENCE_LABELS: Record<string, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

const CONFIDENCE_TOOLTIPS: Record<string, string> = {
  high: 'Based on strong evidence — exact name match, filed to this matter, or contact match.',
  medium: 'Based on partial evidence — token overlap, recent activity, or adjacency to another session.',
  low: 'Weak evidence — inferred from timing or adjacency only. Review recommended.',
};

const MATTER_PALETTE = [
  '#2563eb', '#dc2626', '#059669', '#ea580c',
  '#7c3aed', '#0891b2', '#db2777', '#ca8a04',
  '#4f46e5', '#16a34a', '#e11d48', '#0d9488',
];

export function TimesheetResultView({
  entries,
  onEntriesChange,
  sourceItems,
  rounding,
  targetHours,
  language,
  estimate,
  matters,
  clients,
  existingRecordedMinutes,
  generationErrors = [],
  onBack,
  onSave,
  onMoveEntry,
  onRegenerateMatter,
  saving = false,
  saveError = null,
  saveSuccess = false,
}: TimesheetResultViewProps) {
  const [openSources, setOpenSources] = useState<Set<string>>(new Set());
  const [openMenus, setOpenMenus] = useState<Set<string>>(new Set());
  const openMenusRef = useRef(openMenus);
  openMenusRef.current = openMenus;

  useEffect(() => {
    if (openMenus.size === 0) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Element;
      // If the click is inside a [data-entry-menu] element, let the toggle handler deal with it
      if (target.closest('[data-entry-menu]')) return;
      setOpenMenus(new Set());
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenus.size]);
  const [regenText, setRegenText] = useState('');
  const [showRegen, setShowRegen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [movePickerEntryId, setMovePickerEntryId] = useState<string | null>(null);
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());

  // Group entries by matter
  const matterGroups = useMemo(() => {
    const groups = new Map<string | null, DraftTimesheetEntry[]>();
    for (const entry of entries) {
      const key = entry.matterId ?? null;
      const list = groups.get(key) ?? [];
      list.push(entry);
      groups.set(key, list);
    }
    return groups;
  }, [entries]);

  const totalBillableMinutes = entries
    .filter((e) => e.billable)
    .reduce((s, e) => s + e.confirmedMinutes, 0);
  const targetMinutes = targetHours * 60;
  const barColor =
    totalBillableMinutes > 24 * 60
      ? 'bg-red-600'
      : totalBillableMinutes < targetMinutes
        ? 'bg-amber-500'
        : 'bg-accent-600';

  const matterColorMap = useMemo(() => {
    const map = new Map<string, string>();
    matters.forEach((m, i) => {
      map.set(m.id, MATTER_PALETTE[i % MATTER_PALETTE.length]);
    });
    return map;
  }, [matters]);

  function updateEntry(id: string, patch: Partial<DraftTimesheetEntry>) {
    onEntriesChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function toggleSource(id: string) {
    setOpenSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleMenu(id: string) {
    setOpenMenus((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAiEdit(id: string, operation: EditOperation) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    setEditingIds((prev) => new Set(prev).add(id));
    setOpenMenus(new Set());
    try {
      const newDescription = await editEntryDescription(entry.description, operation, language);
      updateEntry(id, { description: newDescription });
    } catch (err) {
      console.error('AI edit failed:', err);
      updateEntry(id, { description: entry.description });
    } finally {
      setEditingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  function handleAction(id: string, action: string) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    const idx = entries.indexOf(entry);

    switch (action) {
      case 'expand':
        handleAiEdit(id, 'expand');
        break;
      case 'shorten':
        handleAiEdit(id, 'shorten');
        break;
      case 'formal':
        handleAiEdit(id, 'formal');
        break;
      case 'rephrase':
        handleAiEdit(id, 'rephrase');
        break;
      case 'translate':
        handleAiEdit(id, 'translate');
        break;
      case 'split': {
        const half = Math.max(3, Math.floor(entry.confirmedMinutes / 2));
        const newEntry: DraftTimesheetEntry = {
          ...entry,
          id: `draft-split-${Date.now()}`,
          confirmedMinutes: half,
          suggestedMinutes: half,
          description: entry.description + ' (part 2)',
        };
        const updated = [...entries];
        updated[idx] = { ...entry, confirmedMinutes: half, description: entry.description + ' (part 1)' };
        updated.splice(idx + 1, 0, newEntry);
        onEntriesChange(updated);
        break;
      }
      case 'merge': {
        if (idx + 1 < entries.length) {
          const next = entries[idx + 1];
          const merged: DraftTimesheetEntry = {
            ...entry,
            confirmedMinutes: entry.confirmedMinutes + next.confirmedMinutes,
            suggestedMinutes: entry.suggestedMinutes + next.suggestedMinutes,
            description: `${entry.description} ${next.description}`,
            sourceSummary: `${entry.sourceSummary}; ${next.sourceSummary}`,
            sourceItemIds: [...entry.sourceItemIds, ...next.sourceItemIds],
          };
          const updated = entries.filter((e) => e.id !== next.id);
          updated[idx] = merged;
          onEntriesChange(updated);
        }
        break;
      }
      case 'move':
        setMovePickerEntryId(id);
        break;
      case 'delete':
        onEntriesChange(entries.filter((e) => e.id !== id));
        break;
    }
    setOpenMenus(new Set());
  }

  function copyMatterEntries(matterId: string | null) {
    const matterEntries = matterGroups.get(matterId) ?? [];
    const text = matterEntries
      .map(
        (e, i) =>
          `${i + 1}. ${formatMinutes(e.confirmedMinutes)} — ${e.activityType ?? 'General'}\n   ${e.description}`,
      )
      .join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied(`matter-${matterId}`);
    setTimeout(() => setCopied(null), 2000);
  }

  function copyAllAsText() {
    const text = entries
      .map(
        (e, i) =>
          `${i + 1}. ${formatMinutes(e.confirmedMinutes)} — ${e.activityType ?? 'General'}\n   ${e.description}`,
      )
      .join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied('text');
    setTimeout(() => setCopied(null), 2000);
  }

  function copyAsCSV() {
    const header = 'Minutes,Activity Type,Billable,Confidence,Description';
    const rows = entries.map(
      (e) =>
        `${e.confirmedMinutes},"${e.activityType ?? ''}",${e.billable},${e.confidence},"${e.description.replace(/"/g, '""')}"`,
    );
    navigator.clipboard.writeText([header, ...rows].join('\n'));
    setCopied('csv');
    setTimeout(() => setCopied(null), 2000);
  }

  function downloadTxt() {
    const text = entries
      .map(
        (e, i) =>
          `${i + 1}. ${formatMinutes(e.confirmedMinutes)} — ${e.activityType ?? 'General'}\n   ${e.description}`,
      )
      .join('\n\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'timesheet.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Build ordered list of matter groups (assigned first, then unassigned)
  const orderedMatterIds = useMemo(() => {
    const ids: (string | null)[] = [];
    for (const [matterId] of matterGroups) {
      if (matterId !== null) ids.push(matterId);
    }
    if (matterGroups.has(null)) ids.push(null);
    return ids;
  }, [matterGroups]);

  return (
    <div className="flex h-full flex-col">
      {/* Total hours bar */}
      <div className="shrink-0 border-b border-stone-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="btn-ghost text-sm">
            <ChevronLeft size={16} /> Back to activity
          </button>
          <div className="flex items-center gap-4">
            <span className="text-sm text-stone-500">
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            </span>
            <span className="text-sm font-semibold text-stone-800">
              {formatHours(totalBillableMinutes)} / {targetHours.toFixed(1)} h
            </span>
            {existingRecordedMinutes > 0 && (
              <span className="text-sm text-stone-400">
                + {formatHours(existingRecordedMinutes)} already recorded
              </span>
            )}
            <button
              onClick={() => onSave(entries)}
              disabled={saving}
              className="btn-primary text-sm disabled:opacity-60"
            >
              {saving ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={14} className="animate-spin" />
                  Saving...
                </span>
              ) : saveSuccess ? (
                <span className="flex items-center gap-1.5">
                  <Check size={14} />
                  Saved
                </span>
              ) : (
                'Save timesheet'
              )}
            </button>
          </div>
        </div>
        {saveError && (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">
            <AlertCircle size={14} className="text-red-600" />
            {saveError}
          </div>
        )}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200">
          <div
            className={`h-full transition-all ${barColor}`}
            style={{ width: `${Math.min(100, (totalBillableMinutes / Math.max(targetMinutes, 1)) * 100)}%` }}
          />
        </div>
        {/* Per-matter breakdown */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {orderedMatterIds.map((matterId) => {
            const matterEntries = matterGroups.get(matterId) ?? [];
            const matterMinutes = matterEntries
              .filter((e) => e.billable)
              .reduce((s, e) => s + e.confirmedMinutes, 0);
            if (matterMinutes === 0 && matterId === null) return null;
            const matter = matterId ? matters.find((m) => m.id === matterId) : null;
            return (
              <span key={matterId ?? 'unassigned'} className="flex items-center gap-1">
                {matterId && (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: matterColorMap.get(matterId) ?? '#d97706' }}
                  />
                )}
                <span className="text-stone-500">
                  {matter?.case_id_visible ?? matter?.name ?? 'Unassigned'}:
                </span>
                <span className="font-medium text-stone-700">{formatHours(matterMinutes)}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Reconciliation panel */}
      {estimate && estimate.reconciliation.daySpanMinutes > 0 && (
        <div className="shrink-0 border-b border-stone-200 bg-stone-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
            <div>
              <span className="text-stone-500">Estimated: </span>
              <span className="font-medium text-stone-800">{formatMinutes(estimate.reconciliation.totalRoundedMinutes)}</span>
              <span className="ml-1 text-stone-400">({formatMinutes(estimate.reconciliation.totalEstimatedMinutes)} pre-rounding)</span>
            </div>
            <div>
              <span className="text-stone-500">Day span: </span>
              <span className="font-medium text-stone-800">{formatMinutes(estimate.reconciliation.daySpanMinutes)}</span>
            </div>
            <div>
              <span className="text-stone-500">Unaccounted gap: </span>
              <span className="font-medium text-stone-800">{formatMinutes(estimate.reconciliation.unaccountedGapMinutes)}</span>
            </div>
            <div>
              <span className="text-stone-500">Target: </span>
              <span className="font-medium text-stone-800">{formatMinutes(estimate.reconciliation.targetMinutes)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Entries grouped by matter */}
      <div className="flex-1 overflow-auto px-4 py-4">
        {generationErrors.length > 0 && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} className="text-red-600" />
              <span className="text-xs font-medium text-red-800">
                {generationErrors.length} {generationErrors.length === 1 ? 'matter' : 'matters'} failed AI generation — showing raw activity data as fallback. Edit descriptions manually or try regenerating.
              </span>
            </div>
            <ul className="mt-1.5 space-y-0.5 text-xs text-red-700">
              {generationErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="space-y-6">
          {orderedMatterIds.map((matterId, matterIdx) => {
            const matterEntries = matterGroups.get(matterId) ?? [];
            const matter = matterId ? matters.find((m) => m.id === matterId) : null;
            const matterMinutes = matterEntries
              .filter((e) => e.billable)
              .reduce((s, e) => s + e.confirmedMinutes, 0);
            const clientName = matter ? getClientName(matter.client_external_id, clients) : null;
            const matterLanguage = matter?.language ?? language;

            return (
              <div key={matterId ?? 'unassigned'} className="animate-fade-in-up" style={{ animationDelay: `${matterIdx * 80}ms` }}>
                {/* Matter header */}
                <div className="mb-3 flex items-center gap-2 border-b border-stone-200 pb-2">
                  {matterId && (
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: matterColorMap.get(matterId) ?? '#d97706' }}
                    />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      {matter?.case_id_visible && (
                        <span className="font-mono text-sm font-medium text-stone-600">
                          {matter.case_id_visible}
                        </span>
                      )}
                      <span className="text-sm font-semibold text-stone-800">
                        {matter?.name ?? 'Unassigned'}
                      </span>
                    </div>
                    {clientName && (
                      <div className="text-xs text-stone-500">{clientName}</div>
                    )}
                  </div>
                  <span className="text-xs text-stone-400">
                    {matterLanguage === 'ces' ? 'CZ' : 'EN'}
                  </span>
                  {matterId && (
                    <button
                      onClick={() => onRegenerateMatter(matterId)}
                      className="btn-ghost px-1.5 py-1 text-xs"
                      title="Regenerate this matter's entries"
                    >
                      <RefreshCw size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => copyMatterEntries(matterId)}
                    className="btn-ghost px-1.5 py-1 text-xs"
                    title="Copy this matter's entries"
                  >
                    <Copy size={12} /> {copied === `matter-${matterId}` ? 'Copied!' : ''}
                  </button>
                  <span className="text-sm font-semibold text-stone-700">
                    {formatHours(matterMinutes)}
                  </span>
                </div>

                {/* Entries for this matter */}
                <div className="space-y-3">
                  {matterEntries.map((entry, idx) => {
                    const sourcesOpen = openSources.has(entry.id);
                    const menuOpen = openMenus.has(entry.id);
                    const isEditing = editingIds.has(entry.id);
                    return (
                      <div key={entry.id} className="card p-4 hover-lift animate-fade-in-up" style={{ animationDelay: `${(matterIdx * 80) + (idx * 50)}ms` }}>
                        <div className="flex items-start gap-3">
                          <span className="mt-1 text-xs font-medium text-stone-400">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <div className="flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-3">
                              <label className="flex items-center gap-1 text-xs text-stone-500" title={`Pre-rounding: ${entry.suggestedMinutes} min`}>
                                <Clock size={12} />
                                <input
                                  type="number"
                                  min={0}
                                  step={rounding === 0 ? 1 : rounding}
                                  value={entry.confirmedMinutes}
                                  onChange={(e) =>
                                    updateEntry(entry.id, {
                                      confirmedMinutes: roundMinutes(
                                        Math.max(0, Number(e.target.value)),
                                        rounding,
                                      ),
                                    })
                                  }
                                  className="w-16 rounded border border-stone-300 px-1.5 py-0.5 text-sm"
                                />
                                min
                              </label>

                              <select
                                value={entry.activityType ?? ''}
                                onChange={(e) =>
                                  updateEntry(entry.id, { activityType: e.target.value || null })
                                }
                                className="rounded border border-stone-300 px-2 py-0.5 text-xs"
                              >
                                <option value="">No type</option>
                                <option>Legal research</option>
                                <option>Document drafting</option>
                                <option>Client meeting</option>
                                <option>Internal meeting</option>
                                <option>Correspondence</option>
                                <option>Court filing</option>
                                <option>Contract review</option>
                                <option>Consultation</option>
                              </select>

                              <button
                                onClick={() => updateEntry(entry.id, { billable: !entry.billable })}
                                className={`rounded px-2 py-0.5 text-xs font-medium ${
                                  entry.billable
                                    ? 'bg-accent-50 text-accent-800'
                                    : 'bg-stone-100 text-stone-500'
                                }`}
                              >
                                {entry.billable ? 'Billable' : 'Non-billable'}
                              </button>

                              <span
                                className={`rounded px-1.5 py-0.5 text-xs font-medium ${CONFIDENCE_COLORS[entry.confidence]}`}
                                title={CONFIDENCE_TOOLTIPS[entry.confidence] ?? ''}
                              >
                                {CONFIDENCE_LABELS[entry.confidence] ?? entry.confidence}
                              </span>

                              {isEditing && (
                                <Loader2 size={12} className="animate-spin text-accent-500" />
                              )}

                              <div className="relative ml-auto" data-entry-menu>
                                <button
                                  onClick={() => toggleMenu(entry.id)}
                                  className="btn-ghost px-1 py-1"
                                  aria-label="Entry actions"
                                >
                                  <MoreVertical size={16} />
                                </button>
                                {menuOpen && (
                                  <div className="absolute right-0 top-8 z-20 w-52 rounded-md border border-stone-200 bg-white py-1 shadow-lg">
                                    {([
                                      { action: 'expand', label: 'Expand', Icon: Maximize2 },
                                      { action: 'shorten', label: 'Shorten', Icon: Minimize2 },
                                      { action: 'formal', label: 'More formal', Icon: PenLine },
                                      { action: 'rephrase', label: 'Rephrase for client', Icon: PenLine },
                                      { action: 'translate', label: 'Translate', Icon: Languages },
                                      { action: 'split', label: 'Split entry', Icon: Split },
                                      { action: 'merge', label: 'Merge with next', Icon: Combine },
                                      { action: 'move', label: 'Move to another matter', Icon: ArrowRightLeft },
                                      { action: 'delete', label: 'Delete', Icon: Trash2 },
                                    ] as const).map(({ action, label, Icon }) => (
                                      <button
                                        key={action}
                                        onClick={() => handleAction(entry.id, action)}
                                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-stone-100 ${
                                          action === 'delete' ? 'text-red-700' : 'text-stone-700'
                                        }`}
                                      >
                                        <Icon size={14} />
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            <textarea
                              value={entry.description}
                              onChange={(e) => updateEntry(entry.id, { description: e.target.value })}
                              rows={2}
                              className="w-full resize-none rounded border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm text-stone-800 focus:border-accent-500 focus:bg-white focus:outline-none"
                              style={{ height: 'auto' }}
                              onInput={(e) => {
                                const t = e.currentTarget;
                                t.style.height = 'auto';
                                t.style.height = `${t.scrollHeight}px`;
                              }}
                            />

                            {entry.sourceSummary && (
                              <button
                                onClick={() => toggleSource(entry.id)}
                                className="mt-2 flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800"
                              >
                                {sourcesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                Sources: {entry.sourceSummary}
                              </button>
                            )}
                            {sourcesOpen && entry.sourceItemIds.length > 0 && (
                              <ul className="mt-1.5 space-y-0.5 border-l-2 border-stone-200 pl-3">
                                {entry.sourceItemIds.map((sid) => {
                                  const item = sourceItems.find((s) => s.id === sid);
                                  if (!item) return null;
                                  return (
                                    <li key={sid} className="flex items-start gap-1.5 text-xs text-stone-500">
                                      <span className="mt-0.5 shrink-0 rounded bg-stone-100 px-1 py-0.5 font-mono text-[10px] capitalize">
                                        {item.provider}
                                      </span>
                                      {item.provider === 'email' && (
                                        item.meta.direction === 'outgoing'
                                          ? <ArrowUpRight size={12} className="mt-0.5 shrink-0 text-blue-500" title="Sent" />
                                          : <ArrowDownLeft size={12} className="mt-0.5 shrink-0 text-emerald-500" title="Received" />
                                      )}
                                      <span>{item.summary}</span>
                                      {item.durationMinutes != null && (
                                        <span className="ml-auto shrink-0 text-stone-400">
                                          {item.durationMinutes}m
                                        </span>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        </div>

                        {/* Move picker */}
                        {movePickerEntryId === entry.id && (
                          <div className="relative mt-2">
                            <MatterPicker
                              anchorId={entry.id}
                              candidates={[]}
                              matters={matters}
                              clients={clients}
                              recentMatterIds={[]}
                              currentMatterId={entry.matterId}
                              onAssign={(newMatterId) => {
                                onMoveEntry(entry.id, newMatterId);
                                setMovePickerEntryId(null);
                              }}
                              onNonBillable={() => setMovePickerEntryId(null)}
                              onIgnore={() => setMovePickerEntryId(null)}
                              onClose={() => setMovePickerEntryId(null)}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Global actions */}
        <div className="mt-6 border-t border-stone-200 pt-4">
          {showRegen && (
            <div className="mb-3">
              <textarea
                value={regenText}
                onChange={(e) => setRegenText(e.target.value)}
                placeholder='e.g. "merge all the Novák emails into one entry"'
                rows={2}
                className="input mb-2"
              />
              <div className="flex gap-2">
                <button className="btn-primary text-sm">
                  Regenerate
                </button>
                <button onClick={() => setShowRegen(false)} className="btn-ghost text-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {!showRegen && (
            <button
              onClick={() => setShowRegen(true)}
              className="btn-ghost text-sm"
            >
              <RefreshCw size={14} /> Regenerate with instruction
            </button>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={copyAllAsText} className="btn-secondary text-sm">
              <Copy size={14} /> {copied === 'text' ? 'Copied!' : 'Copy all as text'}
            </button>
            <button onClick={copyAsCSV} className="btn-secondary text-sm">
              <Copy size={14} /> {copied === 'csv' ? 'Copied!' : 'Copy as CSV'}
            </button>
            <button onClick={downloadTxt} className="btn-secondary text-sm">
              <FileDown size={14} /> Download .txt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
