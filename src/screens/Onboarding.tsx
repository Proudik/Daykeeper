import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { OutputLanguage, RoundingMinutes, Connection, OrgRole } from '@/types';
import {
  Building2,
  CheckCircle2,
  Loader2,
  Mail,
  Users,
  ChevronRight,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';

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

const DEFAULT_ACTIVITY_TYPES = [
  'Legal research',
  'Document drafting',
  'Client meeting',
  'Internal meeting',
  'Correspondence',
  'Court filing',
  'Contract review',
  'Consultation',
];

type OnboardingRole = 'admin' | 'member';
type AdminStep = 'profile' | 'billing' | 'singlecase' | 'invite';
type MemberStep = 'profile' | 'billing' | 'pick_user' | 'connect_microsoft' | 'waiting';
type RoleChoice = 'choosing' | 'admin' | 'member';

export function Onboarding() {
  const { user, profile, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [timezone, setTimezone] = useState(profile?.timezone ?? 'Europe/Prague');
  const [workStart, setWorkStart] = useState(profile?.working_hours_start ?? '08:30');
  const [workEnd, setWorkEnd] = useState(profile?.working_hours_end ?? '18:00');

  const [rounding, setRounding] = useState<RoundingMinutes>(profile?.rounding_minutes ?? 15);
  const [targetHours, setTargetHours] = useState(profile?.target_hours ?? 8);
  const [language, setLanguage] = useState<OutputLanguage>(profile?.output_language ?? 'en');

  // Determine role and org state
  const [orgRole, setOrgRole] = useState<OrgRole | null>(null);
  const [orgSingleCaseConnected, setOrgSingleCaseConnected] = useState(false);
  const [orgSingleCaseWorkspace, setOrgSingleCaseWorkspace] = useState<string | null>(null);

  // Role selection state
  const [roleChoice, setRoleChoice] = useState<RoleChoice>('choosing');
  const [roleSettingUp, setRoleSettingUp] = useState(false);

  // Admin flow state
  const [adminStep, setAdminStep] = useState<AdminStep>('profile');
  const [singleCaseUrl, setSingleCaseUrl] = useState('');
  const [singleCaseToken, setSingleCaseToken] = useState('');
  const [singleCaseValidating, setSingleCaseValidating] = useState(false);
  const [singleCaseValidated, setSingleCaseValidated] = useState<string | null>(null);
  const [singleCaseError, setSingleCaseError] = useState<string | null>(null);
  const [inviteEmails, setInviteEmails] = useState('');

  // Member flow state
  const [memberStep, setMemberStep] = useState<MemberStep>('profile');
  const [singleCaseUsers, setSingleCaseUsers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [selectedSingleCaseUser, setSelectedSingleCaseUser] = useState<string | null>(null);
  const [connectingMicrosoft, setConnectingMicrosoft] = useState(false);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const { data: profileData } = await supabase
        .from('profiles')
        .select('org_role')
        .eq('user_id', user.id)
        .maybeSingle();
      const role = (profileData as { org_role: OrgRole } | null)?.org_role ?? null;
      setOrgRole(role);

      // If user already has a role (e.g. returning to onboarding), skip selection
      if (role === 'admin') {
        setRoleChoice('admin');
      }

      // Check if org has SingleCase connected
      const { data: scConns } = await supabase
        .from('connections')
        .select('*')
        .eq('provider', 'singlecase');
      const allScConns = (scConns as Connection[]) ?? [];
      if (allScConns.length > 0) {
        setOrgSingleCaseConnected(true);
        setOrgSingleCaseWorkspace(allScConns[0].account_label ?? null);
      }

      // For members: load SingleCase user list if org is connected
      if (role === 'member' && allScConns.length > 0) {
        // Simulate loading the firm's SingleCase user list
        setSingleCaseUsers([
          { id: 'sc-u1', name: 'Jan Novák', email: 'novak@novaklaw.cz' },
          { id: 'sc-u2', name: 'Petra Dvořáková', email: 'dvorakova@novaklaw.cz' },
          { id: 'sc-u3', name: 'Tomáš Černý', email: 'cerny@novaklaw.cz' },
          { id: 'sc-u4', name: 'Eva Procházková', email: 'prochazkova@novaklaw.cz' },
        ]);
      }
    }
    load();
  }, [user]);

  const role: OnboardingRole = roleChoice === 'admin' ? 'admin' : 'member';

  async function chooseAdmin() {
    setRoleSettingUp(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('setup_as_admin');
      if (rpcError) throw rpcError;
      await refreshProfile();
      setOrgRole('admin');
      setRoleChoice('admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set up admin role.');
    } finally {
      setRoleSettingUp(false);
    }
  }

  function chooseMember() {
    setRoleChoice('member');
  }

  async function saveProfile() {
    setBusy(true);
    setError(null);
    try {
      const userId = user!.id;
      const payload = {
        user_id: userId,
        display_name: displayName || null,
        timezone,
        working_hours_start: workStart,
        working_hours_end: workEnd,
        rounding_minutes: rounding,
        target_hours: targetHours,
        output_language: language,
        onboarded: true,
      };

      const { error: upsertError } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'user_id' });
      if (upsertError) throw upsertError;

      const { error: typesError } = await supabase.from('activity_type_options').upsert(
        DEFAULT_ACTIVITY_TYPES.map((label, i) => ({
          user_id: userId,
          label,
          sort_order: i,
        })),
      );
      if (typesError) throw typesError;

      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your settings.');
    } finally {
      setBusy(false);
    }
  }

  async function finishOnboarding() {
    await saveProfile();
  }

  const SC_PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/singlecase-proxy`;

  // ── Admin: validate SingleCase token ──
  async function validateSingleCase() {
    if (!singleCaseUrl || !singleCaseToken) return;
    setSingleCaseValidating(true);
    setSingleCaseError(null);
    setSingleCaseValidated(null);
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(SC_PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${data.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          action: 'test',
          workspace_url: singleCaseUrl,
          token: singleCaseToken,
        }),
      });
      const result = await response.json();
      if (response.ok && result.ok) {
        setSingleCaseValidated(result.workspace_name ?? singleCaseUrl);
      } else {
        const msg: string = result.error ?? 'Unknown error';
        if (msg.toLowerCase().includes('workspace') || response.status === 404) {
          setSingleCaseError('unknown_workspace');
        } else if (response.status === 401) {
          setSingleCaseError('rejected_token');
        } else {
          setSingleCaseError(msg);
        }
      }
    } catch {
      setSingleCaseError('network');
    } finally {
      setSingleCaseValidating(false);
    }
  }

  // ── Admin: save SingleCase token ──
  async function connectSingleCase() {
    if (!singleCaseValidated || !singleCaseToken) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(SC_PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${data.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          action: 'save',
          workspace_url: singleCaseUrl,
          token: singleCaseToken,
        }),
      });
      const result = await response.json();
      if (response.ok && result.ok) {
        setOrgSingleCaseConnected(true);
        setOrgSingleCaseWorkspace(singleCaseValidated);
        setAdminStep('invite');
      } else {
        setError(result.error ?? 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setBusy(false);
    }
  }

  // ── Admin: invite members ──
  async function inviteMembers() {
    const emails = inviteEmails
      .split(/[\n,]/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (emails.length === 0) {
      await saveProfile();
      return;
    }
    setBusy(true);
    try {
      // In production, this would send invitation emails via Supabase auth admin API
      for (const email of emails) {
        await supabase.auth.admin.inviteUserByEmail(email);
      }
      await saveProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send invitations');
    } finally {
      setBusy(false);
    }
  }

  // ── Member: connect Microsoft ──
  async function connectMicrosoft() {
    setConnectingMicrosoft(true);
    try {
      // Simulate OAuth redirect + return
      await new Promise((r) => setTimeout(r, 800));
      await supabase.from('connections').insert({
        user_id: user!.id,
        provider: 'email',
        status: 'connected',
        account_label: `${user?.email ?? 'demo'}@novaklaw.cz`,
        scopes_granted: ['read'],
        connected_at: new Date().toISOString(),
      });
      await saveProfile();
    } finally {
      setConnectingMicrosoft(false);
    }
  }

  // ── Role selection screen ──
  if (roleChoice === 'choosing') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-10">
        <div className="w-full max-w-lg">
          <h1 className="mb-2 text-xl font-semibold text-stone-900">Welcome to Daykeeper</h1>
          <p className="mb-6 text-sm text-stone-500">
            Before we get started, tell us how you'll be using Daykeeper.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Admin card */}
            <button
              onClick={chooseAdmin}
              disabled={roleSettingUp}
              className="group flex flex-col items-start rounded-xl border-2 border-stone-200 bg-white p-5 text-left transition-all hover:border-accent-400 hover:shadow-md disabled:opacity-50"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-100 text-accent-700 transition-colors group-hover:bg-accent-600 group-hover:text-white">
                {roleSettingUp ? <Loader2 size={20} className="animate-spin" /> : <ShieldCheck size={20} />}
              </div>
              <h2 className="text-sm font-semibold text-stone-900">I'm the administrator</h2>
              <p className="mt-1 text-xs text-stone-500">
                I'll set up my firm — connect SingleCase, invite my team, and manage connections.
              </p>
            </button>

            {/* Member card */}
            <button
              onClick={chooseMember}
              className="group flex flex-col items-start rounded-xl border-2 border-stone-200 bg-white p-5 text-left transition-all hover:border-accent-400 hover:shadow-md"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-stone-100 text-stone-600 transition-colors group-hover:bg-accent-600 group-hover:text-white">
                <Users size={20} />
              </div>
              <h2 className="text-sm font-semibold text-stone-900">I'm a team member</h2>
              <p className="mt-1 text-xs text-stone-500">
                My administrator has already set things up. I just need to connect my own account.
              </p>
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <p className="mt-6 text-center text-xs text-stone-400">
            Not sure? Choose administrator if you're the first person from your firm to sign up.
          </p>
        </div>
      </div>
    );
  }

  // ── Member: SingleCase not set up yet, but profile already saved ──
  if (role === 'member' && !orgSingleCaseConnected && memberStep !== 'profile' && memberStep !== 'billing' && memberStep !== 'waiting') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-10">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <AlertCircle size={24} className="text-amber-600" />
          </div>
          <h1 className="mb-2 text-lg font-semibold text-stone-900">Your administrator is still setting up</h1>
          <p className="text-sm text-stone-500">
            Your profile has been saved. Daykeeper is not fully ready for you yet —
            your administrator needs to connect SingleCase first. Once that's done,
            you can sign in and finish connecting your account.
          </p>
          <p className="mt-4 text-xs text-stone-400">
            You don't need to do anything right now. Check back shortly, or contact your administrator.
          </p>
        </div>
      </div>
    );
  }

  // ── Admin steps ──
  if (role === 'admin') {
    const adminSteps: { key: AdminStep; label: string }[] = [
      { key: 'profile', label: 'Profile' },
      { key: 'billing', label: 'Billing' },
      { key: 'singlecase', label: 'SingleCase' },
      { key: 'invite', label: 'Invite team' },
    ];
    const currentIdx = adminSteps.findIndex((s) => s.key === adminStep);

    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-10">
        <div className="w-full max-w-lg">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-accent-700" />
              <h1 className="text-xl font-semibold text-stone-900">Admin setup</h1>
            </div>
            <button
              onClick={async () => { await supabase.auth.signOut(); }}
              className="text-xs font-medium text-stone-400 hover:text-stone-700"
            >
              Sign out
            </button>
          </div>
          <p className="mb-6 text-sm text-stone-500">
            Set up Daykeeper for your firm. This takes a few minutes.
          </p>

          {/* Stepper */}
          <div className="mb-6 flex items-center gap-2">
            {adminSteps.map((s, i) => (
              <div key={s.key} className="flex flex-1 items-center gap-2">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    i <= currentIdx ? 'bg-accent-700 text-white' : 'bg-stone-300 text-stone-600'
                  }`}
                >
                  {i + 1}
                </div>
                <span className={`text-xs ${i <= currentIdx ? 'text-stone-800' : 'text-stone-400'}`}>
                  {s.label}
                </span>
                {i < adminSteps.length - 1 && <div className="h-px flex-1 bg-stone-300" />}
              </div>
            ))}
          </div>

          <div className="card p-6">
            {/* Step 1: Profile */}
            {adminStep === 'profile' && (
              <div className="space-y-4">
                <div>
                  <label className="label" htmlFor="name">Display name</label>
                  <input id="name" className="input" value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)} placeholder="Jan Novák" />
                </div>
                <div>
                  <label className="label" htmlFor="tz">Timezone</label>
                  <select id="tz" className="input" value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}>
                    {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="ws">Working hours start</label>
                    <input id="ws" type="time" className="input" value={workStart}
                      onChange={(e) => setWorkStart(e.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="we">Working hours end</label>
                    <input id="we" type="time" className="input" value={workEnd}
                      onChange={(e) => setWorkEnd(e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <button onClick={() => setAdminStep('billing')} className="btn-primary">Continue</button>
                </div>
              </div>
            )}

            {/* Step 2: Billing */}
            {adminStep === 'billing' && (
              <div className="space-y-4">
                <div>
                  <label className="label">Time rounding increment</label>
                  <div className="flex gap-2">
                    {([0, 6, 15] as const).map((val) => (
                      <button key={val} onClick={() => setRounding(val)}
                        className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                          rounding === val ? 'border-accent-600 bg-accent-50 text-accent-800'
                          : 'border-stone-300 text-stone-600 hover:bg-stone-50'}`}>
                        {val === 0 ? 'Exact' : `${val} min`}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="target">Target billable hours per day</label>
                  <input id="target" type="number" min={0} max={24} step={0.25}
                    className="input" value={targetHours}
                    onChange={(e) => setTargetHours(Number(e.target.value))} />
                </div>
                <div>
                  <label className="label">Output language (fallback for cases without one)</label>
                  <div className="flex gap-2">
                    {([['en', 'English'], ['cs', 'Czech']] as const).map(([val, lbl]) => (
                      <button key={val} onClick={() => setLanguage(val)}
                        className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                          language === val ? 'border-accent-600 bg-accent-50 text-accent-800'
                          : 'border-stone-300 text-stone-600 hover:bg-stone-50'}`}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex justify-between pt-2">
                  <button onClick={() => setAdminStep('profile')} className="btn-ghost">Back</button>
                  <button onClick={() => setAdminStep('singlecase')} className="btn-primary">Continue</button>
                </div>
              </div>
            )}

            {/* Step 3: SingleCase */}
            {adminStep === 'singlecase' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Building2 size={18} className="text-stone-400" />
                  <h2 className="text-sm font-semibold text-stone-900">Connect SingleCase</h2>
                </div>
                <p className="text-sm text-stone-600">
                  Enter your firm's SingleCase workspace and the API token.
                  This is a firm-issued key, not a password.
                </p>

                <div>
                  <label className="label">Workspace URL</label>
                  <input
                    type="text"
                    className="input"
                    value={singleCaseUrl}
                    onChange={(e) => { setSingleCaseUrl(e.target.value.trim()); setSingleCaseValidated(null); setSingleCaseError(null); }}
                    placeholder="https://yourfirm.singlecase.app"
                  />
                </div>

                <div>
                  <label className="label">API token</label>
                  <input type="text" className="input"
                    value={singleCaseToken}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/^Bearer\s+/i, '').trim();
                      setSingleCaseToken(cleaned);
                      setSingleCaseValidated(null);
                      setSingleCaseError(null);
                    }}
                    placeholder="Paste token here" />
                </div>

                <button onClick={validateSingleCase} disabled={!singleCaseUrl || !singleCaseToken || singleCaseValidating}
                  className="btn-secondary text-sm">
                  {singleCaseValidating ? <><Loader2 size={14} className="animate-spin" /> Validating…</> : 'Validate'}
                </button>

                {singleCaseValidated && (
                  <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                    <CheckCircle2 size={14} /> Workspace verified: {singleCaseValidated}
                  </div>
                )}
                {singleCaseError && (
                  <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                    {singleCaseError === 'unknown_workspace' && 'Unknown workspace. Check the URL.'}
                    {singleCaseError === 'rejected_token' && 'Token rejected. Generate a new one in SingleCase → Integrations.'}
                    {singleCaseError === 'network' && "Couldn't reach SingleCase. Check your connection."}
                    {singleCaseError !== 'unknown_workspace' && singleCaseError !== 'rejected_token' && singleCaseError !== 'network' && singleCaseError}
                  </div>
                )}

                {error && <p className="text-sm text-red-700">{error}</p>}

                <div className="flex justify-between pt-2">
                  <button onClick={() => setAdminStep('billing')} className="btn-ghost">Back</button>
                  <button onClick={connectSingleCase} disabled={!singleCaseValidated || busy}
                    className="btn-primary">
                    {busy ? 'Connecting…' : 'Connect & continue'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Invite team */}
            {adminStep === 'invite' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Users size={18} className="text-stone-400" />
                  <h2 className="text-sm font-semibold text-stone-900">Invite your team</h2>
                </div>
                <p className="text-sm text-stone-600">
                  SingleCase is connected as <span className="font-medium">{orgSingleCaseWorkspace}</span>.
                  Invite your colleagues — they'll sign in, pick themselves from the firm's
                  SingleCase user list, and connect Microsoft in one click.
                </p>
                <div>
                  <label className="label">Email addresses (one per line or comma-separated)</label>
                  <textarea className="input" rows={4} value={inviteEmails}
                    onChange={(e) => setInviteEmails(e.target.value)}
                    placeholder="colleague@novaklaw.cz&#10;partner@novaklaw.cz" />
                </div>
                {error && <p className="text-sm text-red-700">{error}</p>}
                <div className="flex justify-between pt-2">
                  <button onClick={() => setAdminStep('singlecase')} className="btn-ghost">Back</button>
                  <div className="flex gap-2">
                    <button onClick={() => saveProfile()} disabled={busy} className="btn-secondary">
                      Skip for now
                    </button>
                    <button onClick={inviteMembers} disabled={busy} className="btn-primary">
                      {busy ? 'Sending…' : 'Send invites & finish'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Member steps ──
  const memberSteps: { key: MemberStep; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'billing', label: 'Billing' },
    { key: 'pick_user', label: 'Your account' },
    { key: 'connect_microsoft', label: 'Connect' },
  ];
  const currentIdx = memberSteps.findIndex((s) => s.key === memberStep);

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-lg">
        <h1 className="mb-2 text-xl font-semibold text-stone-900">Welcome to Daykeeper</h1>
        <p className="mb-6 text-sm text-stone-500">
          {orgSingleCaseWorkspace ? `Your firm uses ${orgSingleCaseWorkspace}.` : 'A few quick steps to get started.'}
        </p>

        {/* Stepper */}
        <div className="mb-6 flex items-center gap-2">
          {memberSteps.map((s, i) => (
            <div key={s.key} className="flex flex-1 items-center gap-2">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                i <= currentIdx ? 'bg-accent-700 text-white' : 'bg-stone-300 text-stone-600'}`}>
                {i + 1}
              </div>
              <span className={`text-xs ${i <= currentIdx ? 'text-stone-800' : 'text-stone-400'}`}>{s.label}</span>
              {i < memberSteps.length - 1 && <div className="h-px flex-1 bg-stone-300" />}
            </div>
          ))}
        </div>

        <div className="card p-6">
          {/* Step 1: Profile */}
          {memberStep === 'profile' && (
            <div className="space-y-4">
              <div>
                <label className="label" htmlFor="name">Display name</label>
                <input id="name" className="input" value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)} placeholder="Jan Novák" />
              </div>
              <div>
                <label className="label" htmlFor="tz">Timezone</label>
                <select id="tz" className="input" value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="ws">Working hours start</label>
                  <input id="ws" type="time" className="input" value={workStart}
                    onChange={(e) => setWorkStart(e.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="we">Working hours end</label>
                    <input id="we" type="time" className="input" value={workEnd}
                      onChange={(e) => setWorkEnd(e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <button onClick={() => setMemberStep('billing')} className="btn-primary">Continue</button>
              </div>
            </div>
          )}

          {/* Step 2: Billing */}
          {memberStep === 'billing' && (
            <div className="space-y-4">
              <div>
                <label className="label">Time rounding increment</label>
                <div className="flex gap-2">
                  {([0, 6, 15] as const).map((val) => (
                    <button key={val} onClick={() => setRounding(val)}
                      className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                        rounding === val ? 'border-accent-600 bg-accent-50 text-accent-800'
                        : 'border-stone-300 text-stone-600 hover:bg-stone-50'}`}>
                      {val === 0 ? 'Exact' : `${val} min`}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label" htmlFor="target">Target billable hours per day</label>
                <input id="target" type="number" min={0} max={24} step={0.25}
                  className="input" value={targetHours}
                  onChange={(e) => setTargetHours(Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Output language (fallback)</label>
                <div className="flex gap-2">
                  {([['en', 'English'], ['cs', 'Czech']] as const).map(([val, lbl]) => (
                    <button key={val} onClick={() => setLanguage(val)}
                      className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                        language === val ? 'border-accent-600 bg-accent-50 text-accent-800'
                        : 'border-stone-300 text-stone-600 hover:bg-stone-50'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-between pt-2">
                <button onClick={() => setMemberStep('profile')} className="btn-ghost">Back</button>
                <button onClick={() => {
                  if (orgSingleCaseConnected) {
                    setMemberStep('pick_user');
                  } else {
                    setMemberStep('waiting');
                  }
                }} className="btn-primary">Continue</button>
              </div>
            </div>
          )}

          {/* Step 3a: Waiting for admin — no org/SingleCase yet */}
          {memberStep === 'waiting' && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
                <AlertCircle size={24} className="text-amber-600" />
              </div>
              <h2 className="text-sm font-semibold text-stone-900">Your administrator is still setting up</h2>
              <p className="text-sm text-stone-500">
                Your profile has been saved. Once your administrator connects SingleCase
                and invites you, you can sign back in to finish connecting your account.
              </p>
              <button onClick={finishOnboarding} disabled={busy} className="btn-primary w-full">
                {busy ? <Loader2 size={16} className="animate-spin" /> : 'Go to Daykeeper'}
              </button>
            </div>
          )}

          {/* Step 3: Pick yourself from SingleCase user list */}
          {memberStep === 'pick_user' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Building2 size={18} className="text-stone-400" />
                <h2 className="text-sm font-semibold text-stone-900">Which SingleCase user are you?</h2>
              </div>
              <p className="text-sm text-stone-600">
                Your firm's SingleCase workspace ({orgSingleCaseWorkspace}) has these users.
                Pick yourself so Daykeeper can match your activity to your cases.
              </p>
              <div className="space-y-1">
                {singleCaseUsers.map((u) => (
                  <button key={u.id} onClick={() => setSelectedSingleCaseUser(u.id)}
                    className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      selectedSingleCaseUser === u.id
                        ? 'border-accent-600 bg-accent-50 text-accent-800'
                        : 'border-stone-200 hover:bg-stone-50'}`}>
                    <div className="flex-1">
                      <div className="font-medium text-stone-800">{u.name}</div>
                      <div className="text-xs text-stone-400">{u.email}</div>
                    </div>
                    {selectedSingleCaseUser === u.id && <CheckCircle2 size={16} className="text-accent-600" />}
                  </button>
                ))}
              </div>
              <div className="flex justify-between pt-2">
                <button onClick={() => setMemberStep('billing')} className="btn-ghost">Back</button>
                <button onClick={() => setMemberStep('connect_microsoft')} disabled={!selectedSingleCaseUser}
                  className="btn-primary">Continue</button>
              </div>
            </div>
          )}

          {/* Step 4: Connect Microsoft */}
          {memberStep === 'connect_microsoft' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Mail size={18} className="text-stone-400" />
                <h2 className="text-sm font-semibold text-stone-900">Connect Microsoft 365</h2>
              </div>
              <p className="text-sm text-stone-600">
                One click — your administrator has already approved Daykeeper for the firm.
                Daykeeper reads only email and calendar metadata, never message bodies.
              </p>
              <button onClick={connectMicrosoft} disabled={connectingMicrosoft}
                className="btn-primary w-full">
                {connectingMicrosoft ? (
                  <><Loader2 size={16} className="animate-spin" /> Connecting…</>
                ) : (
                  <><Mail size={16} /> Connect Microsoft 365</>
                )}
              </button>
              {error && <p className="text-sm text-red-700">{error}</p>}
              <div className="flex justify-between pt-2">
                <button onClick={() => setMemberStep('pick_user')} className="btn-ghost" disabled={connectingMicrosoft}>Back</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
