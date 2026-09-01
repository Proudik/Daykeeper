import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { todayLocal, shiftDate } from '@/lib/time';
import type { Provider } from '@/types';

const PROVIDER_DOT_COLORS: Record<Provider, string> = {
  email: '#2563eb',
  calendar: '#dc2626',
  chat: '#059669',
  documents: '#7c3aed',
  singlecase: '#0891b2',
  browser: '#0d9488',
  custom: '#ea580c',
};

const PROVIDER_ORDER: Provider[] = ['email', 'calendar', 'chat', 'documents'];

interface DayDots {
  providers: Set<Provider>;
  hasTimesheet: boolean;
  totalMinutes: number;
}

interface MonthCalendarProps {
  selectedDate: string;
  onDateChange: (d: string) => void;
  onClose: () => void;
}

export function MonthCalendar({ selectedDate, onDateChange, onClose }: MonthCalendarProps) {
  const { profile } = useAuth();
  const [viewYear, setViewYear] = useState(() => new Date(selectedDate + 'T00:00:00').getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date(selectedDate + 'T00:00:00').getMonth());
  const [dayDots, setDayDots] = useState<Map<string, DayDots>>(new Map());
  const [loading, setLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load activity summaries for the visible month
  const loadMonthData = useCallback(async () => {
    if (!profile?.user_id) return;
    setLoading(true);

    const monthStart = new Date(viewYear, viewMonth, 1);
    const monthEnd = new Date(viewYear, viewMonth + 1, 0);
    const startStr = monthStart.toISOString().slice(0, 10);
    const endStr = monthEnd.toISOString().slice(0, 10);

    const { data } = await supabase
      .from('day_activity_summary')
      .select('work_date, providers, item_count')
      .eq('user_id', profile.user_id)
      .gte('work_date', startStr)
      .lte('work_date', endStr);

    const dots = new Map<string, DayDots>();
    for (const row of data ?? []) {
      const r = row as { work_date: string; providers: Provider[]; item_count: number };
      const providers = new Set<Provider>((r.providers ?? []).filter((p) => p !== 'singlecase'));
      dots.set(r.work_date, {
        providers,
        hasTimesheet: false,
        totalMinutes: r.item_count ?? 0,
      });
    }

    setDayDots(dots);
    setLoading(false);
  }, [profile?.user_id, viewYear, viewMonth]);

  useEffect(() => {
    loadMonthData();
  }, [loadMonthData]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const today = todayLocal();
  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay = new Date(viewYear, viewMonth + 1, 0);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Mon = 0
  const daysInMonth = lastDay.getDate();

  // Build calendar cells: leading blanks + days
  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push(dateStr);
  }

  const monthName = firstDay.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  }

  function handleDayClick(dateStr: string) {
    onDateChange(dateStr);
    onClose();
  }

  const todayDate = new Date();
  const canGoNext = viewYear < todayDate.getFullYear() ||
    (viewYear === todayDate.getFullYear() && viewMonth < todayDate.getMonth());

  return (
    <div
      ref={panelRef}
      className="absolute left-0 top-full z-50 mt-2 w-[340px] rounded-xl border border-stone-200 bg-white shadow-2xl animate-scale-in"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
        <button onClick={prevMonth} className="btn-ghost px-1.5 py-1" aria-label="Previous month">
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-semibold text-stone-900">{monthName}</span>
        <button
          onClick={nextMonth}
          disabled={!canGoNext}
          className="btn-ghost px-1.5 py-1 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Next month"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Weekday labels */}
      <div className="grid grid-cols-7 px-3 pt-2 pb-1">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="text-center text-[10px] font-medium uppercase tracking-wide text-stone-400">
            {d.slice(0, 2)}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 px-3 pb-3 gap-y-1">
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={`blank-${i}`} />;

          const isSelected = dateStr === selectedDate;
          const isToday = dateStr === today;
          const isFuture = dateStr > today;
          const dots = dayDots.get(dateStr);
          const providers = dots ? PROVIDER_ORDER.filter((p) => dots.providers.has(p)) : [];

          return (
            <button
              key={dateStr}
              onClick={() => handleDayClick(dateStr)}
              disabled={isFuture}
              className={`
                relative flex flex-col items-center justify-center rounded-lg py-1.5 text-sm transition-all
                ${isSelected
                  ? 'bg-accent-600 text-white font-semibold shadow-sm'
                  : isToday
                    ? 'bg-accent-50 text-accent-800 font-medium ring-1 ring-accent-200'
                    : isFuture
                      ? 'text-stone-300 cursor-not-allowed'
                      : 'text-stone-700 hover:bg-stone-100'
                }
              `}
            >
              <span>{parseInt(dateStr.slice(8), 10)}</span>

              {/* Provider dots */}
              {providers.length > 0 && (
                <div className="mt-0.5 flex items-center gap-0.5">
                  {providers.slice(0, 4).map((p) => (
                    <span
                      key={p}
                      className="block h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor: isSelected ? 'rgba(255,255,255,0.9)' : PROVIDER_DOT_COLORS[p],
                      }}
                    />
                  ))}
                  {providers.length > 4 && (
                    <span
                      className="text-[8px] font-medium leading-none"
                      style={{ color: isSelected ? 'rgba(255,255,255,0.8)' : '#a8a29e' }}
                    >
                      +{providers.length - 4}
                    </span>
                  )}
                </div>
              )}

              {/* Today indicator for days without dots */}
              {isToday && providers.length === 0 && !isSelected && (
                <div className="mt-0.5 h-1.5 w-1.5 rounded-full bg-accent-300" />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="border-t border-stone-100 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {PROVIDER_ORDER.map((p) => (
            <div key={p} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PROVIDER_DOT_COLORS[p] }} />
              <span className="text-[10px] capitalize text-stone-500">{p}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
