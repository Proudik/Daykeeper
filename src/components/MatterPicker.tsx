import { useEffect, useRef, useState, useMemo } from 'react';
import type { Matter, MatterRuleType } from '@/types';
import type { ScoredCandidate } from '@/lib/attribution/scoring-resolver';
import { getClientName, getMatterPath } from '@/lib/attribution/resolver-data';
import { Search, Briefcase, EyeOff, Check, Tag } from 'lucide-react';

export interface MatterPickerProps {
  anchorId: string;
  candidates: ScoredCandidate[];
  matters: Matter[];
  clients: { id: string; name: string }[];
  recentMatterIds: string[];
  currentMatterId: string | null;
  onAssign: (matterId: string) => void;
  onNonBillable: () => void;
  onIgnore: () => void;
  onClose: () => void;
  onCreateRule?: (rule: { rule_type: MatterRuleType; value: string; matter_id: string }) => void;
}

type RowItem =
  | { kind: 'candidate'; candidate: ScoredCandidate }
  | { kind: 'matter'; matter: Matter; section: 'recent' | 'closed' | 'search' }
  | { kind: 'nonbillable' }
  | { kind: 'ignore' };

export function MatterPicker({
  candidates,
  matters,
  clients,
  recentMatterIds,
  currentMatterId,
  onAssign,
  onNonBillable,
  onIgnore,
  onClose,
  onCreateRule,
}: MatterPickerProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [tagValue, setTagValue] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const tagRef = useRef<HTMLInputElement>(null);

  function selectMatter(matterId: string) {
    const tag = tagValue.trim();
    if (tag && onCreateRule) {
      onCreateRule({ rule_type: 'keyword', value: tag, matter_id: matterId });
    }
    onAssign(matterId);
  }
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return matters
      .filter((m) => {
        const client = getClientName(m.client_external_id, clients) ?? '';
        return (
          m.name.toLowerCase().includes(q) ||
          (m.case_id_visible ?? '').toLowerCase().includes(q) ||
          client.toLowerCase().includes(q) ||
          (m.case_no ?? '').toLowerCase().includes(q)
        );
      })
      .slice(0, 20);
  }, [query, matters, clients]);

  const recentMatters = useMemo(() => {
    if (query.trim()) return [];
    return recentMatterIds
      .map((id) => matters.find((m) => m.id === id))
      .filter((m): m is Matter => m !== undefined)
      .slice(0, 5);
  }, [query, recentMatterIds, matters]);

  const closedMatters = useMemo(() => {
    if (query.trim()) return [];
    return matters.filter((m) => !m.state_is_open).slice(0, 8);
  }, [query, matters]);

  const rows = useMemo<RowItem[]>(() => {
    const result: RowItem[] = [];
    if (!query.trim()) {
      candidates.slice(0, 3).forEach((c) => result.push({ kind: 'candidate', candidate: c }));
      recentMatters.forEach((m) => result.push({ kind: 'matter', matter: m, section: 'recent' }));
      closedMatters.forEach((m) => result.push({ kind: 'matter', matter: m, section: 'closed' }));
    } else {
      searchResults.forEach((m) => result.push({ kind: 'matter', matter: m, section: 'search' }));
    }
    result.push({ kind: 'nonbillable' });
    result.push({ kind: 'ignore' });
    return result;
  }, [candidates, query, searchResults, recentMatters, closedMatters]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = rows[activeIndex];
        if (!row) return;
        if (row.kind === 'candidate') selectMatter(row.candidate.matterId);
        else if (row.kind === 'matter') selectMatter(row.matter.id);
        else if (row.kind === 'nonbillable') onNonBillable();
        else if (row.kind === 'ignore') onIgnore();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [rows, activeIndex, onAssign, onNonBillable, onIgnore, onClose]);

  useEffect(() => {
    const el = scrollRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Determine where section labels should appear
  const firstCandidateIndex = rows.findIndex((r) => r.kind === 'candidate');
  const firstRecentIndex = rows.findIndex((r) => r.kind === 'matter' && r.section === 'recent');
  const firstClosedIndex = rows.findIndex((r) => r.kind === 'matter' && r.section === 'closed');
  const firstSearchIndex = rows.findIndex((r) => r.kind === 'matter' && r.section === 'search');
  const firstSpecialIndex = rows.findIndex((r) => r.kind === 'nonbillable' || r.kind === 'ignore');

  return (
    <div ref={rootRef} className="w-full max-w-[340px] overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-xl shadow-stone-200/60 sm:w-[340px]">

      {/* Search input */}
      <div className="flex items-center gap-2 border-b border-stone-100 px-3 py-2.5">
        <Search size={14} className="shrink-0 text-stone-400" />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search matters…"
          className="flex-1 bg-transparent text-sm text-stone-800 outline-none placeholder:text-stone-400"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-stone-400 hover:text-stone-600 transition-colors">
            <Search size={12} />
          </button>
        )}
      </div>

      {/* List */}
      <div ref={scrollRef} className="max-h-72 overflow-y-auto py-1.5">

        {query.trim() && searchResults.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-stone-400">
            No matters match &ldquo;{query}&rdquo;
          </p>
        )}

        {rows.map((row, i) => {
          const isActive = activeIndex === i;

          // Section headers
          const showSuggestedLabel = i === firstCandidateIndex && firstCandidateIndex >= 0;
          const showRecentLabel = i === firstRecentIndex && firstRecentIndex >= 0;
          const showClosedLabel = i === firstClosedIndex && firstClosedIndex >= 0;
          const showSearchLabel = i === firstSearchIndex && firstSearchIndex >= 0 && query.trim().length > 0;
          const showDivider = i === firstSpecialIndex && firstSpecialIndex > 0;

          return (
            <div key={i}>
              {showSuggestedLabel && (
                <div className="flex items-center justify-between px-3 pt-1 pb-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                    Suggested
                  </p>
                  <p className="text-[10px] text-stone-300">confidence</p>
                </div>
              )}
              {showRecentLabel && (
                <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                  Recent
                </p>
              )}
              {showClosedLabel && (
                <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                  Closed matters
                </p>
              )}
              {showSearchLabel && (
                <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                  Results
                </p>
              )}
              {showDivider && <div className="mx-3 my-1 border-t border-stone-100" />}

              {row.kind === 'candidate' && (
                <CandidateRow
                  candidate={row.candidate}
                  clients={clients}
                  isCurrent={row.candidate.matterId === currentMatterId}
                  isActive={isActive}
                  onHover={() => setActiveIndex(i)}
                  onClick={() => selectMatter(row.candidate.matterId)}
                />
              )}
              {row.kind === 'matter' && (
                <MatterRow
                  matter={row.matter}
                  matters={matters}
                  clients={clients}
                  isCurrent={row.matter.id === currentMatterId}
                  isClosed={!row.matter.state_is_open}
                  isActive={isActive}
                  onHover={() => setActiveIndex(i)}
                  onClick={() => selectMatter(row.matter.id)}
                />
              )}
              {row.kind === 'nonbillable' && (
                <button
                  onClick={onNonBillable}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                    isActive ? 'bg-stone-100 text-stone-800' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-700'
                  }`}
                >
                  <Briefcase size={14} className="shrink-0" />
                  <span>Mark as non-billable</span>
                </button>
              )}
              {row.kind === 'ignore' && (
                <button
                  onClick={onIgnore}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                    isActive ? 'bg-stone-100 text-stone-800' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-700'
                  }`}
                >
                  <EyeOff size={14} className="shrink-0" />
                  <span>Ignore this item</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {onCreateRule && (
        <div className="border-t border-stone-100 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Tag size={13} className="shrink-0 text-stone-400" />
            <input
              ref={tagRef}
              type="text"
              value={tagValue}
              onChange={(e) => setTagValue(e.target.value)}
              placeholder="Type a keyword (e.g. &ldquo;acme&rdquo;)…"
              className="flex-1 bg-transparent text-sm text-stone-700 outline-none placeholder:text-stone-400"
              onKeyDown={(e) => { if (e.key === 'Escape') tagRef.current?.blur(); }}
            />
            {tagValue.trim() && (
              <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                Auto-assign
              </span>
            )}
          </div>
          <p className="mt-1 pl-5 text-[11px] leading-snug text-stone-400">
            Future activity containing this keyword will automatically be assigned to the selected matter. You can undo rules anytime.
          </p>
        </div>
      )}
    </div>
  );
}

function confidenceColor(score: number): string {
  if (score >= 70) return 'bg-green-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-stone-400';
}

function confidenceLabel(score: number): string {
  if (score >= 70) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

function CandidateRow({
  candidate,
  clients,
  isCurrent,
  isActive,
  onHover,
  onClick,
}: {
  candidate: ScoredCandidate;
  clients: { id: string; name: string }[];
  isCurrent: boolean;
  isActive: boolean;
  onHover: () => void;
  onClick: () => void;
}) {
  const client = getClientName(candidate.matter.client_external_id, clients);
  const score = Math.min(100, Math.max(0, Math.round(candidate.score)));
  return (
    <button
      onClick={onClick}
      onMouseEnter={onHover}
      className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
        isActive ? 'bg-stone-100' : 'hover:bg-stone-50'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {candidate.matter.case_id_visible && (
            <span className="shrink-0 font-mono text-[11px] text-stone-400">
              {candidate.matter.case_id_visible}
            </span>
          )}
          <span className="truncate text-sm font-medium text-stone-800">
            {candidate.matter.name}
          </span>
          {isCurrent && (
            <span className="ml-auto shrink-0 flex items-center gap-1 text-[11px] text-green-600">
              <Check size={11} /> current
            </span>
          )}
        </div>
        {client && (
          <p className="truncate text-xs text-stone-400 mt-0.5">{client}</p>
        )}
        {candidate.reasons[0] && (
          <p className="truncate text-[11px] text-stone-400 mt-0.5 italic">{candidate.reasons[0]}</p>
        )}
      </div>
      {/* Confidence score bar */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[10px] font-medium text-stone-500">{confidenceLabel(score)}</span>
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-stone-200">
          <div
            className={`h-full rounded-full transition-all ${confidenceColor(score)}`}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
    </button>
  );
}

function MatterRow({
  matter,
  matters,
  clients,
  isCurrent,
  isClosed,
  isActive,
  onHover,
  onClick,
}: {
  matter: Matter;
  matters: Matter[];
  clients: { id: string; name: string }[];
  isCurrent: boolean;
  isClosed: boolean;
  isActive: boolean;
  onHover: () => void;
  onClick: () => void;
}) {
  const path = getMatterPath(matter, matters, clients);
  return (
    <button
      onClick={onClick}
      onMouseEnter={onHover}
      className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
        isActive ? 'bg-stone-100' : 'hover:bg-stone-50'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {matter.case_id_visible && (
            <span className="shrink-0 font-mono text-[11px] text-stone-400">
              {matter.case_id_visible}
            </span>
          )}
          <span className={`truncate text-sm font-medium ${isClosed ? 'text-stone-400' : 'text-stone-800'}`}>
            {matter.name}
          </span>
          {isCurrent && (
            <span className="ml-auto shrink-0 flex items-center gap-1 text-[11px] text-green-600">
              <Check size={11} /> current
            </span>
          )}
        </div>
        {path && path !== matter.name && (
          <p className="truncate text-xs text-stone-400 mt-0.5">{path}</p>
        )}
      </div>
    </button>
  );
}
