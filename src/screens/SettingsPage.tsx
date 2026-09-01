import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type {
  ActivityTypeOption,
  ExclusionRule,
  ExclusionRuleType,
  Matter,
  MatterRule,
  MatterRuleType,
  OutputLanguage,
  RoundingMinutes,
  OrgRole,
} from '@/types';
import { Plus, Trash2, AlertTriangle, Zap, ShieldCheck, ShieldAlert, Users, Mail, Briefcase, ArrowRight } from 'lucide-react';

const TIMEZONES = [
  'Europe/Prague',
  'Europe/Bratislava',
  'Europe/Vienna',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'UTC',
];

export function SettingsPage() {
  const { user, profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [timezone, setTimezone] = useState(profile?.timezone ?? 'Europe/Prague');
  const [workStart, setWorkStart] = useState(profile?.working_hours_start ?? '08:30');
  const [workEnd, setWorkEnd] = useState(profile?.working_hours_end ?? '18:00');
  const [rounding, setRounding] = useState<RoundingMinutes>(profile?.rounding_minutes ?? 15);
  const [targetHours, setTargetHours] = useState(profile?.target_hours ?? 8);
  const [language, setLanguage] = useState<OutputLanguage>(profile?.output_language ?? 'en');

  const [activityTypes, setActivityTypes] = useState<ActivityTypeOption[]>([]);
  const [newType, setNewType] = useState('');

  const [exclusionRules, setExclusionRules] = useState<ExclusionRule[]>([]);
  const [newRuleValue, setNewRuleValue] = useState('');
  const [newRuleType, setNewRuleType] = useState<ExclusionRuleType>('email_domain');

  const [matterRules, setMatterRules] = useState<MatterRule[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);

  const [orgMembers, setOrgMembers] = useState<{ user_id: string; role: OrgRole; email: string; display_name: string | null }[]>([]);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const [{ data: types }, { data: rules }] = await Promise.all([
        supabase.from('activity_type_options').select('*').eq('user_id', user!.id).order('sort_order'),
        supabase.from('exclusion_rules').select('*').eq('user_id', user!.id),
      ]);
      setActivityTypes((types as ActivityTypeOption[]) ?? []);
      setExclusionRules((rules as ExclusionRule[]) ?? []);
      const [mRulesRes, mattersRes] = await Promise.all([
        supabase.from('matter_rules').select('*').eq('user_id', user!.id),
        supabase.from('matters').select('*'),
      ]);
      setMatterRules((mRulesRes.data as MatterRule[]) ?? []);
      setMatters((mattersRes.data as Matter[]) ?? []);

      // Load org members if admin
      if (profile?.org_role === 'admin') {
        const { data: memberRows } = await supabase
          .from('organization_members')
          .select('user_id, role, org_id')
          .eq('org_id', profile.org_id ?? '');

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

          const combined = memberRows.map((m: { user_id: string; role: string }) => {
            const p = profileRows?.find((p: { user_id: string }) => p.user_id === m.user_id);
            return {
              user_id: m.user_id,
              role: m.role as OrgRole,
              email: emailMap.get(m.user_id) ?? '',
              display_name: (p as { display_name: string | null } | undefined)?.display_name ?? null,
            };
          });
          setOrgMembers(combined);
        }

        const { data: org } = await supabase
          .from('organizations')
          .select('name')
          .eq('id', profile.org_id ?? '')
          .maybeSingle();
        setOrgName(org?.name ?? null);
      }
    }
    load();
  }, [user]);

  async function saveProfile() {
    setSavingProfile(true);
    const { error } = await supabase
      .from('profiles')
      .upsert(
        {
          user_id: user!.id,
          display_name: displayName || null,
          timezone,
          working_hours_start: workStart,
          working_hours_end: workEnd,
          rounding_minutes: rounding,
          target_hours: targetHours,
          output_language: language,
          onboarded: true,
          demo_mode: profile?.demo_mode ?? false,
        },
        { onConflict: 'user_id' },
      );
    if (!error) {
      await refreshProfile();
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    }
    setSavingProfile(false);
  }

  async function addActivityType() {
    if (!newType.trim()) return;
    const { data } = await supabase
      .from('activity_type_options')
      .insert({ user_id: user!.id, label: newType.trim(), sort_order: activityTypes.length })
      .select('*')
      .single();
    if (data) setActivityTypes([...activityTypes, data as ActivityTypeOption]);
    setNewType('');
  }

  async function deleteActivityType(id: string) {
    await supabase.from('activity_type_options').delete().eq('id', id);
    setActivityTypes(activityTypes.filter((t) => t.id !== id));
  }

  async function addExclusionRule() {
    if (!newRuleValue.trim()) return;
    const { data } = await supabase
      .from('exclusion_rules')
      .insert({ user_id: user!.id, rule_type: newRuleType, value: newRuleValue.trim() })
      .select('*')
      .single();
    if (data) setExclusionRules([...exclusionRules, data as ExclusionRule]);
    setNewRuleValue('');
  }

  async function deleteExclusionRule(id: string) {
    await supabase.from('exclusion_rules').delete().eq('id', id);
    setExclusionRules(exclusionRules.filter((r) => r.id !== id));
  }

  async function deleteMatterRule(id: string) {
    await supabase.from('matter_rules').delete().eq('id', id);
    setMatterRules(matterRules.filter((r) => r.id !== id));
  }

  async function toggleMemberRole(memberUserId: string, currentRole: OrgRole) {
    const newRole: OrgRole = currentRole === 'admin' ? 'member' : 'admin';
    setMemberBusy(memberUserId);
    const { error } = await supabase
      .from('organization_members')
      .update({ role: newRole })
      .eq('user_id', memberUserId);
    if (!error) {
      setOrgMembers(orgMembers.map((m) =>
        m.user_id === memberUserId ? { ...m, role: newRole } : m
      ));
    }
    setMemberBusy(null);
  }

  async function disconnectAll() {
    if (!confirm('This will disconnect all apps and delete all stored connection data. Your timesheets will be kept. Continue?')) return;
    await supabase.from('connections').delete().eq('user_id', user!.id);
    await supabase.from('audit_log').insert({
      action: 'disconnect_all',
      detail: 'Disconnected all apps and deleted stored tokens',
    });
    alert('All apps disconnected.');
  }

  async function deleteAccount() {
    const confirmed = confirm(
      'This will PERMANENTLY delete your account, all connections, all timesheets, and all settings. This cannot be undone. Type DELETE in the next prompt to confirm.',
    );
    if (!confirmed) return;
    const text = prompt('Type DELETE to confirm permanent account deletion:');
    if (text !== 'DELETE') {
      alert('Cancelled — account was not deleted.');
      return;
    }
    // Delete all user data via cascade, then sign out
    await supabase.from('audit_log').insert({ action: 'delete_account', detail: 'User initiated account deletion' });
    await supabase.from('timesheet_entries').delete().eq('user_id', user!.id);
    await supabase.from('timesheets').delete().eq('user_id', user!.id);
    await supabase.from('connections').delete().eq('user_id', user!.id);
    await supabase.from('activity_type_options').delete().eq('user_id', user!.id);
    await supabase.from('exclusion_rules').delete().eq('user_id', user!.id);
    await supabase.from('profiles').delete().eq('user_id', user!.id);
    await supabase.auth.signOut();
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-stone-900">Settings</h1>

      {/* Profile section */}
      <section className="card mb-6 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500">
          Profile
        </h2>
        <div className="space-y-4">
          <div>
            <label className="label">Logged in as</label>
            <div className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
              <Mail size={14} className="text-stone-400" />
              {user?.email ?? 'Unknown'}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="name">Display name</label>
            <input id="name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="tz">Timezone</label>
            <select id="tz" className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="ws">Working hours start</label>
              <input id="ws" type="time" className="input" value={workStart} onChange={(e) => setWorkStart(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="we">Working hours end</label>
              <input id="we" type="time" className="input" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} />
            </div>
          </div>
        </div>
      </section>

      {/* Billing preferences */}
      <section className="card mb-6 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500">
          Billing preferences
        </h2>
        <div className="space-y-4">
          <div>
            <label className="label">Time rounding increment</label>
            <div className="flex gap-2">
              {([0, 6, 15] as const).map((val) => (
                <button
                  key={val}
                  onClick={() => setRounding(val)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                    rounding === val
                      ? 'border-accent-600 bg-accent-50 text-accent-800'
                      : 'border-stone-300 text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {val === 0 ? 'Exact' : `${val} min`}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="target">Target billable hours per day</label>
            <input
              id="target"
              type="number"
              min={0}
              max={24}
              step={0.25}
              className="input"
              value={targetHours}
              onChange={(e) => setTargetHours(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Output language</label>
            <div className="flex gap-2">
              {([['en', 'English'], ['cs', 'Czech']] as const).map(([val, lbl]) => (
                <button
                  key={val}
                  onClick={() => setLanguage(val)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                    language === val
                      ? 'border-accent-600 bg-accent-50 text-accent-800'
                      : 'border-stone-300 text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={saveProfile} disabled={savingProfile} className="btn-primary">
            {savingProfile ? 'Saving...' : 'Save profile'}
          </button>
          {savedMsg && <span className="text-sm text-accent-700">Saved</span>}
        </div>
      </section>

      {/* Activity type taxonomy */}
      <section className="card mb-6 p-5">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">
          Activity type taxonomy
        </h2>
        <p className="mb-4 text-xs text-stone-400">
          The categories the AI uses to label each timesheet entry (e.g. Legal research, Client meeting, Document drafting). Add or remove options to match how your firm bills work — the AI will only choose from this list.
        </p>
        <div className="space-y-2">
          {activityTypes.map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <span className="flex-1 text-sm text-stone-800">{t.label}</span>
              <button onClick={() => deleteActivityType(t.id)} className="btn-ghost px-1.5 py-1 text-stone-400 hover:text-red-700">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            className="input"
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            placeholder="Add activity type..."
            onKeyDown={(e) => e.key === 'Enter' && addActivityType()}
          />
          <button onClick={addActivityType} className="btn-secondary">
            <Plus size={16} /> Add
          </button>
        </div>
      </section>

      {/* Exclusion rules */}
      <section className="card mb-6 p-5">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">
          Exclusion rules
        </h2>
        <p className="mb-4 text-xs text-stone-400">
          Activity matching these rules is automatically ignored.
        </p>
        <div className="space-y-2">
          {exclusionRules.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">
                {r.rule_type.replace('_', ' ')}
              </span>
              <span className="flex-1 text-sm text-stone-800">{r.value}</span>
              <button onClick={() => deleteExclusionRule(r.id)} className="btn-ghost px-1.5 py-1 text-stone-400 hover:text-red-700">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            className="input w-full sm:w-40"
            value={newRuleType}
            onChange={(e) => setNewRuleType(e.target.value as ExclusionRuleType)}
          >
            <option value="email_domain">Email domain</option>
            <option value="chat_channel">Chat channel</option>
            <option value="calendar_keyword">Calendar keyword</option>
          </select>
          <input
            className="input"
            value={newRuleValue}
            onChange={(e) => setNewRuleValue(e.target.value)}
            placeholder="e.g. newsletter.com"
            onKeyDown={(e) => e.key === 'Enter' && addExclusionRule()}
          />
          <button onClick={addExclusionRule} className="btn-secondary">
            <Plus size={16} />
          </button>
        </div>
      </section>

      {/* Attribution rules */}
      <section className="card mb-6 p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
          <Zap size={14} /> Attribution rules
        </h2>
        <p className="mb-4 text-xs text-stone-400">
          When new activity comes in, any keyword or email domain listed here automatically gets assigned to its matter — no manual review needed. You create rules from the day view by typing a keyword when assigning, or they appear here once created. Wrong rules can be deleted anytime.
        </p>
        {matterRules.length === 0 ? (
          <div className="rounded-md border border-dashed border-stone-200 px-4 py-6 text-center">
            <p className="text-sm text-stone-400">No rules yet.</p>
            <p className="mt-1 text-xs text-stone-400">
              Assign an activity in the day view and type a keyword — it will show up here.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {matterRules.map((r) => {
              const matter = matters.find((m) => m.id === r.matter_id);
              return (
                <div key={r.id} className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2">
                  <span className="shrink-0 rounded bg-accent-50 px-1.5 py-0.5 text-xs text-accent-700">
                    {r.rule_type.replace(/_/g, ' ')}
                  </span>
                  <span className="shrink-0 font-mono text-sm font-medium text-stone-800">{r.value}</span>
                  <ArrowRight size={12} className="shrink-0 text-stone-300" />
                  <Briefcase size={12} className="shrink-0 text-stone-400" />
                  <span className="min-w-0 flex-1 truncate text-sm text-stone-600">
                    {matter ? (matter.case_id_visible ?? matter.name) : 'Unknown matter'}
                  </span>
                  {r.hit_count > 0 && (
                    <span className="shrink-0 text-xs text-stone-400">
                      {r.hit_count} {r.hit_count === 1 ? 'hit' : 'hits'}
                    </span>
                  )}
                  <button
                    onClick={() => deleteMatterRule(r.id)}
                    className="btn-ghost shrink-0 px-1.5 py-1 text-stone-400 hover:text-red-700"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Organization management (admin only) */}
      {profile?.org_role === 'admin' && (
        <section className="card p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-700">
            <Users size={14} /> Organization
          </h2>
          <p className="mb-4 text-xs text-stone-500">
            {orgName ?? 'Your organization'} — manage members and their roles.
          </p>
          <div className="overflow-hidden rounded-md border border-stone-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
                  <th className="px-3 py-2 text-left font-medium">Member</th>
                  <th className="px-3 py-2 text-left font-medium">Role</th>
                  <th className="px-3 py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {orgMembers.map((m) => (
                  <tr key={m.user_id} className="border-b border-stone-100 last:border-0">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-stone-800">
                        {m.display_name ?? m.email}
                      </div>
                      {m.display_name && (
                        <div className="text-xs text-stone-400">{m.email}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {m.role === 'admin' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-700">
                          <ShieldCheck size={12} /> Admin
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-stone-500">
                          <ShieldAlert size={12} /> Member
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => toggleMemberRole(m.user_id, m.role)}
                        disabled={memberBusy === m.user_id || (m.role === 'admin' && orgMembers.filter((x) => x.role === 'admin').length <= 1)}
                        className="btn-secondary text-xs disabled:opacity-40"
                      >
                        {memberBusy === m.user_id ? '…' : m.role === 'admin' ? 'Demote' : 'Promote'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {orgMembers.filter((m) => m.role === 'admin').length <= 1 && (
            <p className="mt-2 text-xs text-stone-400">
              An organization must have at least one admin.
            </p>
          )}
        </section>
      )}

      {/* Privacy / destructive */}
      <section className="card border-red-200 p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-red-700">
          <AlertTriangle size={14} /> Privacy & data
        </h2>
        <p className="mb-4 text-xs text-stone-500">
          These actions are permanent and cannot be undone.
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border border-stone-200 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-stone-800">Disconnect all apps and delete stored tokens</p>
              <p className="text-xs text-stone-400">Keeps your timesheets and settings.</p>
            </div>
            <button onClick={disconnectAll} className="btn-secondary text-sm">Disconnect all</button>
          </div>
          <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-red-800">Delete my account and all data</p>
              <p className="text-xs text-red-500">Permanently removes everything.</p>
            </div>
            <button onClick={deleteAccount} className="btn-danger text-sm">Delete account</button>
          </div>
        </div>
      </section>
    </div>
  );
}
