import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Connection, ConnectionStatus, CustomConnector } from '@/types';
import type { WebhookEndpoint } from '@/types/signals';
import { ConnectorWizard, IconPreview } from '@/components/ConnectorWizard';
import { GoogleIcon, MicrosoftIcon, SingleCaseIcon } from '@/components/BrandIcons';
import {
  fetchWebhookEndpoints,
  issueWebhookToken,
  revokeWebhookEndpoint,
} from '@/lib/signals';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Upload,
  ExternalLink,
  ShieldCheck,
  Mail,
  Calendar,
  MessageSquare,
  FileText,
  Info,
  X,
  Plus,
  Pencil,
  Trash2,
  Webhook,
  CheckCheck,
  ArrowRight,
  Plug,
  Zap,
  Briefcase,
  Copy,
  Code2,
} from 'lucide-react';

const SC_PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/singlecase-proxy`;
const MS365_FETCH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ms365-fetch`;

const MS365_SCOPES = [
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Calendars.Read',
  'https://graph.microsoft.com/ChannelMessage.Read.All',
  'https://graph.microsoft.com/Files.Read',
].join(' ');
void MS365_SCOPES;

interface StateInfo {
  label: string;
  color: string;
  icon: typeof CheckCircle2;
}

function getStateInfo(status: ConnectionStatus | undefined, accountLabel: string | null): StateInfo {
  switch (status) {
    case 'connected':
      return { label: accountLabel ? `Connected as ${accountLabel}` : 'Connected', color: 'text-accent-700', icon: CheckCircle2 };
    case 'connecting':
      return { label: 'Connecting…', color: 'text-stone-500', icon: Loader2 };
    case 'needs_reauth':
      return { label: 'Needs reauthorization', color: 'text-amber-600', icon: AlertTriangle };
    case 'error':
      return { label: 'Error', color: 'text-red-700', icon: XCircle };
    default:
      return { label: 'Not connected', color: 'text-stone-400', icon: XCircle };
  }
}

interface OrgConnectionState {
  googleConnected: boolean;
  googleSaEmail: string | null;
  ms365Connected: boolean;
  scConnected: boolean;
  scWorkspace: string | null;
  userUpn: string | null;
  userGoogleEmail: string | null;
  customConnectors: CustomConnector[];
  webhookEndpoints: WebhookEndpoint[];
}

