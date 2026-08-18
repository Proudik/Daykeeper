import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Timesheet, TimesheetEntry, Matter } from '@/types';
import { formatMinutes, formatHours, formatLongDate } from '@/lib/time';
import { getClientName } from '@/lib/attribution/resolver-data';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Calendar,
  Inbox,
  Mail,
  MessageSquare,
  Copy,
  Trash2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface SavedTimesheet extends Timesheet {
  entries: TimesheetEntry[];
}

export function SavedTimesheetsPage() {
  const { profile } = useAuth();
  const [timesheets, setTimesheets] = useState<SavedTimesheet[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!profile?.user_id) return;
    setLoading(true);
    setError(null);
    try {
      const [tsRes, mattersRes, clientsRes] = await Promise.all([
        supabase
          .from('timesheets')
          .select('*')
          .eq('user_id', profile.user_id)
          .order('work_date', { ascending: false }),
        supabase.from('matters').select('*').eq('org_id', profile.org_id ?? ''),
        supabase.from('clients').select('id, name').eq('org_id', profile.org_id ?? ''),
      ]);

      if (tsRes.error) throw tsRes.error;
      const tsRows = (tsRes.data ?? []) as Timesheet[];

      let entryRows: TimesheetEntry[] = [];
      if (tsRows.length > 0) {
        const { data: entries, error: entryErr } = await supabase
          .from('timesheet_entries')
          .select('*')
          .in(
            'timesheet_id',
            tsRows.map((t) => t.id),
          )
          .order('sort_order', { ascending: true });
        if (entryErr) throw entryErr;
        entryRows = (entries ?? []) as TimesheetEntry[];
      }

      const grouped = tsRows.map((ts) => ({
        ...ts,
        entries: entryRows.filter((e) => e.timesheet_id === ts.id),
      }));

      setTimesheets(grouped);
      setMatters((mattersRes.data ?? []) as Matter[]);
      setClients((clientsRes.data ?? []) as { id: string; name: string }[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load timesheets');
    } finally {
      setLoading(false);
    }
  }, [profile?.user_id, profile?.org_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete(tsId: string) {
    const { error: delErr } = await supabase.from('timesheets').delete().eq('id', tsId);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    setTimesheets((prev) => prev.filter((t) => t.id !== tsId));
  }

  function copyAsText(ts: SavedTimesheet) {
    const text = ts.entries
      .map(
        (e, i) =>
          `${i + 1}. ${formatMinutes(e.confirmed_minutes)} — ${e.activity_type ?? 'General'}\n   ${e.description}`,
      )
      .join('\n\n');
    navigator.clipboard.writeText(text);
    setCopiedId(ts.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-stone-400">Loading saved timesheets...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-stone-900">Saved Timesheets</h1>
        <p className="mt-1 text-sm text-stone-500">
          {timesheets.length} saved {timesheets.length === 1 ? 'timesheet' : 'timesheets'}
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertCircle size={16} className="text-red-600" />
          {error}
        </div>
      )}

      {timesheets.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-white py-16">
          <Inbox size={32} className="text-stone-300" />
          <p className="mt-3 text-sm text-stone-500">No saved timesheets yet</p>
          <p className="mt-1 text-xs text-stone-400">
            Generate a timesheet from the Day view and press Save to see it here.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {timesheets.map((ts) => {
          const isExpanded = expanded.has(ts.id);
          const totalBillable = ts.entries
            .filter((e) => e.billable)
            .reduce((s, e) => s + e.confirmed_minutes, 0);
          const providerIcons = ts.source_providers.map((p) => {
            switch (p) {
              case 'email': return <Mail key={p} size={12} />;
              case 'calendar': return <Calendar key={p} size={12} />;
              case 'chat': return <MessageSquare key={p} size={12} />;
              case 'documents': return <FileText key={p} size={12} />;
              default: return null;
            }
          });

          return (
            <div
              key={ts.id}
              className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              {/* Header row */}
              <button
                onClick={() => toggleExpanded(ts.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-stone-50"
              >
                {isExpanded ? <ChevronDown size={16} className="text-stone-400" /> : <ChevronRight size={16} className="text-stone-400" />}
                <Calendar size={14} className="text-stone-400" />
                <span className="text-sm font-medium text-stone-800">{formatLongDate(ts.work_date)}</span>
                <span className="text-xs text-stone-400">{ts.entries.length} entries</span>
                <div className="ml-auto flex items-center gap-3">
                  <div className="flex items-center gap-1 text-stone-400">
                    {providerIcons}
                  </div>
                  <span className="flex items-center gap-1 text-sm font-semibold text-stone-700">
                    <Clock size={12} className="text-stone-400" />
                    {formatHours(totalBillable)}
                  </span>
                  {ts.status === 'final' ? (
                    <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      <CheckCircle2 size={10} /> Final
                    </span>
                  ) : (
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                      Draft
                    </span>
                  )}
                </div>
              </button>

              {/* Expanded entries */}
              {isExpanded && (
                <div className="border-t border-stone-100 bg-stone-50">
                  <div className="space-y-2 px-4 py-3">
                    {ts.entries.map((entry, i) => {
                      const matter = entry.matter_id ? matters.find((m) => m.id === entry.matter_id) : null;
                      const clientName = matter ? getClientName(matter.client_external_id, clients) : null;
                      return (
                        <div key={entry.id} className="rounded-md border border-stone-200 bg-white px-3 py-2">
                          <div className="flex items-start gap-2">
                            <span className="mt-0.5 text-xs font-medium text-stone-400">
                              {String(i + 1).padStart(2, '0')}
                            </span>
                            <div className="flex-1">
                              <div className="mb-1 flex items-center gap-2">
                                <span className="text-xs font-medium text-stone-600">
                                  {formatMinutes(entry.confirmed_minutes)}
                                </span>
                                {entry.activity_type && (
                                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">
                                    {entry.activity_type}
                                  </span>
                                )}
                                {entry.billable ? (
                                  <span className="text-xs text-accent-600">Billable</span>
                                ) : (
                                  <span className="text-xs text-stone-400">Non-billable</span>
                                )}
                                {matter && (
                                  <span className="text-xs text-stone-500">
                                    {matter.case_id_visible ?? matter.name}
                                  </span>
                                )}
                                {clientName && (
                                  <span className="text-xs text-stone-400">{clientName}</span>
                                )}
                              </div>
                              <p className="text-sm text-stone-800">{entry.description}</p>
                              {entry.source_summary && (
                                <p className="mt-1 text-xs text-stone-400">{entry.source_summary}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 border-t border-stone-100 px-4 py-2">
                    <button
                      onClick={() => copyAsText(ts)}
                      className="btn-ghost text-xs"
                    >
                      <Copy size={12} /> {copiedId === ts.id ? 'Copied!' : 'Copy as text'}
                    </button>
                    <button
                      onClick={() => handleDelete(ts.id)}
                      className="btn-ghost text-xs text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
