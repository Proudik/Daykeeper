import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { AlertCircle, AlertTriangle, Info, Search, Download } from 'lucide-react';
import type { OrgRole } from '@/types';

interface LogRow {
  id: string;
  user_id: string;
  action: string;
  provider: string | null;
  occurred_at: string;
  detail: string | null;
  level: string;
}

interface MemberInfo {
  user_id: string;
  email: string;
  display_name: string | null;
}

type LevelFilter = 'all' | 'error' | 'warning' | 'info';

export function AdminLogsPage() {
  const { profile } = useAuth();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [members, setMembers] = useState<Map<string, MemberInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!profile?.org_id || profile.org_role !== 'admin') return;
    async function load() {
      setLoading(true);

      // Load org members for name/email lookup
      const { data: memberRows } = await supabase
        .from('organization_members')
        .select('user_id, role')
        .eq('org_id', profile!.org_id!);

      const memberMap = new Map<string, MemberInfo>();
      if (memberRows && memberRows.length > 0) {
        const userIds = memberRows.map((m: { user_id: string }) => m.user_id);
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('user_id, display_name')
          .in('user_id', userIds);

        const { data: userRows } = await supabase.auth.admin.listUsers();
        const emailMap = new Map<string, string>();
        for (const u of userRows?.users ?? []) {
          emailMap.set(u.id, u.email ?? '');
        }

        for (const m of memberRows) {
          const p = profileRows?.find((p: { user_id: string }) => p.user_id === m.user_id);
          memberMap.set(m.user_id, {
            user_id: m.user_id,
            email: emailMap.get(m.user_id) ?? '',
            display_name: (p as { display_name: string | null } | undefined)?.display_name ?? null,
          });
        }
      }
      setMembers(memberMap);

      // Load all logs for this org
      const { data: logRows } = await supabase
        .from('audit_log')
        .select('id, user_id, action, provider, occurred_at, detail, level')
        .eq('org_id', profile!.org_id!)
        .order('occurred_at', { ascending: false })
        .limit(500);

      setLogs((logRows as LogRow[]) ?? []);
      setLoading(false);
    }
    load();
  }, [profile]);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (levelFilter !== 'all' && l.level !== levelFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const member = members.get(l.user_id);
        const haystack = [
          l.action,
          l.detail ?? '',
          l.provider ?? '',
          member?.email ?? '',
          member?.display_name ?? '',
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [logs, levelFilter, search, members]);

  function memberLabel(userId: string): string {
    const m = members.get(userId);
    return m?.display_name ?? m?.email ?? userId.slice(0, 8);
  }

  function exportCsv() {
    const rows = [
      ['Time', 'User', 'Level', 'Action', 'Provider', 'Detail'],
      ...filtered.map((l) => [
        new Date(l.occurred_at).toISOString(),
        memberLabel(l.user_id),
        l.level,
        l.action,
        l.provider ?? '',
        (l.detail ?? '').replace(/\n/g, ' '),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daykeeper-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const errorCount = logs.filter((l) => l.level === 'error').length;
  const warningCount = logs.filter((l) => l.level === 'warning').length;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-stone-400">Loading logs...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Organization Logs</h1>
          <p className="mt-1 text-sm text-stone-500">
            All activity and error logs from every member of your organization.
          </p>
        </div>
        <button onClick={exportCsv} className="btn-secondary text-sm">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <div className="text-2xl font-semibold text-stone-900">{logs.length}</div>
          <div className="text-xs text-stone-500">Total entries</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-2xl font-semibold text-red-600">
            <AlertCircle size={20} /> {errorCount}
          </div>
          <div className="text-xs text-stone-500">Errors / crashes</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-2xl font-semibold text-amber-600">
            <AlertTriangle size={20} /> {warningCount}
          </div>
          <div className="text-xs text-stone-500">Warnings</div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {(['all', 'error', 'warning', 'info'] as LevelFilter[]).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLevelFilter(lvl)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                levelFilter === lvl
                  ? 'border-accent-500 bg-accent-50 text-accent-800'
                  : 'border-stone-300 text-stone-600 hover:bg-stone-50'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            className="input pl-9"
            placeholder="Search by user, action, or detail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Log table */}
      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm text-stone-400">No log entries match your filters.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="max-h-[calc(100vh-380px)] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
                  <th className="px-4 py-2.5 text-left font-medium">Time</th>
                  <th className="px-4 py-2.5 text-left font-medium">User</th>
                  <th className="px-4 py-2.5 text-left font-medium">Level</th>
                  <th className="px-4 py-2.5 text-left font-medium">Action</th>
                  <th className="px-4 py-2.5 text-left font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-stone-500">
                      {new Date(l.occurred_at).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-stone-800">
                      {memberLabel(l.user_id)}
                    </td>
                    <td className="px-4 py-2.5">
                      <LevelBadge level={l.level} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-stone-700">
                      {l.action}
                      {l.provider && (
                        <span className="ml-1.5 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">
                          {l.provider}
                        </span>
                      )}
                    </td>
                    <td className="max-w-md px-4 py-2.5">
                      {l.detail ? (
                        <pre className="whitespace-pre-wrap break-words font-sans text-xs text-stone-500 line-clamp-3">
                          {l.detail}
                        </pre>
                      ) : (
                        <span className="text-xs text-stone-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function LevelBadge({ level }: { level: string }) {
  if (level === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
        <AlertCircle size={11} /> Error
      </span>
    );
  }
  if (level === 'warning') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
        <AlertTriangle size={11} /> Warning
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-500">
      <Info size={11} /> Info
    </span>
  );
}