// ─── Connector catalogue entry ────────────────────────────────────────────────
interface ConnectorEntry {
  id: string;
  name: string;
  headline: string;
  description: string;
  useCases: string[];
  provides: string[];
  accentColor: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  type: 'builtin' | 'custom-preset' | 'custom-saved';
  connectedLabel?: string;
  isConnected: boolean;
  status?: ConnectionStatus;
  extra?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export function ConnectionsPage() {
  const { user, profile } = useAuth();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [orgState, setOrgState] = useState<OrgConnectionState>({
    googleConnected: false,
    googleSaEmail: null,
    ms365Connected: false,
    scConnected: false,
    scWorkspace: null,
    userUpn: null,
    userGoogleEmail: null,
    customConnectors: [],
  webhookEndpoints: [],
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [showMs365Setup, setShowMs365Setup] = useState(false);
  const [showGoogleSetup, setShowGoogleSetup] = useState(false);
  const [showConnectorWizard, setShowConnectorWizard] = useState(false);
  const [editingConnector, setEditingConnector] = useState<CustomConnector | null>(null);
  const [selectedConnector, setSelectedConnector] = useState<ConnectorEntry | null>(null);

  const isAdmin = profile?.org_role === 'admin';

  const loadConnections = useCallback(async () => {
    if (!user) return;
    const { data: conns } = await supabase
      .from('connections')
      .select('*')
      .eq('user_id', user.id);
    setConnections((conns as Connection[]) ?? []);

    if (!profile?.org_id) return;

    const { data: tokens } = await supabase
      .from('provider_tokens')
      .select('provider, connected_at, token_encrypted')
      .eq('org_id', profile.org_id)
      .in('provider', ['singlecase', 'google', 'microsoft365']);

    const tokenMap = new Map(tokens?.map((t) => [t.provider, t]) ?? []);

    const { data: org } = await supabase
      .from('organizations')
      .select('workspace_subdomain')
      .eq('id', profile.org_id)
      .maybeSingle();

    let googleSaEmail: string | null = null;
    const googleToken = tokenMap.get('google');
    if (googleToken?.token_encrypted) {
      try { googleSaEmail = JSON.parse(googleToken.token_encrypted).client_email ?? null; } catch { /* ignore */ }
    }

    const ms365Conn = (conns as Connection[])?.find(
      (c) => c.provider === 'email' && c.connection_metadata?.upn,
    );
    const userUpn = (ms365Conn?.connection_metadata?.upn as string) ?? null;

    const googleConn = (conns as Connection[])?.find(
      (c) => c.provider === 'calendar' && c.connection_metadata?.google_email,
    );
    const userGoogleEmail = (googleConn?.connection_metadata?.google_email as string) ?? null;

    const { data: customConns } = await supabase
      .from('custom_connectors')
      .select('id, org_id, name, icon_key, auth_type, base_url, endpoint_path, http_method, date_param_name, date_param_format, end_date_param_name, response_items_path, field_mapping, status, created_by, created_at, updated_at')
      .eq('org_id', profile.org_id)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    const { data: webhookEnds } = await fetchWebhookEndpoints();

    setOrgState({
      googleConnected: !!tokenMap.get('google'),
      googleSaEmail,
      ms365Connected: !!tokenMap.get('microsoft365'),
      scConnected: !!tokenMap.get('singlecase'),
      scWorkspace: org?.workspace_subdomain ?? null,
      userUpn,
      userGoogleEmail,
      customConnectors: (customConns as CustomConnector[]) ?? [],
      webhookEndpoints: webhookEnds ?? [],
    });
  }, [user, profile?.org_id]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  function getConnection(provider: string): Connection | undefined {
    return connections.find((c) => c.provider === provider);
  }

  const handleMs365Saved = useCallback(async (upn: string) => {
    if (!user) return;
    if (upn.toLowerCase() !== user.email?.toLowerCase()) return;
    const existing = getConnection('email');
    if (existing) {
      await supabase
        .from('connections')
        .update({ status: 'connected', last_error: null, connection_metadata: { upn } })
        .eq('id', existing.id);
    } else {
      await supabase.from('connections').insert({
        user_id: user.id,
        provider: 'email',
        status: 'connected',
        account_label: 'Microsoft 365',
        connection_metadata: { upn },
      });
    }
    await loadConnections();
  }, [user, loadConnections, connections]);

  const handleGoogleSaved = useCallback(async (googleEmail: string) => {
    if (!user) return;
    if (googleEmail !== user.email) return;
    const existing = getConnection('calendar');
    if (existing) {
      await supabase
        .from('connections')
        .update({ status: 'connected', last_error: null, connection_metadata: { google_email: googleEmail } })
        .eq('id', existing.id);
    } else {
      await supabase.from('connections').insert({
        user_id: user.id,
        provider: 'calendar',
        status: 'connected',
        account_label: 'Google Workspace',
        connection_metadata: { google_email: googleEmail },
      });
    }
    await loadConnections();
  }, [user, loadConnections, connections]);

  const ms365Conn = getConnection('email');

  // Build unified catalogue
  const ms365IsConnected = orgState.ms365Connected && !!orgState.userUpn;
  const googleIsConnected = orgState.googleConnected && !!orgState.userGoogleEmail;

  const catalogue: ConnectorEntry[] = [
    {
      id: 'microsoft365',
      name: 'Microsoft 365',
      headline: 'Capture your full Microsoft 365 working day',
      description: 'Daykeeper reads your Outlook inbox, calendar meetings, Teams messages, and OneDrive file activity to build an accurate, automatic picture of how your time was spent.',
      useCases: [
        'Auto-populate timesheets from calendar meetings',
        'Attribute Outlook email threads to client matters',
        'Capture Teams conversations as billable activity',
      ],
      provides: ['Outlook mail', 'Calendar events', 'Teams messages', 'OneDrive files'],
      accentColor: '#0078d4',
      Icon: MicrosoftIcon,
      type: 'builtin',
      isConnected: ms365IsConnected,
      connectedLabel: orgState.userUpn ?? undefined,
      status: ms365Conn?.status,
    },
    {
      id: 'google',
      name: 'Google Workspace',
      headline: 'Turn Gmail and Calendar into billable time',
      description: 'Connect Google Workspace to let Daykeeper read your Gmail messages and Google Calendar events, automatically matching meetings and email threads to client matters.',
      useCases: [
        'Auto-detect meetings from Google Calendar',
        'Attribute Gmail threads to matters and clients',
        'Ask questions like "How much time did I spend on this client this week?"',
      ],
      provides: ['Gmail (inbox & sent)', 'Google Calendar'],
      accentColor: '#34A853',
      Icon: GoogleIcon,
      type: 'builtin',
      isConnected: googleIsConnected,
      connectedLabel: orgState.userGoogleEmail ?? undefined,
    },
    {
      id: 'singlecase',
      name: 'SingleCase',
      headline: 'Link every activity to the right matter',
      description: 'Sync your SingleCase matter list so Daykeeper can automatically suggest the correct matter and activity type for every time block — no manual lookup needed.',
      useCases: [
        'Auto-suggest matters for each time block',
        'Keep your matter list current without manual imports',
        'Pre-fill activity codes when recording time',
      ],
      provides: ['Matters & clients', 'Activity types', 'Time entry attribution'],
      accentColor: '#6366f1',
      Icon: SingleCaseIcon,
      type: 'builtin',
      isConnected: orgState.scConnected,
      connectedLabel: orgState.scWorkspace ?? undefined,
    },
    ...orgState.customConnectors.map((c): ConnectorEntry => ({
      id: c.id,
      name: c.name,
      headline: `Pull ${c.name} activity into Daykeeper`,
      description: `This custom connector reads activity data from ${c.base_url} and surfaces it alongside your other connected sources so every working moment is captured.`,
      useCases: [
        `Capture ${c.name} activity as billable time`,
        'Attribute items to client matters automatically',
        'See all your work in one place',
      ],
      provides: ['Activity items', 'Time attribution'],
      accentColor: '#0d9488',
      Icon: ({ size, className }) => <IconPreview iconKey={c.icon_key} size={size} className={className} />,
      type: 'custom-saved',
      isConnected: true,
      connectedLabel: c.base_url,
      extra: { connector: c },
    })),
    {
      id: 'webhook',
      name: 'Webhook / API',
      headline: 'Connect any automation tool via API',
      description: 'Get a personal API endpoint and JSON spec. Use make.com, Zapier, n8n, or any tool that can send HTTP POST requests to push activity data directly into Daykeeper. You keep full control of the integration on your side.',
      useCases: [
        'Push activity from any tool with an HTTP action',
        'Use make.com, Zapier, n8n, or custom scripts',
        'Full control — you configure the automation yourself',
      ],
      provides: ['Activity items', 'Time attribution', 'Real-time updates'],
      accentColor: '#e07b39',
      Icon: Webhook,
      type: 'builtin',
      isConnected: orgState.webhookEndpoints.length > 0,
      connectedLabel: orgState.webhookEndpoints.length > 0 ? `${orgState.webhookEndpoints.length} endpoint${orgState.webhookEndpoints.length > 1 ? 's' : ''}` : undefined,
      extra: { webhookEndpoints: orgState.webhookEndpoints },
    },
  ];

  const connected = catalogue.filter((c) => c.isConnected);
  const available = catalogue.filter((c) => !c.isConnected);

  function handleCardClick(entry: ConnectorEntry) {
    setSelectedConnector(entry);
  }

  function handleDetailAction(entry: ConnectorEntry) {
    setSelectedConnector(null);
    if (entry.id === 'microsoft365') setShowMs365Setup(true);
    else if (entry.id === 'google') setShowGoogleSetup(true);
    else if (entry.id === 'singlecase') {
      // SingleCase setup happens inside the detail modal via its own panel
      setSelectedConnector({ ...entry, extra: { showSetup: true } });
    } else if (entry.type === 'custom-saved') {
      const c = entry.extra?.connector as CustomConnector;
      setEditingConnector(c);
      setShowConnectorWizard(true);
    } else if (entry.id === 'webhook') {
      setSelectedConnector(entry);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6">
        <h1 className="mb-1 text-xl font-semibold text-stone-900">Connections</h1>
        <p className="text-sm text-stone-500">
          Connect your firm's work applications. Daykeeper reads only activity metadata —
          never message bodies, document contents, or attachments.
        </p>
      </div>

      {isAdmin && (
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-accent-200 bg-accent-50 px-4 py-3">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent-600" />
          <div>
            <p className="text-sm font-medium text-accent-800">You are an organisation administrator</p>
            <p className="mt-0.5 text-xs text-accent-600">
              Connections you set up here are shared with everyone in your organisation.
            </p>
          </div>
        </div>
      )}

      {/* Connected section */}
      {connected.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-stone-400">
            <CheckCheck size={13} /> Connected
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {connected.map((entry) => (
              <ConnectorCard
                key={entry.id}
                entry={entry}
                onClick={handleCardClick}
              />
            ))}
          </div>
        </section>
      )}

      {/* Available section */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-stone-400">
            <Plug size={13} /> Available
          </h2>
          {isAdmin && (
            <button
              onClick={() => { setEditingConnector(null); setShowConnectorWizard(true); }}
              className="flex items-center gap-1.5 text-xs font-medium text-accent-600 hover:text-accent-700 transition-colors"
            >
              <Plus size={13} /> Custom connector
            </button>
          )}
        </div>
        {available.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-200 py-10 text-center">
            <Zap size={22} className="mb-2 text-stone-300" />
            <p className="text-sm font-medium text-stone-600">All integrations connected</p>
            <p className="mt-0.5 text-xs text-stone-400">Add a custom connector to pull from any REST API.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((entry) => (
              <ConnectorCard
                key={entry.id}
                entry={entry}
                onClick={handleCardClick}
              />
            ))}
          </div>
        )}
      </section>

      {/* Detail modal */}
      {selectedConnector && (
        <ConnectorDetailModal
          entry={selectedConnector}
          isAdmin={isAdmin}
          orgState={orgState}
          authEmail={user?.email ?? null}
          busy={busy}
          connections={connections}
          onClose={() => setSelectedConnector(null)}
          onAction={handleDetailAction}
          onMs365UserSaved={async (upn) => { await handleMs365Saved(upn); setSelectedConnector(null); }}
          onGoogleUserSaved={async (email) => { await handleGoogleSaved(email); setSelectedConnector(null); }}
          onScChanged={async () => { await loadConnections(); setSelectedConnector(null); }}
          onDisconnectMs365={async () => {
            if (!user) return;
            if (!confirm('Disconnect Microsoft 365?')) return;
            setBusy('email');
            await supabase.from('connections').delete().eq('user_id', user.id).eq('provider', 'email');
            await loadConnections();
            setBusy(null);
            setSelectedConnector(null);
          }}
          onDisconnectGoogle={async () => {
            if (!profile?.org_id) return;
            if (!confirm('Disconnect Google? This will stop reading Gmail and Calendar for everyone in your organisation.')) return;
            setBusy('google');
            await supabase.from('provider_tokens').delete().eq('org_id', profile.org_id).eq('provider', 'google');
            await loadConnections();
            setBusy(null);
            setSelectedConnector(null);
          }}
          onEditCustom={(c) => { setSelectedConnector(null); setEditingConnector(c); setShowConnectorWizard(true); }}
          onDeleteCustom={async (c) => {
            if (!confirm(`Delete the "${c.name}" connector?`)) return;
            await supabase.from('custom_connectors').delete().eq('id', c.id);
            await loadConnections();
            setSelectedConnector(null);
          }}
          onRevokeWebhook={async (endpointId) => {
            if (!confirm('Revoke this webhook endpoint? The token will stop working immediately.')) return;
            await revokeWebhookEndpoint(endpointId);
            await loadConnections();
            setSelectedConnector(null);
          }}
          onCreateWebhook={async (label) => {
            const token = await issueWebhookToken(label);
            await loadConnections();
            return token;
          }}
        />
      )}

      {/* Setup modals */}
      {showMs365Setup && (
        <Ms365SetupModal
          onClose={() => setShowMs365Setup(false)}
          onSaved={async (upn) => { await handleMs365Saved(upn); setShowMs365Setup(false); }}
        />
      )}
      {showGoogleSetup && (
        <GoogleSetupModal
          onClose={() => setShowGoogleSetup(false)}
          onSaved={async () => { await loadConnections(); setShowGoogleSetup(false); }}
        />
      )}
      {showConnectorWizard && (
        <ConnectorWizard
          existing={editingConnector}
          onClose={() => { setShowConnectorWizard(false); setEditingConnector(null); }}
          onSaved={async () => { await loadConnections(); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Connector card (Notion-style)
// ─────────────────────────────────────────────────────────────────────────────
function ConnectorCard({
  entry,
  onClick,
}: {
  entry: ConnectorEntry;
  onClick: (entry: ConnectorEntry) => void;
}) {
  const { Icon, name, isConnected, connectedLabel } = entry;

  return (
    <button
      onClick={() => onClick(entry)}
      className="group flex items-center gap-3.5 rounded-xl border border-stone-200 bg-white px-4 py-3.5 text-left transition-all hover:border-stone-300 hover:shadow-sm active:scale-[0.98]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stone-100 transition-colors group-hover:bg-stone-200">
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-stone-900">{name}</p>
        {isConnected && connectedLabel ? (
          <p className="truncate text-xs text-accent-600">{connectedLabel}</p>
        ) : isConnected ? (
          <p className="text-xs text-accent-600">Connected</p>
        ) : (
          <p className="text-xs text-stone-400">Not connected</p>
        )}
      </div>
      {isConnected && (
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent-500" />
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail modal (Notion-style)
// ─────────────────────────────────────────────────────────────────────────────
function ConnectorDetailModal({
  entry,
  isAdmin,
  orgState,
  authEmail,
  busy,
  connections,
  onClose,
  onAction,
  onMs365UserSaved,
  onGoogleUserSaved,
  onScChanged,
  onDisconnectMs365,
  onDisconnectGoogle,
  onEditCustom,
  onDeleteCustom,
  onRevokeWebhook,
  onCreateWebhook,
}: {
  entry: ConnectorEntry;
  isAdmin: boolean;
  orgState: OrgConnectionState;
  authEmail: string | null;
  busy: string | null;
  connections: Connection[];
  onClose: () => void;
  onAction: (entry: ConnectorEntry) => void;
  onMs365UserSaved: (upn: string) => Promise<void>;
  onGoogleUserSaved: (email: string) => Promise<void>;
  onScChanged: () => Promise<void>;
  onDisconnectMs365: () => Promise<void>;
  onDisconnectGoogle: () => Promise<void>;
  onEditCustom: (c: CustomConnector) => void;
  onDeleteCustom: (c: CustomConnector) => Promise<void>;
  onRevokeWebhook: (endpointId: string) => Promise<void>;
  onCreateWebhook: (label: string) => Promise<string | null>;
}) {
  const { Icon, name, headline, description, useCases, provides, isConnected, type, accentColor } = entry;
  const [showMailboxPicker, setShowMailboxPicker] = useState(false);
  const [showGoogleEmailPicker, setShowGoogleEmailPicker] = useState(false);
  const [showScSetup, setShowScSetup] = useState(entry.extra?.showSetup === true);
  const [activeTab, setActiveTab] = useState<'overview' | 'settings'>(
    entry.id === 'webhook' && (entry.extra?.webhookEndpoints as WebhookEndpoint[] | undefined)?.length ? 'settings' : 'overview'
  );

  const ms365Conn = connections.find((c) => c.provider === 'email');
  const showSettings = showMailboxPicker || showGoogleEmailPicker || showScSetup;

  function renderAction() {
    if (entry.id === 'microsoft365') {
      if (!orgState.ms365Connected) {
        if (!isAdmin) return <p className="text-xs text-stone-400">Ask your administrator to set this up.</p>;
        return (
          <button onClick={() => onAction(entry)} className="btn-primary text-sm flex items-center gap-2">
            Set up <ArrowRight size={14} />
          </button>
        );
      }
      if (isAdmin) {
        return (
          <div className="flex items-center gap-2">
            <button onClick={() => onAction(entry)} className="btn-secondary text-sm">Manage</button>
            <button onClick={onDisconnectMs365} disabled={busy === 'email'} className="btn-secondary text-sm text-red-700">
              {busy === 'email' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        );
      }
      if (!orgState.userUpn) {
        return (
          <button onClick={() => setShowMailboxPicker(true)} className="btn-primary text-sm flex items-center gap-2">
            Select your mailbox <ArrowRight size={14} />
          </button>
        );
      }
      return (
        <button onClick={() => setShowMailboxPicker(true)} className="btn-secondary text-sm">
          Change mailbox
        </button>
      );
    }

    if (entry.id === 'google') {
      if (!orgState.googleConnected) {
        if (!isAdmin) return <p className="text-xs text-stone-400">Ask your administrator to set this up.</p>;
        return (
          <button onClick={() => onAction(entry)} className="btn-primary text-sm flex items-center gap-2">
            Set up <ArrowRight size={14} />
          </button>
        );
      }
      if (isAdmin) {
        return (
          <div className="flex items-center gap-2 flex-wrap">
            {orgState.userGoogleEmail ? (
              <button onClick={() => setShowGoogleEmailPicker(true)} className="btn-ghost text-sm">
                {orgState.userGoogleEmail}
              </button>
            ) : (
              <button onClick={() => setShowGoogleEmailPicker(true)} className="btn-primary text-sm flex items-center gap-2">
                Select your email <ArrowRight size={14} />
              </button>
            )}
            <button onClick={onDisconnectGoogle} disabled={busy === 'google'} className="btn-secondary text-sm text-red-700">
              {busy === 'google' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        );
      }
      if (!orgState.userGoogleEmail) {
        return (
          <button onClick={() => setShowGoogleEmailPicker(true)} className="btn-primary text-sm flex items-center gap-2">
            Select your email <ArrowRight size={14} />
          </button>
        );
      }
      return (
        <button onClick={() => setShowGoogleEmailPicker(true)} className="btn-secondary text-sm">
          Change email
        </button>
      );
    }

    if (entry.id === 'singlecase') {
      if (!orgState.scConnected) {
        if (!isAdmin) return <p className="text-xs text-stone-400">Ask your administrator to set up SingleCase.</p>;
        return (
          <button onClick={() => setShowScSetup(true)} className="btn-primary text-sm flex items-center gap-2">
            Set up <ArrowRight size={14} />
          </button>
        );
      }
      if (isAdmin) {
        return (
          <div className="flex items-center gap-2">
            <button onClick={() => setShowScSetup(true)} className="btn-secondary text-sm">Manage</button>
          </div>
        );
      }
      return null;
    }

    if (type === 'custom-saved' && isAdmin) {
      const c = entry.extra?.connector as CustomConnector;
      return (
        <div className="flex items-center gap-2">
          <button onClick={() => onEditCustom(c)} className="btn-secondary text-sm flex items-center gap-1">
            <Pencil size={12} /> Edit
          </button>
          <button onClick={() => onDeleteCustom(c)} className="btn-secondary text-sm text-red-700 flex items-center gap-1">
            <Trash2 size={12} /> Delete
          </button>
        </div>
      );
    }

    if (entry.id === 'webhook') {
      return null; // Webhook actions are rendered inline in the settings tab
    }

    return null;
  }

  // Illustration tiles for the left panel
  const illustrationTiles = entry.id === 'microsoft365'
    ? [{ label: 'Outlook', Icon: Mail }, { label: 'Calendar', Icon: Calendar }, { label: 'Teams', Icon: MessageSquare }, { label: 'OneDrive', Icon: FileText }]
    : entry.id === 'google'
      ? [{ label: 'Gmail', Icon: Mail }, { label: 'Calendar', Icon: Calendar }]
      : entry.id === 'singlecase'
        ? [{ label: 'Matters', Icon: Briefcase }, { label: 'Clients', Icon: FileText }]
        : [{ label: 'Activity', Icon: Zap }];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left panel — illustration */}
        <div className="relative flex flex-col justify-between p-6 sm:w-2/5" style={{ background: `linear-gradient(135deg, ${accentColor}14, ${accentColor}06)` }}>
          <div>
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm border border-stone-200">
              <Icon size={32} />
            </div>
            <h2 className="text-lg font-semibold text-stone-900">{name}</h2>
            {isConnected ? (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-accent-100 px-2.5 py-1 text-xs font-medium text-accent-700">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-500" /> Connected
              </span>
            ) : (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-500">
                Not connected
              </span>
            )}
            {isConnected && entry.connectedLabel && (
              <p className="mt-2 text-xs text-stone-500 break-all">{entry.connectedLabel}</p>
            )}
          </div>

          {/* Data flow illustration */}
          <div className="mt-6 space-y-2">
            {illustrationTiles.map((tile, i) => (
              <div key={tile.label} className="flex items-center gap-2.5 rounded-lg bg-white/70 px-3 py-2 backdrop-blur-sm" style={{ marginLeft: i * 8 }}>
                <tile.Icon size={14} style={{ color: accentColor }} />
                <span className="text-xs font-medium text-stone-600">{tile.label}</span>
                <ArrowRight size={12} className="ml-auto text-stone-300" />
              </div>
            ))}
            <div className="flex items-center gap-2.5 rounded-lg px-3 py-2" style={{ background: accentColor, marginLeft: illustrationTiles.length * 8 }}>
              <CheckCircle2 size={14} className="text-white" />
              <span className="text-xs font-semibold text-white">Daykeeper</span>
            </div>
          </div>
        </div>

        {/* Right panel — details + tabs */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Tab bar */}
          <div className="flex items-center justify-between border-b border-stone-100 px-5 pt-4">
            <div className="flex gap-4">
              <button
                onClick={() => setActiveTab('overview')}
                className={`border-b-2 pb-2 text-sm font-medium transition-colors ${activeTab === 'overview' ? 'border-accent-500 text-stone-900' : 'border-transparent text-stone-400 hover:text-stone-600'}`}
              >
                Overview
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`border-b-2 pb-2 text-sm font-medium transition-colors ${activeTab === 'settings' ? 'border-accent-500 text-stone-900' : 'border-transparent text-stone-400 hover:text-stone-600'}`}
              >
                Settings
              </button>
            </div>
            <button onClick={onClose} className="text-stone-400 hover:text-stone-700 transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Tab content */}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-5">
            {activeTab === 'overview' ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-base font-semibold text-stone-900">{headline}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-stone-600">{description}</p>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Use cases</p>
                  <ul className="space-y-2">
                    {useCases.map((uc) => (
                      <li key={uc} className="flex items-start gap-2 text-sm text-stone-700">
                        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-accent-500" />
                        {uc}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">What this provides</p>
                  <div className="flex flex-wrap gap-1.5">
                    {provides.map((item) => (
                      <span key={item} className="rounded-md bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Status banners */}
                {entry.id === 'microsoft365' && orgState.ms365Connected && !isAdmin && !orgState.userUpn && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
                    <Info size={14} className="mt-0.5 shrink-0" />
                    Your administrator has connected Microsoft 365 — go to Settings to select your mailbox.
                  </div>
                )}
                {entry.id === 'microsoft365' && orgState.ms365Connected && !isAdmin && orgState.userUpn && (
                  <div className="flex items-start gap-2 rounded-lg bg-stone-50 px-3 py-2.5 text-xs text-stone-500">
                    <Info size={14} className="mt-0.5 shrink-0" />
                    Reading activity for <strong className="mx-0.5">{orgState.userUpn}</strong> via your administrator's connection.
                  </div>
                )}
                {entry.id === 'google' && orgState.googleConnected && !isAdmin && !orgState.userGoogleEmail && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
                    <Info size={14} className="mt-0.5 shrink-0" />
                    Your administrator has connected Google Workspace — go to Settings to confirm your email.
                  </div>
                )}

                {/* Webhook endpoint summary on overview */}
                {entry.id === 'webhook' && orgState.webhookEndpoints.length > 0 && (
                  <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-stone-700">
                        {orgState.webhookEndpoints.length} active endpoint{orgState.webhookEndpoints.length > 1 ? 's' : ''}
                      </p>
                      <button
                        onClick={() => setActiveTab('settings')}
                        className="btn-primary text-xs flex items-center gap-1"
                      >
                        Manage endpoints <ArrowRight size={12} />
                      </button>
                    </div>
                    <div className="space-y-1">
                      {orgState.webhookEndpoints.slice(0, 3).map((ep) => (
                        <div key={ep.id} className="flex items-center gap-2 text-xs text-stone-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
                          {ep.label}
                          {ep.last_used_at && <span className="text-stone-400">— used {new Date(ep.last_used_at).toLocaleDateString()}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action */}
                <div className="pt-1">{renderAction()}</div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Inline pickers / setup */}
                {entry.id === 'microsoft365' && (
                  showMailboxPicker ? (
                    <div className="rounded-xl border border-stone-200 overflow-hidden">
                      <MailboxPicker
                        authEmail={authEmail}
                        onPicked={async (upn) => { await onMs365UserSaved(upn); setShowMailboxPicker(false); }}
                        onClose={() => setShowMailboxPicker(false)}
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-stone-600">
                        {orgState.ms365Connected
                          ? 'Microsoft 365 is connected. Use the buttons below to manage your mailbox or disconnect.'
                          : 'Set up Microsoft 365 to read Outlook, Calendar, Teams, and OneDrive activity.'}
                      </p>
                      {ms365Conn?.status === 'connected' && (
                        <div>
                          <p className="mb-1.5 text-xs text-stone-400">Currently reading:</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {([
                              { label: 'Outlook mail', Icon: Mail },
                              { label: 'Calendar', Icon: Calendar },
                              { label: 'Teams chat', Icon: MessageSquare },
                              { label: 'OneDrive files', Icon: FileText },
                            ] as { label: string; Icon: typeof Mail }[]).map((item) => (
                              <div key={item.label} className="flex items-center gap-1.5 text-xs text-stone-600">
                                <item.Icon size={11} className="text-stone-400" /> {item.label}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>{renderAction()}</div>
                    </div>
                  )
                )}

                {entry.id === 'google' && (
                  showGoogleEmailPicker ? (
                    <div className="rounded-xl border border-stone-200 overflow-hidden">
                      <GoogleEmailPicker
                        authEmail={authEmail}
                        onConfirm={async () => { if (authEmail) { await onGoogleUserSaved(authEmail); setShowGoogleEmailPicker(false); } }}
                        onClose={() => setShowGoogleEmailPicker(false)}
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-stone-600">
                        {orgState.googleConnected
                          ? 'Google Workspace is connected. Use the buttons below to manage your email or disconnect.'
                          : 'Set up Google Workspace to read Gmail and Google Calendar activity.'}
                      </p>
                      <div>{renderAction()}</div>
                    </div>
                  )
                )}

                {entry.id === 'singlecase' && (
                  showScSetup ? (
                    <div className="rounded-xl border border-stone-200 overflow-hidden">
                      <SingleCaseSetupPanel
                        scConnected={orgState.scConnected}
                        scWorkspace={orgState.scWorkspace}
                        isAdmin={isAdmin}
                        onChanged={onScChanged}
                        onClose={() => setShowScSetup(false)}
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-stone-600">
                        {orgState.scConnected
                          ? 'SingleCase is connected. Use the button below to sync matters or manage the connection.'
                          : 'Set up SingleCase to sync your matters and enable automatic attribution.'}
                      </p>
                      <div>{renderAction()}</div>
                    </div>
                  )
                )}

                {type === 'custom-saved' && (
                  <div className="space-y-3">
                    <p className="text-sm text-stone-600">Manage this custom connector's configuration and credentials.</p>
                    <div>{renderAction()}</div>
                  </div>
                )}

                {entry.id === 'webhook' && (
                  <WebhookSettingsPanel
                    endpoints={orgState.webhookEndpoints}
                    onCreate={onCreateWebhook}
                    onRevoke={onRevokeWebhook}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SingleCase setup panel (inline in detail modal)
// ─────────────────────────────────────────────────────────────────────────────
function SingleCaseSetupPanel({
  scConnected,
  scWorkspace,
  isAdmin,
  onChanged,
  onClose,
}: {
  scConnected: boolean;
  scWorkspace: string | null;
  isAdmin: boolean;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [workspaceUrl, setWorkspaceUrl] = useState('');
  const [token, setToken] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; workspace?: string; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; summary?: string; error?: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function cleanToken(raw: string) { return raw.trim().replace(/^Bearer\s+/i, '').trim(); }
  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => { setToken(cleanToken(String(reader.result))); setTestResult(null); };
    reader.readAsText(file);
  }
  function handleDrop(e: React.DragEvent) { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }

  async function handleTest() {
    setTesting(true); setTestResult(null);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(SC_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ action: 'test', workspace_url: workspaceUrl, token }),
      });
      const r = await res.json();
      if (res.ok && r.ok) setTestResult({ ok: true, workspace: r.workspace_name });
      else setTestResult({ ok: false, error: r.error ?? 'Unknown error' });
    } catch { setTestResult({ ok: false, error: 'Network error' }); }
    finally { setTesting(false); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(SC_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ action: 'save', workspace_url: workspaceUrl, token }),
      });
      const r = await res.json();
      if (res.ok && r.ok) { await onChanged(); }
      else setTestResult({ ok: false, error: r.error ?? 'Failed to save' });
    } catch { setTestResult({ ok: false, error: 'Network error' }); }
    finally { setSaving(false); }
  }

  async function handleSync() {
    setSyncing(true); setSyncResult(null);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(SC_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ action: 'sync' }),
      });
      const r = await res.json() as { ok: boolean; matters?: number; clients?: number; contacts?: number; error?: string };
      if (res.ok && r.ok) setSyncResult({ ok: true, summary: `Synced ${r.matters ?? 0} matters, ${r.clients ?? 0} clients, ${r.contacts ?? 0} contacts` });
      else setSyncResult({ ok: false, error: r.error ?? 'Sync failed' });
    } catch { setSyncResult({ ok: false, error: 'Network error' }); }
    finally { setSyncing(false); }
  }

  async function handleRemove() {
    if (!confirm('Remove the SingleCase connection?')) return;
    setRemoving(true);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(SC_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ action: 'remove' }),
      });
      if (res.ok) await onChanged();
    } catch { /* ignore */ }
    finally { setRemoving(false); }
  }

  if (scConnected) {
    return (
      <div className="bg-stone-50 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-stone-800">
            Connected to {scWorkspace ?? 'your workspace'}
          </p>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={16} /></button>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <button onClick={handleSync} disabled={syncing} className="btn-secondary text-sm">
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button onClick={handleRemove} disabled={removing} className="btn-secondary text-sm text-red-700">
              {removing ? 'Removing…' : 'Remove connection'}
            </button>
          </div>
        )}
        {syncResult && (
          <p className={`mt-2 text-xs ${syncResult.ok ? 'text-green-700' : 'text-red-700'}`}>
            {syncResult.ok ? syncResult.summary : syncResult.error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-stone-50 px-4 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-800">Connect SingleCase</p>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={16} /></button>
      </div>
      <div>
        <label className="label">Workspace URL</label>
        <div className="flex items-center gap-1">
          <input
            type="text"
            className="input flex-1"
            value={workspaceUrl}
            onChange={(e) => { setWorkspaceUrl(e.target.value.trim()); setTestResult(null); }}
            placeholder="e.g. https://cypress.singlecase-tc.app"
          />
          {workspaceUrl && /^https?:\/\//.test(workspaceUrl) && (
            <a href={`${workspaceUrl.replace(/\/$/, '')}/company/integrations`} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs whitespace-nowrap">
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>
      <div>
        <label className="label">API token</label>
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          className={`relative rounded-md border-2 border-dashed p-2 transition-colors ${dragOver ? 'border-accent-400 bg-accent-50' : 'border-stone-300'}`}
        >
          <input ref={fileInputRef} type="file" accept=".txt,.key,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          <input
            type="password"
            className="input mb-1.5"
            value={token}
            onChange={(e) => { setToken(cleanToken(e.target.value)); setTestResult(null); }}
            placeholder="Paste token or drop file"
          />
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700">
            <Upload size={11} /> Choose file
          </button>
          {dragOver && <div className="absolute inset-0 flex items-center justify-center rounded-md bg-accent-50 text-sm text-accent-700">Drop token file</div>}
        </div>
      </div>
      <button onClick={handleTest} disabled={!workspaceUrl || !token || testing} className="btn-secondary text-sm">
        {testing ? <><Loader2 size={13} className="animate-spin inline mr-1" />Testing…</> : 'Test connection'}
      </button>
      {testResult && (
        <div className={`rounded-md px-3 py-2 text-sm ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {testResult.ok ? <><CheckCircle2 size={13} className="inline mr-1" />Verified — {testResult.workspace}</> : <><AlertTriangle size={13} className="inline mr-1" />{testResult.error}</>}
        </div>
      )}
      {testResult?.ok && (
        <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
          {saving ? 'Saving…' : 'Save connection'}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook settings panel
// ─────────────────────────────────────────────────────────────────────────────
function WebhookSettingsPanel({
  endpoints,
  onCreate,
  onRevoke,
}: {
  endpoints: WebhookEndpoint[];
  onCreate: (label: string) => Promise<string | null>;
  onRevoke: (endpointId: string) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const webhookUrl = `${window.location.origin}/functions/v1/webhook-ingest`;

  const jsonSpec = JSON.stringify({
    endpoint: webhookUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer <YOUR_TOKEN>',
    },
    body: {
      items: [
        {
          timestamp: '2026-01-15T10:30:00Z',
          summary: 'Reviewed contract draft',
          durationMinutes: 45,
          endTimestamp: '2026-01-15T11:15:00Z',
          source: 'make.com',
          externalId: 'unique-id-123',
          meta: {
            sender: 'client@example.com',
            subject: 'Contract review',
          },
        },
      ],
    },
  }, null, 2);

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleCreate() {
    if (!label.trim()) return;
    setCreating(true);
    setError(null);
    setNewToken(null);
    const token = await onCreate(label.trim());
    if (!token) {
      setError('Failed to create endpoint. Please try again.');
    } else {
      setNewToken(token);
      setLabel('');
    }
    setCreating(false);
  }

  async function handleRevoke(id: string) {
    setRevoking(id);
    await onRevoke(id);
    setRevoking(null);
  }

  return (
    <div className="space-y-5">
      {/* Existing endpoints */}
      {endpoints.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Your endpoints</p>
            <span className="text-xs text-stone-400">{endpoints.length} active</span>
          </div>
          {endpoints.map((ep) => (
            <div key={ep.id} className="rounded-lg border border-stone-200 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-stone-800">{ep.label}</p>
                  <p className="text-xs text-stone-400">
                    {ep.last_used_at ? `Last used ${new Date(ep.last_used_at).toLocaleDateString()}` : 'Not used yet'}
                    {' \u00b7 '}Created {new Date(ep.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => handleRevoke(ep.id)}
                  disabled={revoking === ep.id}
                  className="btn-secondary text-xs text-red-700 ml-2 shrink-0"
                >
                  {revoking === ep.id ? 'Revoking\u2026' : 'Revoke'}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 truncate rounded-md bg-stone-50 px-2 py-1 text-xs text-stone-500 border border-stone-100">{webhookUrl}</code>
                <button onClick={() => handleCopy(webhookUrl)} className="btn-ghost text-xs flex items-center gap-1 shrink-0">
                  {copied ? <CheckCircle2 size={12} className="text-accent-600" /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy URL'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* New token display */}
      {newToken && (
        <div className="rounded-lg border border-accent-200 bg-accent-50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-accent-600" />
            <p className="text-sm font-semibold text-accent-800">Endpoint created — copy your token now</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-accent-600">This token is shown only once. Store it securely — you won't be able to see it again.</p>
            <p className="text-xs text-accent-600">If you lose it, create a new endpoint and revoke this one.</p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md bg-white px-3 py-2 text-xs text-stone-800 border border-stone-200">{newToken}</code>
            <button onClick={() => handleCopy(newToken)} className="btn-secondary text-xs flex items-center gap-1">
              {copied ? <CheckCircle2 size={12} className="text-accent-600" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Create new endpoint */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Create a new endpoint</p>
        <div className="flex gap-2">
          <input
            type="text"
            className="input flex-1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Make.com scenario, Zapier zap"
          />
          <button onClick={handleCreate} disabled={!label.trim() || creating} className="btn-primary text-sm whitespace-nowrap">
            {creating ? 'Creating…' : 'Create endpoint'}
          </button>
        </div>
      </div>

      {/* API spec */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Code2 size={14} className="text-stone-400" />
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">API specification</p>
        </div>
        <p className="text-sm text-stone-600">
          Send a <code className="rounded bg-stone-100 px-1 text-xs">POST</code> request to the endpoint below with an
          <code className="rounded bg-stone-100 px-1 text-xs">Authorization: Bearer &lt;YOUR_TOKEN&gt;</code> header.
          The body must contain an <code className="rounded bg-stone-100 px-1 text-xs">items</code> array.
        </p>
        <div className="relative rounded-lg border border-stone-200 bg-stone-50 p-3">
          <button
            onClick={() => handleCopy(jsonSpec)}
            className="absolute right-2 top-2 btn-ghost text-xs flex items-center gap-1"
          >
            <Copy size={12} /> Copy
          </button>
          <pre className="overflow-x-auto text-xs text-stone-700 pr-16">{jsonSpec}</pre>
        </div>
        <div className="rounded-md bg-stone-100 px-3 py-2 space-y-1">
          <p className="text-xs font-medium text-stone-600">Field reference:</p>
          <ul className="text-xs text-stone-500 space-y-0.5">
            <li><code className="text-stone-700">timestamp</code> — ISO 8601 datetime (required)</li>
            <li><code className="text-stone-700">summary</code> — human-readable label (required)</li>
            <li><code className="text-stone-700">durationMinutes</code> — optional, minutes spent</li>
            <li><code className="text-stone-700">endTimestamp</code> — optional, ISO 8601 end time</li>
            <li><code className="text-stone-700">source</code> — optional, name of the source tool</li>
            <li><code className="text-stone-700">externalId</code> — optional, dedup key (retries with same ID won't duplicate)</li>
            <li><code className="text-stone-700">meta</code> — optional, any extra metadata (sender, subject, channel, etc.)</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Mailbox picker
// ─────────────────────────────────────────────────────────────────────────────
function MailboxPicker({ authEmail, onPicked, onClose }: { authEmail: string | null; onPicked: (upn: string) => Promise<void>; onClose: () => void }) {
  const [users, setUsers] = useState<{ displayName: string; mail: string; userPrincipalName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase.auth.getSession();
        const response = await fetch(MS365_FETCH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
          body: JSON.stringify({ action: 'list_users' }),
        });
        const result = await response.json();
        if (response.ok && result.ok) setUsers(result.users ?? []);
        else setError(result.error ?? 'Failed to load users');
      } catch { setError('Network error'); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const filtered = users.filter((u) => {
    const upn = (u.mail || u.userPrincipalName).toLowerCase();
    if (authEmail && upn !== authEmail.toLowerCase()) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.displayName.toLowerCase().includes(q) || (u.mail ?? '').toLowerCase().includes(q) || u.userPrincipalName.toLowerCase().includes(q);
  });

  async function handleConfirm() {
    if (!selected) return;
    setSaving(true);
    await onPicked(selected);
    setSaving(false);
  }

  return (
    <div className="bg-stone-50 px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-800">Select your mailbox</h3>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={16} /></button>
      </div>
      {loading && <div className="flex items-center gap-2 py-3 text-sm text-stone-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {!loading && !error && (
        <>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="input mb-2" />
          <div className="max-h-40 overflow-y-auto rounded-md border border-stone-200 bg-white">
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-sm text-stone-400">No users found</p>
            ) : (
              filtered.map((u) => {
                const upn = u.mail || u.userPrincipalName;
                const isSel = selected === upn;
                return (
                  <button
                    key={u.userPrincipalName}
                    onClick={() => setSelected(upn)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${isSel ? 'bg-accent-50 text-accent-800' : 'hover:bg-stone-50 text-stone-700'}`}
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-medium text-stone-500">
                      {u.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{u.displayName}</div>
                      <div className="truncate text-xs text-stone-400">{upn}</div>
                    </div>
                    {isSel && <CheckCircle2 size={14} className="shrink-0 text-accent-600" />}
                  </button>
                );
              })
            )}
          </div>
          {selected && (
            <button onClick={handleConfirm} disabled={saving} className="btn-primary mt-3 text-sm">
              {saving ? 'Saving…' : 'Confirm mailbox'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Google email picker
// ─────────────────────────────────────────────────────────────────────────────
function GoogleEmailPicker({ authEmail, onConfirm, onClose }: { authEmail: string | null; onConfirm: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  async function handleConfirm() { setSaving(true); await onConfirm(); setSaving(false); }
  return (
    <div className="bg-stone-50 px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-800">Confirm your Google Workspace email</h3>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={16} /></button>
      </div>
      <div className="mb-3 rounded-md bg-stone-100 px-3 py-2.5 flex items-center gap-2">
        <Mail size={14} className="text-stone-400" />
        <span className="text-sm font-medium text-stone-800">{authEmail ?? 'No email on file'}</span>
      </div>
      <p className="mb-3 text-xs text-stone-400">
        The service account will only impersonate <strong>this</strong> account — you cannot access anyone else's Gmail or Calendar.
      </p>
      <button onClick={handleConfirm} disabled={saving || !authEmail} className="btn-primary text-sm">
        {saving ? 'Saving…' : 'Confirm email'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Google setup modal (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function GoogleSetupModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [step, setStep] = useState(1);
  const [saKey, setSaKey] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saEmail, setSaEmail] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const totalSteps = 5;

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => { setSaKey(String(reader.result).trim()); setError(null); };
    reader.readAsText(file);
  }
  function handleDrop(e: React.DragEvent) { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }

  async function handleSave() {
    if (!saKey) return;
    setSaving(true); setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(SC_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ action: 'save_google_sa', service_account_key: saKey }),
      });
      const result = await response.json();
      if (response.ok && result.ok) { setSaEmail(result.client_email ?? null); setStep(5); await onSaved(); }
      else setError(result.error ?? 'Failed to save credentials.');
    } catch { setError('Network error — could not reach the server.'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <GoogleIcon size={18} />
            <h2 className="text-base font-semibold text-stone-900">Connect Google Workspace</h2>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700"><X size={18} /></button>
        </div>
        <div className="flex gap-1.5 px-5 pt-4">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i + 1 <= step ? 'bg-accent-500' : 'bg-stone-200'}`} />
          ))}
        </div>
        <div className="px-5 py-5">
          {step === 1 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-stone-900">Step 1 — Create a service account</h3>
              <p className="text-sm text-stone-600">Google uses a <strong>service account</strong> with domain-wide delegation to let Daykeeper read each employee's Gmail and Calendar. You set this up once in the Google Cloud Console.</p>
              <ol className="ml-5 list-decimal space-y-2 text-sm text-stone-600">
                <li>Go to the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="text-accent-600 underline">Google Cloud Console</a> and sign in with a Google Workspace admin account.</li>
                <li>Select or create a project (e.g. <code className="rounded bg-stone-100 px-1">Daykeeper</code>).</li>
                <li>Go to <strong>APIs &amp; Services → Library</strong> and enable <strong>Gmail API</strong> and <strong>Google Calendar API</strong>.</li>
              </ol>
              <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex items-center gap-1.5 text-sm">
                <ExternalLink size={14} /> Open Google Cloud Console
              </a>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-stone-900">Step 2 — Create the service account</h3>
              <ol className="ml-5 list-decimal space-y-2 text-sm text-stone-600">
                <li>Go to <strong>APIs &amp; Services → Credentials</strong>.</li>
                <li>Click <strong>+ Create Credentials → Service account</strong>.</li>
                <li>Name it <code className="rounded bg-stone-100 px-1">Daykeeper</code> and click <strong>Create and Continue</strong>, then <strong>Done</strong>.</li>
                <li>Click the service account you just created, then go to the <strong>Keys</strong> tab.</li>
                <li>Click <strong>Add Key → Create new key → JSON</strong> and click <strong>Create</strong>.</li>
                <li>A JSON file will download — keep it safe.</li>
              </ol>
              <div className="rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                Note the service account email (looks like <code className="mx-1 rounded bg-amber-100 px-1">daykeeper@project.iam.gserviceaccount.com</code>) — you'll need it in Step 4.
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-stone-900">Step 3 — Enable domain-wide delegation</h3>
              <p className="text-sm text-stone-600">Domain-wide delegation lets the service account impersonate any user in your Google Workspace organisation.</p>
              <ol className="ml-5 list-decimal space-y-2 text-sm text-stone-600">
                <li>Go to the <a href="https://admin.google.com/" target="_blank" rel="noopener noreferrer" className="text-accent-600 underline">Google Workspace Admin Console</a>.</li>
                <li>Go to <strong>Security → Access and data control → API controls</strong>.</li>
                <li>Click <strong>Manage Domain-Wide Delegation</strong>.</li>
                <li>Click <strong>Add new</strong> and paste the <strong>Client ID</strong> from the service account.</li>
                <li>For <strong>OAuth scopes</strong>, paste: <div className="mt-1 break-all rounded-md bg-stone-100 px-2 py-1.5 text-xs text-stone-700">https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/calendar.readonly</div></li>
                <li>Click <strong>Authorize</strong>.</li>
              </ol>
            </div>
          )}
          {step === 4 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-stone-900">Step 4 — Upload the service account key</h3>
              <p className="text-sm text-stone-600">Paste or upload the JSON key file you downloaded in Step 2.</p>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                className={`relative rounded-md border-2 border-dashed p-3 transition-colors ${dragOver ? 'border-accent-400 bg-accent-50' : 'border-stone-300'}`}
              >
                <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                <textarea className="input mb-2 min-h-[80px] font-mono text-xs" value={saKey} onChange={(e) => { setSaKey(e.target.value.trim()); setError(null); }} placeholder="Paste the JSON key file contents here…" />
                <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-800">
                  <Upload size={12} /> Choose JSON key file
                </button>
                {dragOver && <div className="absolute inset-0 flex items-center justify-center rounded-md bg-accent-50 text-sm text-accent-700">Drop the JSON file</div>}
              </div>
              {saKey && <div className="flex items-center gap-2 text-xs text-green-600"><CheckCircle2 size={14} /> Key loaded ({saKey.length} chars)</div>}
              {error && <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
              <button onClick={handleSave} disabled={!saKey || saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save & connect'}</button>
            </div>
          )}
          {step === 5 && (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <CheckCircle2 size={28} className="text-green-600" />
              </div>
              <h3 className="text-base font-semibold text-stone-900">All set!</h3>
              <p className="text-sm text-stone-600">Your Google Workspace connection is ready{saEmail && <> (service account: <strong>{saEmail}</strong>)</>}. Members can now confirm their email on the Connections page.</p>
              <button onClick={onClose} className="btn-primary text-sm">Done</button>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-stone-200 px-5 py-3">
          <span className="text-xs text-stone-400">Step {step} of {totalSteps}</span>
          <div className="flex items-center gap-2">
            {step > 1 && step < 5 && <button onClick={() => setStep(step - 1)} className="btn-ghost text-sm">Back</button>}
            {step < 4 && <button onClick={() => setStep(step + 1)} className="btn-primary text-sm">Next</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Microsoft 365 setup modal (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function Ms365SetupModal({ onClose, onSaved }: { onClose: () => void; onSaved: (upn: string) => Promise<void> }) {
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [upn, setUpn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; users?: { displayName: string; mail: string; userPrincipalName: string }[]; error?: string } | null>(null);
  const totalSteps = 6;

  async function handleTestConnection() {
    if (!clientId || !tenantId || !clientSecret) { setTestResult({ ok: false, error: 'Enter client ID, tenant ID, and secret first.' }); return; }
    setTesting(true); setTestResult(null);
    try {
      const { data } = await supabase.auth.getSession();
      const saveRes = await fetch(SC_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ action: 'save_ms365', client_id: clientId, tenant_id: tenantId, client_secret: clientSecret }),
      });
      const saveResult = await saveRes.json();
      if (!saveRes.ok || !saveResult.ok) { setTestResult({ ok: false, error: saveResult.error ?? 'Failed to save credentials.' }); return; }
      const testRes = await fetch(MS365_FETCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ action: 'list_users' }),
      });
      const testData = await testRes.json();
      if (testRes.ok && testData.ok) setTestResult({ ok: true, users: testData.users });
      else setTestResult({ ok: false, error: testData.error ?? 'Unknown error' });
    } catch { setTestResult({ ok: false, error: 'Network error.' }); }
    finally { setTesting(false); }
  }

  async function handleFinish() {
    if (!clientId || !tenantId || !clientSecret || !upn) { setError('Please fill in all four values.'); return; }
    setSaving(true); setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(SC_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ action: 'save_ms365', client_id: clientId, tenant_id: tenantId, client_secret: clientSecret }),
      });
      const result = await res.json();
      if (res.ok && result.ok) { await onSaved(upn); setStep(6); }
      else setError(result.error ?? 'Failed to save credentials.');
    } catch { setError('Network error.'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <MicrosoftIcon size={18} />
            <h2 className="text-base font-semibold text-stone-900">Connect Microsoft 365</h2>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700"><X size={18} /></button>
        </div>
        <div className="flex gap-1.5 px-5 pt-4">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i + 1 <= step ? 'bg-accent-500' : 'bg-stone-200'}`} />
          ))}
        </div>
        <div className="px-5 py-5">
          {step === 1 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-stone-900">Step 1 — Open the Azure portal</h3>
              <p className="text-sm text-stone-600">Microsoft uses the <strong>Azure portal</strong> to manage app connections. You'll register Daykeeper there to access Outlook, Calendar, Teams, and OneDrive activity.</p>
              <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex items-center gap-1.5 text-sm">
                <ExternalLink size={14} /> Open Azure portal
              </a>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-stone-900">Step 2 — Register a new app</h3>
              <ol className="ml-5 list-decimal space-y-2 text-sm text-stone-600">
                <li>Click <strong>+ New registration</strong>.</li>
                <li>Name it <code className="rounded bg-stone-100 px-1">Daykeeper</code>.</li>
                <li>Under <strong>Supported account types</strong>, choose <strong>"Accounts in this organizational directory only"</strong>.</li>
                <li>Under <strong>Redirect URI</strong>, select <strong>Web</strong> and paste: <div className="mt-1 break-all rounded-md bg-stone-100 px-2 py-1.5 text-xs text-stone-700">{window.location.origin}</div></li>
                <li>Click <strong>Register</strong>.</li>
              </ol>
              <div className="rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-800">Keep this page open — you'll need the <strong>Application (client) ID</strong> and <strong>Directory (tenant) ID</strong> in Step 4.</div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-stone-900">Step 3 — Create a client secret</h3>
              <ol className="ml-5 list-decimal space-y-2 text-sm text-stone-600">
                <li>In the left sidebar, click <strong>Certificates &amp; secrets</strong>.</li>
                <li>Click <strong>+ New client secret</strong>.</li>
                <li>Give it a description and pick an expiry (24 months is fine).</li>
                <li>Click <strong>Add</strong>.</li>
              </ol>
              <div className="rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-800">Copy the <strong>Value</strong> right away — it's hidden after you leave the page.</div>
            </div>
          )}
          {step === 4 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-stone-900">Step 4 — Paste your credentials</h3>
              <div>
                <label className="label">Application (client) ID</label>
                <input type="text" className="input" value={clientId} onChange={(e) => setClientId(e.target.value.trim())} placeholder="e.g. 8a2f1b3c-…" />
              </div>
              <div>
                <label className="label">Directory (tenant) ID</label>
                <input type="text" className="input" value={tenantId} onChange={(e) => setTenantId(e.target.value.trim())} placeholder="e.g. 4b7e9c2a-…" />
              </div>
              <div>
                <label className="label">Client secret (Value)</label>
                <input type="password" className="input" value={clientSecret} onChange={(e) => setClientSecret(e.target.value.trim())} placeholder="Paste the secret value" />
              </div>
              <div>
                <label className="label">Your Microsoft 365 work email</label>
                <input type="email" className="input" value={upn} onChange={(e) => setUpn(e.target.value.trim())} placeholder="you@yourfirm.com" />
                <p className="mt-1 text-xs text-stone-400">Must be a work or school email in your organisation's tenant.</p>
              </div>
              {error && <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={14} /> {error}</div>}
              <div className="border-t border-stone-200 pt-3">
                <button onClick={handleTestConnection} disabled={testing} className="btn-secondary text-sm">{testing ? 'Testing…' : 'Test connection'}</button>
                {testResult && (
                  <div className="mt-2">
                    {testResult.ok ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700"><CheckCircle2 size={14} /> Connection successful! Select your mailbox:</div>
                        <select className="input" value={upn} onChange={(e) => setUpn(e.target.value)}>
                          <option value="">— Select your email —</option>
                          {testResult.users?.map((u) => <option key={u.userPrincipalName} value={u.mail || u.userPrincipalName}>{u.displayName} ({u.mail || u.userPrincipalName})</option>)}
                        </select>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{testResult.error}</span></div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {step === 5 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-stone-900">Step 5 — Grant API permissions</h3>
              <ol className="ml-5 list-decimal space-y-2 text-sm text-stone-600">
                <li>In the left sidebar, click <strong>API permissions</strong>.</li>
                <li>Click <strong>+ Add a permission → Microsoft Graph → Application permissions</strong>.</li>
                <li>Search for and check: <code className="rounded bg-stone-100 px-1">Mail.Read</code>, <code className="rounded bg-stone-100 px-1">Calendars.Read</code>, <code className="rounded bg-stone-100 px-1">User.Read.All</code>.</li>
                <li>Click <strong>Add permissions</strong>.</li>
                <li>Click <strong>Grant admin consent</strong> — all should turn green.</li>
              </ol>
            </div>
          )}
          {step === 6 && (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <CheckCircle2 size={28} className="text-green-600" />
              </div>
              <h3 className="text-base font-semibold text-stone-900">All set!</h3>
              <p className="text-sm text-stone-600">Your Microsoft 365 connection is ready. Outlook and calendar events for <strong>{upn}</strong> will now appear on the day view.</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-stone-200 px-5 py-3">
          <span className="text-xs text-stone-400">Step {step} of {totalSteps}</span>
          <div className="flex items-center gap-2">
            {step > 1 && step < 5 && <button onClick={() => setStep(step - 1)} className="btn-ghost text-sm">Back</button>}
            {step < 4 && <button onClick={() => setStep(step + 1)} className="btn-primary text-sm">Next</button>}
            {step === 4 && <button onClick={handleFinish} disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save & continue'}</button>}
            {step === 5 && <button onClick={() => setStep(step + 1)} className="btn-primary text-sm">Done</button>}
            {step === 6 && <button onClick={onClose} className="btn-primary text-sm">Close</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
