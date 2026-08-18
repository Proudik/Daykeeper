import { useEffect, useRef, useState } from 'react';
import type { ActivityItem, Provider } from '@/types';
import { formatTime, formatTimeRange, minutesBetween, formatMinutes } from '@/lib/time';
import { providerColors } from '@/components/TimelineStrip';
import { ChevronDown, ChevronRight, Mail, Calendar, MessageSquare, CheckSquare, FileText, Inbox, X, CheckCircle2, ArrowDownLeft, ArrowUpRight, Globe, Clock, Zap, Trash2 } from 'lucide-react';

const BRIEF_THRESHOLD_MIN = 10;

function isBrief(item: ActivityItem, timezone?: string): boolean {
  const dur = item.endTimestamp
    ? minutesBetween(item.timestamp, item.endTimestamp, timezone)
    : item.durationMinutes ?? 0;
  return dur > 0 && dur < BRIEF_THRESHOLD_MIN;
}

interface ActivityListProps {
  items: ActivityItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  collapsedSections: Set<Provider>;
  onToggleSection: (p: Provider) => void;
  onToggleProviderAll: (p: Provider, select: boolean) => void;
  focusedIndex: number | null;
  onFocusIndex: (i: number | null) => void;
  flatIds: string[];
  usedItemIds?: Set<string>;
  generatedItemIds?: Set<string>;
  timezone?: string;
  onDragStart?: (itemId: string) => void;
  onDeleteItem?: (itemId: string) => void;
}

const providerIcons: Record<Provider, typeof Mail> = {
  email: Mail,
  calendar: Calendar,
  chat: MessageSquare,
  documents: FileText,
  singlecase: Inbox,
  browser: Globe,
  custom: FileText,
};

const providerLabels: Record<Provider, string> = {
  email: 'Email',
  calendar: 'Calendar',
  chat: 'Chat',
  documents: 'Documents',
  singlecase: 'SingleCase',
  browser: 'Browser',
  custom: 'Custom',
};

const PROVIDER_ORDER: Provider[] = ['email', 'calendar', 'chat', 'documents', 'singlecase', 'custom', 'browser'];

