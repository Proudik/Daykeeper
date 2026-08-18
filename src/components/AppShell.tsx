import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Link2, Settings as SettingsIcon, LogOut, Clock, FileText, ScrollText, Monitor, PanelLeftClose, PanelLeftOpen, Smartphone } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { formatLongDate, todayLocal, shiftDate } from '@/lib/time';
import { MonthCalendar } from '@/components/MonthCalendar';

export type View = 'day' | 'timesheets' | 'connections' | 'settings' | 'logs' | 'browsers';

interface AppShellProps {
  view: View;
  onViewChange: (v: View) => void;
  selectedDate: string;
  onDateChange: (d: string) => void;
  children: ReactNode;
  topBarRight?: ReactNode;
}

export function AppShell({
  view,
  onViewChange,
  selectedDate,
  onDateChange,
  children,
  topBarRight,
}: AppShellProps) {
  const { profile } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [simulateMobile, setSimulateMobile] = useState(false);

  const navItems: { key: View; label: string; icon: typeof Calendar }[] = [
    { key: 'day', label: 'Day', icon: Clock },
    { key: 'timesheets', label: 'Timesheets', icon: FileText },
    { key: 'connections', label: 'Connections', icon: Link2 },
    { key: 'browsers', label: 'Browsers', icon: Monitor },
    { key: 'settings', label: 'Settings', icon: SettingsIcon },
    ...(profile?.org_role === 'admin' ? [{ key: 'logs' as View, label: 'Logs', icon: ScrollText }] : []),
  ];

  return (
    <div className={`flex h-screen flex-col bg-stone-100 ${simulateMobile ? 'simulate-mobile' : ''}`}>
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-stone-300 bg-white px-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold tracking-tight text-stone-900">
              Daykeeper
            </span>
            {profile?.demo_mode && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                Demo
              </span>
            )}
          </div>

          {/* Date picker — only on day view */}
          {view === 'day' && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onDateChange(shiftDate(selectedDate, -1))}
                className="btn-ghost px-1.5 py-1"
                aria-label="Previous day"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="relative">
                <button
                  onClick={() => setCalOpen((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                    calOpen
                      ? 'border-accent-500 bg-accent-50 text-accent-800'
                      : 'border-stone-300 bg-white text-stone-800 hover:border-stone-400 hover:bg-stone-50'
                  }`}
                >
                  <Calendar size={14} className={calOpen ? 'text-accent-600' : 'text-stone-400'} />
                  {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </button>
                {calOpen && (
                  <MonthCalendar
                    selectedDate={selectedDate}
                    onDateChange={onDateChange}
                    onClose={() => setCalOpen(false)}
                  />
                )}
              </div>
              <button
                onClick={() => onDateChange(shiftDate(selectedDate, 1))}
                disabled={selectedDate >= todayLocal()}
                className="btn-ghost px-1.5 py-1 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Next day"
              >
                <ChevronRight size={18} />
              </button>
              <button
                onClick={() => onDateChange(todayLocal())}
                className="btn-ghost px-2 py-1 text-xs"
              >
                Today
              </button>
              <span className="ml-2 hidden text-sm text-stone-500 sm:inline">
                {formatLongDate(selectedDate)}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {topBarRight}
          <button
            onClick={() => setSimulateMobile((v) => !v)}
            className={`btn-ghost px-1.5 py-1 ${simulateMobile ? 'bg-accent-50 text-accent-700' : ''}`}
            aria-label="Toggle mobile preview"
            title={simulateMobile ? 'Exit mobile preview' : 'Preview mobile view'}
          >
            <Smartphone size={18} />
          </button>
          <div className="hidden text-sm text-stone-600 sm:block">
            {profile?.display_name ?? 'User'}
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            className="btn-ghost px-1.5 py-1"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — desktop only */}
        <nav
          className={`hidden shrink-0 flex-col items-center gap-1 border-r border-stone-300 bg-white py-3 transition-all duration-300 ease-in-out sm:flex sm:items-stretch ${
            sidebarHidden
              ? 'sm:w-12 sm:px-1.5'
              : 'sm:w-48 sm:px-3'
          }`}
        >
          {navItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => {
                onViewChange(key);
                setNavOpen(false);
              }}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 nav-active-indicator ${
                view === key
                  ? 'bg-accent-50 text-accent-800 shadow-sm'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900 hover:translate-x-0.5'
              }`}
              title={label}
            >
              <Icon size={18} className="shrink-0" />
              <span className={`whitespace-nowrap transition-opacity duration-200 ${sidebarHidden ? 'sm:hidden' : 'sm:inline'}`}>{label}</span>
            </button>
          ))}
          <button
            onClick={() => setSidebarHidden((v) => !v)}
            className="mt-auto flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
            title={sidebarHidden ? 'Show menu' : 'Hide menu'}
          >
            {sidebarHidden ? <PanelLeftOpen size={18} className="shrink-0" /> : <PanelLeftClose size={18} className="shrink-0" />}
            <span className={`whitespace-nowrap transition-opacity duration-200 ${sidebarHidden ? 'sm:hidden' : 'sm:inline'}`}>{sidebarHidden ? 'Show' : 'Hide'}</span>
          </button>
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          <div key={view} className="view-transition h-full">
            {children}
          </div>
        </main>
      </div>

      {/* Bottom navigation — mobile only */}
      <nav className="flex shrink-0 items-stretch justify-around border-t border-stone-300 bg-white px-1 py-1 sm:hidden">
        {navItems.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onViewChange(key)}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] font-medium transition-colors ${
              view === key
                ? 'text-accent-700'
                : 'text-stone-400 hover:text-stone-600'
            }`}
          >
            <Icon size={20} className={view === key ? 'text-accent-600' : ''} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