export function ActivityList({
  items,
  selectedIds,
  onToggle,
  collapsedSections,
  onToggleSection,
  onToggleProviderAll,
  focusedIndex,
  onFocusIndex,
  flatIds,
  usedItemIds,
  generatedItemIds,
  timezone,
  onDragStart,
  onDeleteItem,
}: ActivityListProps) {
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [showUsed, setShowUsed] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(Boolean(document.querySelector('.simulate-mobile')));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
    return () => observer.disconnect();
  }, []);

  // Scroll focused row into view
  useEffect(() => {
    if (focusedIndex === null) return;
    const id = flatIds[focusedIndex];
    if (id) {
      const el = rowRefs.current.get(id);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedIndex, flatIds]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (flatIds.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onFocusIndex(focusedIndex === null ? 0 : Math.min(focusedIndex + 1, flatIds.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onFocusIndex(focusedIndex === null ? 0 : Math.max(focusedIndex - 1, 0));
    } else if (e.key === ' ') {
      e.preventDefault();
      if (focusedIndex !== null) {
        onToggle(flatIds[focusedIndex]);
      }
    }
  }

  const briefItems = items.filter((item) => isBrief(item, timezone));
  const briefIds = new Set(briefItems.map((item) => item.id));

  // Keep brief activity out of provider sections so it has one clear home below them.
  const usedSet = usedItemIds ?? new Set<string>();
  const availableItems = items.filter((i) => !usedSet.has(i.id) && !briefIds.has(i.id));
  const usedItems = items.filter((i) => usedSet.has(i.id) && !briefIds.has(i.id));

  const availableByProvider = new Map<Provider, ActivityItem[]>();
  const usedByProvider = new Map<Provider, ActivityItem[]>();
  for (const p of PROVIDER_ORDER) {
    availableByProvider.set(p, []);
    usedByProvider.set(p, []);
  }
  for (const item of availableItems) {
    availableByProvider.get(item.provider)?.push(item);
  }
  for (const item of usedItems) {
    usedByProvider.get(item.provider)?.push(item);
  }
  for (const [, list] of availableByProvider) {
    list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
  for (const [, list] of usedByProvider) {
    list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  return (
    <div
      className="divide-y divide-stone-200"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="listbox"
      aria-label="Activity items"
    >
      {PROVIDER_ORDER.map((provider) => {
        const list = availableByProvider.get(provider)!;
        const usedList = usedByProvider.get(provider)!;
        if (list.length === 0 && usedList.length === 0) return null;
        const collapsed = collapsedSections.has(provider);
        const allSelected = list.length > 0 && list.every((item) => selectedIds.has(item.id));
        const Icon = providerIcons[provider];

        return (
          <div key={provider}>
            {/* Section header */}
            <div className="sticky top-0 z-10 flex items-center gap-2 bg-stone-50 px-3 py-2">
              <button
                onClick={() => onToggleSection(provider)}
                className="text-stone-400 hover:text-stone-700"
                aria-label={collapsed ? 'Expand section' : 'Collapse section'}
              >
                {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </button>
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: providerColors[provider] }}
              />
              <Icon size={14} className="text-stone-500" />
              <span className="text-sm font-semibold text-stone-800">
                {providerLabels[provider]}
              </span>
              <span className="text-xs text-stone-400">
                {list.length} {list.length === 1 ? 'item' : 'items'}
                {usedList.length > 0 && (
                  <span className="text-green-600"> +{usedList.length} used</span>
                )}
              </span>
              <button
                onClick={() => onToggleProviderAll(provider, !allSelected)}
                className="ml-auto text-xs text-stone-500 hover:text-stone-800"
              >
                {allSelected ? (
                  <span className="flex items-center gap-1">
                    <X size={12} /> Select none
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Inbox size={12} /> Select all
                  </span>
                )}
              </button>
            </div>

            {/* Items */}
            {!collapsed && (
              <div>
                {list.filter((item) => !isBrief(item, timezone)).map((item) => {
                  const selected = selectedIds.has(item.id);
                  const flatIdx = flatIds.indexOf(item.id);
                  const focused = focusedIndex === flatIdx;
                  const declined = item.provider === 'calendar' && item.meta.accepted === false;

                  return (
                    <div
                      key={item.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(item.id, el);
                      }}
                      onClick={() => {
                        onToggle(item.id);
                        onFocusIndex(flatIdx);
                      }}
                      draggable={Boolean(onDragStart) && !isMobile}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/daykeeper-item', item.id);
                        event.dataTransfer.effectAllowed = 'move';
                        onDragStart?.(item.id);
                      }}
                      className={`flex items-start gap-3 border-l-2 px-3 py-1.5 transition-colors duration-150 ${
                        focused ? 'border-accent-500 bg-accent-50' : generatedItemIds?.has(item.id) ? 'border-accent-500 bg-accent-50/60' : selected ? 'border-stone-300 bg-stone-50' : 'border-transparent hover:bg-stone-50'
                      } animate-fade-in`}
                      style={{ animationDelay: `${flatIdx * 25}ms` }}
                    >
                      {/* Direction indicator (email) */}
                      {item.provider === 'email' && (
                        <div className="mt-0.5 shrink-0">
                          {item.meta.direction === 'outgoing' ? (
                            <ArrowUpRight size={14} className="text-blue-500" />
                          ) : (
                            <ArrowDownLeft size={14} className="text-emerald-500" />
                          )}
                        </div>
                      )}

                      {/* Time column — monospace */}
                      <div className="w-28 shrink-0 font-mono text-xs text-stone-500">
                        {item.endTimestamp
                          ? formatTimeRange(item.timestamp, item.endTimestamp, timezone)
                          : formatTime(item.timestamp, timezone)}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        {item.meta.url ? (
                          <a
                            href={item.meta.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className={`truncate text-sm hover:underline hover:text-accent-700 ${
                              declined ? 'text-stone-400 line-through' : 'text-stone-800'
                            }`}
                          >
                            {item.summary}
                          </a>
                        ) : (
                          <p
                            className={`truncate text-sm ${
                              declined ? 'text-stone-400 line-through' : 'text-stone-800'
                            }`}
                          >
                            {item.summary}
                          </p>
                        )}
                        <p className="truncate text-xs text-stone-400">
                          {renderSubline(item)}
                        </p>
                      </div>

                      {/* Duration / status */}
                      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right text-xs text-stone-500">
                        {generatedItemIds?.has(item.id) && (
                          <span className="rounded-full bg-accent-100 px-1.5 py-0.5 text-[10px] font-semibold text-accent-700">
                            In timesheet
                          </span>
                        )}
                        {declined ? (
                          <span className="text-stone-400">Declined</span>
                        ) : item.endTimestamp ? (
                          <span className="flex items-center gap-1">
                            {item.provider === 'browser' && <Clock size={10} className="text-teal-500" />}
                            {formatMinutes(minutesBetween(item.timestamp, item.endTimestamp, timezone))}
                          </span>
                        ) : item.durationMinutes ? (
                          <span className="flex items-center gap-1">
                            {item.provider === 'browser' && <Clock size={10} className="text-teal-500" />}
                            {formatMinutes(item.durationMinutes)}
                          </span>
                        ) : null}
                      </div>
                      {onDeleteItem && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteItem(item.id);
                          }}
                          className="shrink-0 p-1 text-stone-300 transition-colors hover:text-red-500"
                          title="Remove signal"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}

                {/* Already used items */}
                {usedList.length > 0 && (
                  <div className="border-t border-dashed border-stone-200">
                    <button
                      onClick={() => setShowUsed((v) => !v)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-500 hover:bg-stone-50"
                    >
                      {showUsed ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <CheckCircle2 size={12} className="text-green-500" />
                      <span className="font-medium">Already used in timesheet</span>
                      <span className="text-stone-400">({usedList.length})</span>
                    </button>
                    {showUsed && (
                      <div>
                        {usedList.map((item) => {
                          const flatIdx = flatIds.indexOf(item.id);
                          const focused = focusedIndex === flatIdx;
                          return (
                            <div
                              key={item.id}
                              ref={(el) => {
                                if (el) rowRefs.current.set(item.id, el);
                              }}
                              onClick={() => onFocusIndex(flatIdx)}
                              draggable={!isMobile}
                              onDragStart={(event) => {
                                event.dataTransfer.setData('text/daykeeper-item', item.id);
                                event.dataTransfer.effectAllowed = 'move';
                              }}
                              className={`flex items-start gap-3 px-3 py-1.5 opacity-60 transition-colors duration-150 ${
                                focused ? 'bg-accent-50' : 'hover:bg-stone-50'
                              }`}
                            >
                              <div className="mt-0.5 shrink-0">
                                <CheckCircle2 size={14} className="text-green-500" />
                              </div>
                              {item.provider === 'email' && (
                                <div className="mt-0.5 shrink-0">
                                  {item.meta.direction === 'outgoing' ? (
                                    <ArrowUpRight size={14} className="text-blue-400" />
                                  ) : (
                                    <ArrowDownLeft size={14} className="text-emerald-400" />
                                  )}
                                </div>
                              )}
                              <div className="w-28 shrink-0 font-mono text-xs text-stone-400">
                                {item.endTimestamp
                                  ? formatTimeRange(item.timestamp, item.endTimestamp, timezone)
                                  : formatTime(item.timestamp, timezone)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm text-stone-500">{item.summary}</p>
                                <p className="truncate text-xs text-stone-400">{renderSubline(item)}</p>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-0.5 text-right text-xs text-stone-400">
                                <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                  Already used
                                </span>
                                {item.endTimestamp ? (
                                  <span>{formatMinutes(minutesBetween(item.timestamp, item.endTimestamp, timezone))}</span>
                                ) : item.durationMinutes ? (
                                  <span>{formatMinutes(item.durationMinutes)}</span>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {briefItems.length > 0 && (() => {
        const briefCollapsed = collapsedSections.has('__brief' as Provider);
        const allBriefSelected = briefItems.every((item) => selectedIds.has(item.id));
        return (
          <div className="border-t border-dashed border-stone-200 bg-stone-50/50">
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-stone-500">
              <button
                onClick={() => onToggleSection('__brief' as Provider)}
                className="flex items-center gap-2 hover:text-stone-800"
                aria-label={briefCollapsed ? 'Expand quick activities' : 'Collapse quick activities'}
              >
                {briefCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <Zap size={12} className="text-amber-500" />
                <span className="font-medium">Quick activities</span>
                <span className="text-stone-400">({briefItems.length} · &lt;10 min each)</span>
              </button>
              <button
                onClick={() => {
                  briefItems.forEach((item) => {
                    if (selectedIds.has(item.id) === allBriefSelected) onToggle(item.id);
                  });
                }}
                className="ml-auto text-xs text-stone-500 hover:text-stone-800"
              >
                {allBriefSelected ? 'Clear' : 'Select all'}
              </button>
            </div>
            {!briefCollapsed && (
              <div className="bg-white/40">
                {briefItems.map((item) => {
                  const selected = selectedIds.has(item.id);
                  const flatIdx = flatIds.indexOf(item.id);
                  return (
                    <div
                      key={item.id}
                      ref={(el) => { if (el) rowRefs.current.set(item.id, el); }}
                      onClick={() => { onToggle(item.id); onFocusIndex(flatIdx); }}
                      className={`flex items-center gap-2 px-3 py-1 text-xs transition-colors duration-150 ${selected ? 'bg-stone-100' : 'hover:bg-stone-50'}`}
                    >
                      <span className="w-16 shrink-0 font-mono text-[10px] text-stone-400">{formatTime(item.timestamp, timezone)}</span>
                      <span className="min-w-0 flex-1 truncate text-stone-600">{item.summary}</span>
                      <span className="shrink-0 text-[10px] text-stone-400">
                        {item.endTimestamp ? formatMinutes(minutesBetween(item.timestamp, item.endTimestamp, timezone)) : item.durationMinutes ? formatMinutes(item.durationMinutes) : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function renderSubline(item: ActivityItem): string {
  const m = item.meta;
  switch (item.provider) {
    case 'email':
      return [
        m.direction === 'outgoing' ? 'to' : 'from',
        m.direction === 'outgoing' ? m.recipient : m.sender,
        m.wordCount ? `${m.wordCount} words` : '',
      ].filter(Boolean).join(' ');
    case 'calendar':
      return `${m.attendeeCount} attendee${(m.attendeeCount ?? 0) === 1 ? '' : 's'}`;
    case 'chat':
      return `${m.messageCount} messages`;
    case 'documents':
      return `${m.revisionCount} revision${(m.revisionCount ?? 0) === 1 ? '' : 's'}`;
    case 'custom':
      return [m.sender, m.subject, m.channel, m.fileName, m.title].filter(Boolean).join(' · ') || 'Custom connector';
    case 'singlecase':
      if (m.scActivityKind === 'document') {
        return [
          m.caseIdVisible ?? m.caseName,
          m.wordCount ? `${m.wordCount} words` : '',
          `${m.revisionCount} revision${(m.revisionCount ?? 0) === 1 ? '' : 's'}`,
        ].filter(Boolean).join(' · ');
      }
      return m.caseIdVisible ?? m.caseName ?? '';
    default:
      return '';
  }
}
