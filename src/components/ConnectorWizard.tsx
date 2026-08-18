import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { CustomConnector, CustomConnectorAuthType, CustomConnectorFieldMapping } from '@/types';
import {
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  Webhook,
  ChevronRight,
  ChevronLeft,
  Key,
  Globe,
  Settings2,
  TestTube,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Zap,
} from 'lucide-react';
import { BRAND_ICON_MAP } from '@/components/BrandIcons';

const CUSTOM_FETCH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/custom-fetch`;

const ICON_OPTIONS = [
  'webhook', 'message-square', 'file-text', 'calendar', 'mail',
  'phone', 'video', 'database', 'cloud', 'code',
  'briefcase', 'folder', 'git-branch', 'bug', 'check-square',
  'clipboard', 'clock', 'book-open', 'pen-tool', 'zap',
] as const;

interface ConnectorPreset {
  name: string;
  headline: string;
  description: string;
  useCases: string[];
  iconKey: string;
  brandIcon?: string;
  authType: CustomConnectorAuthType;
  baseUrl: string;
  endpointPath: string;
  httpMethod: 'GET' | 'POST';
  dateParamName: string;
  dateParamFormat: 'iso' | 'unix' | 'YYYY-MM-DD';
  endDateParamName: string;
  responseItemsPath: string;
  fieldMapping: CustomConnectorFieldMapping;
  extraHeaders: Record<string, string>;
  helpUrl: string;
  accentColor: string;
}

const PRESETS: ConnectorPreset[] = [
  {
    name: 'Slack',
    headline: 'Capture Slack channel messages as activity',
    description: 'Pull messages from Slack channels you belong to, so every conversation is visible in your day timeline and can be attributed to a matter.',
    useCases: ['Track time spent in client channels', 'Attribute Slack conversations to matters', 'See messaging volume across your day'],
    iconKey: 'message-square',
    brandIcon: 'slack',
    authType: 'bearer',
    baseUrl: 'https://slack.com',
    endpointPath: '/api/conversations.history',
    httpMethod: 'GET',
    dateParamName: 'oldest',
    dateParamFormat: 'unix',
    endDateParamName: 'latest',
    responseItemsPath: 'messages',
    fieldMapping: { timestamp: 'ts', summary: 'text', id: 'ts' },
    extraHeaders: {},
    helpUrl: 'https://api.slack.com/methods/conversations.history',
    accentColor: '#611f69',
  },
  {
    name: 'Asana',
    headline: 'Track Asana tasks as billable activity',
    description: 'Sync tasks and subtasks assigned to you in Asana so completing work items shows up automatically in your day timeline.',
    useCases: ['Auto-detect task completions', 'Attribute Asana tasks to client matters', 'See task workload across your week'],
    iconKey: 'check-square',
    brandIcon: 'asana',
    authType: 'bearer',
    baseUrl: 'https://app.asana.com',
    endpointPath: '/api/1.0/tasks',
    httpMethod: 'GET',
    dateParamName: 'modified_since',
    dateParamFormat: 'iso',
    endDateParamName: '',
    responseItemsPath: 'data',
    fieldMapping: { timestamp: 'modified_at', summary: 'name', id: 'gid', durationMinutes: 'num_subtasks' },
    extraHeaders: {},
    helpUrl: 'https://developers.asana.com/reference/gettasks',
    accentColor: '#f06a6a',
  },
  {
    name: 'Jira Cloud',
    headline: 'See Jira issue activity in your timeline',
    description: 'Track issues you created or updated in Jira so development work is captured alongside meetings and emails.',
    useCases: ['Auto-detect Jira issue updates', 'Attribute development work to matters', 'Track time on tickets without manual entry'],
    iconKey: 'bug',
    brandIcon: 'jira',
    authType: 'basic',
    baseUrl: 'https://your-domain.atlassian.net',
    endpointPath: '/rest/api/3/search',
    httpMethod: 'GET',
    dateParamName: 'jql',
    dateParamFormat: 'YYYY-MM-DD',
    endDateParamName: '',
    responseItemsPath: 'issues',
    fieldMapping: { timestamp: 'fields.updated', summary: 'fields.summary', id: 'id', endTimestamp: 'fields.created' },
    extraHeaders: {},
    helpUrl: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/',
    accentColor: '#0052cc',
  },
  {
    name: 'GitHub',
    headline: 'Capture GitHub activity as work time',
    description: 'Pull your recent GitHub activity events — commits, PRs, reviews — so code work shows up in your day timeline.',
    useCases: ['Track commits and pull requests', 'Attribute development work to matters', 'See coding activity across your day'],
    iconKey: 'git-branch',
    brandIcon: 'github',
    authType: 'bearer',
    baseUrl: 'https://api.github.com',
    endpointPath: '/users/{username}/events',
    httpMethod: 'GET',
    dateParamName: '',
    dateParamFormat: 'iso',
    endDateParamName: '',
    responseItemsPath: '',
    fieldMapping: { timestamp: 'created_at', summary: 'type', id: 'id' },
    extraHeaders: {},
    helpUrl: 'https://docs.github.com/en/rest/activity/events',
    accentColor: '#24292e',
  },
  {
    name: 'Trello',
    headline: 'Track Trello board activity automatically',
    description: 'Capture card movements, comments, and updates on your Trello boards so project management work is visible in your timeline.',
    useCases: ['Track card moves and comments', 'Attribute Trello activity to matters', 'See board engagement across your day'],
    iconKey: 'clipboard',
    brandIcon: 'trello',
    authType: 'api_key',
    baseUrl: 'https://api.trello.com',
    endpointPath: '/1/members/me/actions',
    httpMethod: 'GET',
    dateParamName: 'since',
    dateParamFormat: 'YYYY-MM-DD',
    endDateParamName: 'before',
    responseItemsPath: '',
    fieldMapping: { timestamp: 'date', summary: 'type', id: 'id' },
    extraHeaders: {},
    helpUrl: 'https://developer.atlassian.com/cloud/trello/rest/api-group-actions/',
    accentColor: '#0079bf',
  },
  {
    name: 'HubSpot',
    headline: 'Log HubSpot meetings, calls, and emails',
    description: 'Pull meetings, calls, emails, and notes logged in HubSpot so CRM activity is captured in your day timeline.',
    useCases: ['Auto-detect HubSpot meetings and calls', 'Attribute CRM activity to matters', 'Track client engagement time'],
    iconKey: 'briefcase',
    brandIcon: 'hubspot',
    authType: 'bearer',
    baseUrl: 'https://api.hubapi.com',
    endpointPath: '/engagements/v1/engagements/paged',
    httpMethod: 'GET',
    dateParamName: 'offset',
    dateParamFormat: 'unix',
    endDateParamName: '',
    responseItemsPath: 'results',
    fieldMapping: { timestamp: 'engagement.createdAt', summary: 'engagement.type', id: 'engagement.id' },
    extraHeaders: {},
    helpUrl: 'https://developers.hubspot.com/docs/methods/engagements/get-engagements',
    accentColor: '#ff7a59',
  },
  {
    name: 'Notion',
    headline: 'Track Notion page edits as activity',
    description: 'Capture pages and database entries you created or edited in Notion so documentation work appears in your day timeline.',
    useCases: ['Track page edits and creations', 'Attribute documentation work to matters', 'See knowledge management activity'],
    iconKey: 'book-open',
    brandIcon: 'notion',
    authType: 'bearer',
    baseUrl: 'https://api.notion.com',
    endpointPath: '/v1/search',
    httpMethod: 'POST',
    dateParamName: '',
    dateParamFormat: 'iso',
    endDateParamName: '',
    responseItemsPath: 'results',
    fieldMapping: { timestamp: 'last_edited_time', summary: 'properties.title.title.0.plain_text', id: 'id' },
    extraHeaders: { 'Notion-Version': '2022-06-28' },
    helpUrl: 'https://developers.notion.com/reference/search',
    accentColor: '#000000',
  },
  {
    name: 'Linear',
    headline: 'See Linear issue updates in your timeline',
    description: 'Sync issues assigned to you in Linear so bug fixes and feature work are captured automatically in your day timeline.',
    useCases: ['Track issue updates and completions', 'Attribute development work to matters', 'See sprint activity at a glance'],
    iconKey: 'zap',
    brandIcon: 'linear',
    authType: 'api_key',
    baseUrl: 'https://api.linear.app',
    endpointPath: '/v1/issues',
    httpMethod: 'GET',
    dateParamName: 'updatedSince',
    dateParamFormat: 'iso',
    endDateParamName: '',
    responseItemsPath: 'nodes',
    fieldMapping: { timestamp: 'updatedAt', summary: 'title', id: 'id', endTimestamp: 'createdAt' },
    extraHeaders: {},
    helpUrl: 'https://developers.linear.app/docs/',
    accentColor: '#5e6ad2',
  },
  {
    name: 'Zendesk',
    headline: 'Capture Zendesk ticket activity',
    description: 'Track tickets you were assigned or commented on in Zendesk so support work shows up in your day timeline.',
    useCases: ['Track ticket updates and replies', 'Attribute support time to matters', 'See ticket volume across your day'],
    iconKey: 'mail',
    brandIcon: 'zendesk',
    authType: 'bearer',
    baseUrl: 'https://your-subdomain.zendesk.com',
    endpointPath: '/api/v2/tickets',
    httpMethod: 'GET',
    dateParamName: 'updated_since',
    dateParamFormat: 'iso',
    endDateParamName: '',
    responseItemsPath: 'tickets',
    fieldMapping: { timestamp: 'updated_at', summary: 'subject', id: 'id' },
    extraHeaders: {},
    helpUrl: 'https://developer.zendesk.com/api-reference/',
    accentColor: '#03363d',
  },
  {
    name: 'ClickUp',
    headline: 'Pull ClickUp tasks and time entries',
    description: 'Sync tasks and time entries from your ClickUp workspace so project work is captured automatically in your day timeline.',
    useCases: ['Track task completions and time entries', 'Attribute project work to matters', 'See ClickUp activity across your week'],
    iconKey: 'clock',
    brandIcon: 'clickup',
    authType: 'api_key',
    baseUrl: 'https://api.clickup.com',
    endpointPath: '/api/v2/team/{team_id}/time_entries',
    httpMethod: 'GET',
    dateParamName: 'start_date',
    dateParamFormat: 'unix',
    endDateParamName: 'end_date',
    responseItemsPath: 'data',
    fieldMapping: { timestamp: 'start', summary: 'description', id: 'id', durationMinutes: 'duration' },
    extraHeaders: {},
    helpUrl: 'https://developer.clickup.com/docs/',
    accentColor: '#7b68ee',
  },
];

interface ConnectorWizardProps {
  onClose: () => void;
  onSaved: () => Promise<void>;
  existing?: CustomConnector | null;
}

export function ConnectorWizard({ onClose, onSaved, existing }: ConnectorWizardProps) {
  const isEdit = !!existing;
  const [step, setStep] = useState(1);
  const [showPresets, setShowPresets] = useState(!isEdit);
  const [selectedPreset, setSelectedPreset] = useState<ConnectorPreset | null>(null);
  const [selectedPresetBrandIcon, setSelectedPresetBrandIcon] = useState<React.FC<{ size?: number; className?: string }> | null>(null);
  const [name, setName] = useState(existing?.name ?? '');
  const [iconKey, setIconKey] = useState(existing?.icon_key ?? 'webhook');
  const [authType, setAuthType] = useState<CustomConnectorAuthType>(existing?.auth_type ?? 'api_key');
  const [baseUrl, setBaseUrl] = useState(existing?.base_url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [endpointPath, setEndpointPath] = useState(existing?.endpoint_path ?? '');
  const [httpMethod, setHttpMethod] = useState<'GET' | 'POST'>(existing?.http_method ?? 'GET');
  const [dateParamName, setDateParamName] = useState(existing?.date_param_name ?? 'since');
  const [dateParamFormat, setDateParamFormat] = useState<'iso' | 'unix' | 'YYYY-MM-DD'>(existing?.date_param_format ?? 'iso');
  const [endDateParamName, setEndDateParamName] = useState(existing?.end_date_param_name ?? '');
  const [responseItemsPath, setResponseItemsPath] = useState(existing?.response_items_path ?? '');
  const [fieldMapping, setFieldMapping] = useState<CustomConnectorFieldMapping>(existing?.field_mapping ?? {});
  const [extraHeaders, setExtraHeaders] = useState<Record<string, string>>(existing?.extra_headers ?? {});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; count?: number; sample?: unknown[]; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSteps = 5;

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(CUSTOM_FETCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          action: 'test',
          config: {
            base_url: baseUrl,
            endpoint_path: endpointPath,
            http_method: httpMethod,
            auth_type: authType,
            date_param_name: dateParamName,
            date_param_format: dateParamFormat,
            end_date_param_name: endDateParamName || null,
            response_items_path: responseItemsPath || null,
            field_mapping: fieldMapping,
            extra_headers: extraHeaders,
          },
          api_key: apiKey || null,
        }),
      });
      const result = await response.json();
      if (response.ok && result.ok) {
        setTestResult({ ok: true, count: result.itemCount, sample: result.sample });
      } else {
        setTestResult({ ok: false, error: result.error ?? 'Test failed' });
      }
    } catch {
      setTestResult({ ok: false, error: 'Network error — could not reach the server' });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('org_id')
        .maybeSingle();

      if (!profileData?.org_id) {
        setError('No organisation found for your account.');
        setSaving(false);
        return;
      }

      const payload = {
        org_id: profileData.org_id,
        name,
        icon_key: iconKey,
        auth_type: authType,
        base_url: baseUrl.replace(/\/$/, ''),
        endpoint_path: endpointPath,
        http_method: httpMethod,
        date_param_name: dateParamName,
        date_param_format: dateParamFormat,
        end_date_param_name: endDateParamName || null,
        response_items_path: responseItemsPath || null,
        field_mapping: fieldMapping,
        extra_headers: extraHeaders,
        status: 'active' as const,
      };

      if (isEdit && existing) {
        const updatePayload = { ...payload, updated_at: new Date().toISOString() } as Record<string, unknown>;
        if (apiKey) (updatePayload as Record<string, unknown>).api_key_encrypted = apiKey;
        const { error: updateError } = await supabase
          .from('custom_connectors')
          .update(updatePayload)
          .eq('id', existing.id);
        if (updateError) throw updateError;
      } else {
        const insertPayload = { ...payload, api_key_encrypted: apiKey || null } as Record<string, unknown>;
        const { error: insertError } = await supabase
          .from('custom_connectors')
          .insert(insertPayload);
        if (insertError) throw insertError;
      }

      await onSaved();
      setStep(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save connector');
    } finally {
      setSaving(false);
    }
  }

  function applyPreset(preset: ConnectorPreset) {
    setName(preset.name);
    setIconKey(preset.iconKey);
    setAuthType(preset.authType);
    setBaseUrl(preset.baseUrl);
    setEndpointPath(preset.endpointPath);
    setHttpMethod(preset.httpMethod);
    setDateParamName(preset.dateParamName);
    setDateParamFormat(preset.dateParamFormat);
    setEndDateParamName(preset.endDateParamName);
    setResponseItemsPath(preset.responseItemsPath);
    setFieldMapping(preset.fieldMapping);
    setExtraHeaders(preset.extraHeaders);
    setShowPresets(false);
    setSelectedPreset(null);
    setSelectedPresetBrandIcon(() => preset.brandIcon && BRAND_ICON_MAP[preset.brandIcon] ? BRAND_ICON_MAP[preset.brandIcon] : null);
  }

  const canProceed = (s: number): boolean => {
    if (s === 1) return name.trim().length > 0;
    if (s === 2) return baseUrl.trim().length > 0 && endpointPath.trim().length > 0;
    if (s === 3) return authType === 'none' || apiKey.trim().length > 0 || isEdit;
    if (s === 4) return !!fieldMapping.timestamp && !!fieldMapping.summary;
    return true;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Webhook size={18} className="text-stone-700" />
            <h2 className="text-base font-semibold text-stone-900">
              {isEdit ? 'Edit connector' : 'Add a custom connector'}
            </h2>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700">
            <X size={18} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex gap-1.5 px-5 pt-4">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i + 1 <= step ? 'bg-accent-500' : 'bg-stone-200'}`} />
          ))}
        </div>

        <div className="px-5 py-5">
          {/* Step 1: Name & Icon */}
          {step === 1 && (
            <div className="space-y-4">
              {showPresets && !isEdit ? (
                selectedPreset ? (
                  <PresetDetail
                    preset={selectedPreset}
                    onBack={() => setSelectedPreset(null)}
                    onApply={() => applyPreset(selectedPreset)}
                  />
                ) : (
                <>
                  <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                    <Webhook size={16} className="text-accent-600" /> Start from a template
                  </div>
                  <p className="text-sm text-stone-600">
                    Pick a popular app to see what it captures. You can tweak everything in the next steps.
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => setSelectedPreset(preset)}
                        className="flex items-start gap-3 rounded-lg border border-stone-200 p-3 text-left transition-colors hover:border-accent-400 hover:bg-accent-50"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-stone-100">
                          {preset.brandIcon && BRAND_ICON_MAP[preset.brandIcon] ? (
                            (() => { const BIcon = BRAND_ICON_MAP[preset.brandIcon]; return <BIcon size={18} />; })()
                          ) : (
                            <IconPreview iconKey={preset.iconKey} size={18} className="text-stone-600" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-stone-900">{preset.name}</p>
                          <p className="text-xs text-stone-500">{preset.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowPresets(false)}
                    className="text-sm font-medium text-accent-600 hover:text-accent-700"
                  >
                    Or configure manually →
                  </button>
                </>
                )
              ) : (
                <>
                  {!isEdit && (
                    <button
                      onClick={() => setShowPresets(true)}
                      className="text-sm font-medium text-accent-600 hover:text-accent-700"
                    >
                      ← Pick from templates
                    </button>
                  )}
                  <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                    <Webhook size={16} className="text-accent-600" /> Name your connector
                  </div>
                  <p className="text-sm text-stone-600">
                    Give this connector a name your team will recognise — e.g. "Slack", "Jira", "HubSpot".
                  </p>
                  <div>
                    <label className="label">Connector name</label>
                    <input
                      type="text"
                      className="input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Slack"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="label">Icon</label>
                    {selectedPresetBrandIcon ? (
                      <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm">
                          {(() => { const BIcon = selectedPresetBrandIcon; return <BIcon size={24} />; })()}
                        </div>
                        <span className="text-sm text-stone-500">{name || 'Selected'} logo</span>
                      </div>
                    ) : (
                      <>
                        <p className="mb-2 text-xs text-stone-400">Pick an icon that represents this app.</p>
                        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
                          {ICON_OPTIONS.map((icon) => (
                            <button
                              key={icon}
                              onClick={() => setIconKey(icon)}
                              className={`flex flex-col items-center gap-1 rounded-lg border p-2 transition-colors ${
                                iconKey === icon ? 'border-accent-400 bg-accent-50' : 'border-stone-200 hover:border-stone-300'
                              }`}
                            >
                              <IconPreview iconKey={icon} size={20} className={iconKey === icon ? 'text-accent-600' : 'text-stone-500'} />
                              <span className="text-[10px] text-stone-500">{icon}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 2: API endpoint */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                <Globe size={16} className="text-accent-600" /> API endpoint
              </div>
              <p className="text-sm text-stone-600">
                Enter the base URL and the path to the endpoint that returns activity data.
                Replace placeholders like <code className="rounded bg-stone-100 px-1">{'{username}'}</code> or <code className="rounded bg-stone-100 px-1">{'{team_id}'}</code> with your actual values.
              </p>
              <div>
                <label className="label">Base URL</label>
                <input
                  type="text"
                  className="input"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.slack.com"
                />
              </div>
              <div>
                <label className="label">Endpoint path</label>
                <input
                  type="text"
                  className="input"
                  value={endpointPath}
                  onChange={(e) => setEndpointPath(e.target.value)}
                  placeholder="/api/v1/activity"
                />
                <p className="mt-1 text-xs text-stone-400">The full URL will be: <code className="rounded bg-stone-100 px-1">{baseUrl.replace(/\/$/, '')}{endpointPath || '/...'}</code></p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">HTTP method</label>
                  <select className="input" value={httpMethod} onChange={(e) => setHttpMethod(e.target.value as 'GET' | 'POST')}>
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                </div>
                <div>
                  <label className="label">Date format</label>
                  <select className="input" value={dateParamFormat} onChange={(e) => setDateParamFormat(e.target.value as 'iso' | 'unix' | 'YYYY-MM-DD')}>
                    <option value="iso">ISO 8601</option>
                    <option value="unix">Unix timestamp</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Start date parameter</label>
                  <input
                    type="text"
                    className="input"
                    value={dateParamName}
                    onChange={(e) => setDateParamName(e.target.value)}
                    placeholder="since"
                  />
                </div>
                <div>
                  <label className="label">End date parameter (optional)</label>
                  <input
                    type="text"
                    className="input"
                    value={endDateParamName}
                    onChange={(e) => setEndDateParamName(e.target.value)}
                    placeholder="until"
                  />
                </div>
              </div>
              <div>
                <label className="label">Extra headers (optional)</label>
                <p className="mb-2 text-xs text-stone-400">
                  Some APIs require additional headers (e.g. Notion needs <code className="rounded bg-stone-100 px-1">Notion-Version</code>).
                </p>
                <div className="space-y-2">
                  {Object.entries(extraHeaders).map(([key, val], i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        className="input flex-1 text-sm"
                        value={key}
                        onChange={(e) => {
                          const entries = Object.entries(extraHeaders);
                          entries[i] = [e.target.value, val];
                          setExtraHeaders(Object.fromEntries(entries));
                        }}
                        placeholder="Header name"
                      />
                      <input
                        type="text"
                        className="input flex-1 text-sm"
                        value={val}
                        onChange={(e) => {
                          const entries = Object.entries(extraHeaders);
                          entries[i] = [key, e.target.value];
                          setExtraHeaders(Object.fromEntries(entries));
                        }}
                        placeholder="Header value"
                      />
                      <button
                        onClick={() => {
                          const entries = Object.entries(extraHeaders);
                          entries.splice(i, 1);
                          setExtraHeaders(Object.fromEntries(entries));
                        }}
                        className="text-stone-400 hover:text-red-500"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setExtraHeaders({ ...extraHeaders, '': '' })}
                    className="text-sm font-medium text-accent-600 hover:text-accent-700"
                  >
                    + Add header
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Authentication */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                <Key size={16} className="text-accent-600" /> Authentication
              </div>
              <p className="text-sm text-stone-600">
                How does this API authenticate requests? The secret is stored encrypted and never sent back to the browser.
              </p>
              <div>
                <label className="label">Auth type</label>
                <select className="input" value={authType} onChange={(e) => setAuthType(e.target.value as CustomConnectorAuthType)}>
                  <option value="api_key">API Key (X-API-Key header)</option>
                  <option value="bearer">Bearer token (Authorization: Bearer)</option>
                  <option value="basic">Basic auth (username:password)</option>
                  <option value="none">No authentication</option>
                </select>
              </div>
              {authType !== 'none' && (
                <div>
                  <label className="label">
                    {authType === 'basic' ? 'Credentials (username:password)' : authType === 'bearer' ? 'Bearer token' : 'API key'}
                  </label>
                  <input
                    type="password"
                    className="input"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={isEdit ? 'Enter new value to replace, or leave blank to keep existing' : 'Paste your key or token'}
                  />
                  {isEdit && (
                    <p className="mt-1 text-xs text-stone-400">
                      Leave blank to keep the existing secret.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Response mapping */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                <Settings2 size={16} className="text-accent-600" /> Map response fields
              </div>
              <p className="text-sm text-stone-600">
                Tell Daykeeper how to read the API response. Enter the JSON path (using dots) for each field.
                The "items path" is where the array of activity items lives in the response.
              </p>
              <div>
                <label className="label">Items array path (optional)</label>
                <input
                  type="text"
                  className="input"
                  value={responseItemsPath}
                  onChange={(e) => setResponseItemsPath(e.target.value)}
                  placeholder="e.g. data.items (leave blank if response is already an array)"
                />
              </div>
              <div className="rounded-md bg-stone-50 p-3">
                <p className="mb-2 text-xs font-medium text-stone-600">Required fields:</p>
                <div className="space-y-2">
                  <MappingInput label="Timestamp" value={fieldMapping.timestamp ?? ''} onChange={(v) => setFieldMapping({ ...fieldMapping, timestamp: v })} placeholder="created_at" />
                  <MappingInput label="Summary / label" value={fieldMapping.summary ?? ''} onChange={(v) => setFieldMapping({ ...fieldMapping, summary: v })} placeholder="title" />
                </div>
                <p className="mb-2 mt-4 text-xs font-medium text-stone-600">Optional fields:</p>
                <div className="space-y-2">
                  <MappingInput label="ID" value={fieldMapping.id ?? ''} onChange={(v) => setFieldMapping({ ...fieldMapping, id: v })} placeholder="id" />
                  <MappingInput label="Duration (minutes)" value={fieldMapping.durationMinutes ?? ''} onChange={(v) => setFieldMapping({ ...fieldMapping, durationMinutes: v })} placeholder="duration" />
                  <MappingInput label="End timestamp" value={fieldMapping.endTimestamp ?? ''} onChange={(v) => setFieldMapping({ ...fieldMapping, endTimestamp: v })} placeholder="ended_at" />
                </div>
              </div>
              <div className="flex items-center gap-2 border-t border-stone-200 pt-3">
                <button onClick={handleTest} disabled={testing} className="btn-secondary text-sm">
                  {testing ? (
                    <span className="flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Testing…</span>
                  ) : (
                    <span className="flex items-center gap-1.5"><TestTube size={14} /> Test connection</span>
                  )}
                </button>
              </div>
              {testResult && (
                <div className={`rounded-md px-3 py-2 text-sm ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {testResult.ok ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={14} />
                      Found {testResult.count ?? 0} items
                      {testResult.sample && testResult.sample.length > 0 && (
                        <span className="text-xs text-green-600">— first item: {JSON.stringify(testResult.sample[0]).slice(0, 100)}…</span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>{testResult.error}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 5: Success */}
          {step === 5 && (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <CheckCircle2 size={28} className="text-green-600" />
              </div>
              <h3 className="text-base font-semibold text-stone-900">Connector saved!</h3>
              <p className="text-sm text-stone-600">
                <strong>{name}</strong> is now available. Activity from this connector will appear
                on the day view alongside your other connected sources.
              </p>
              <button onClick={onClose} className="btn-primary text-sm">Done</button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-stone-200 px-5 py-3">
          <span className="text-xs text-stone-400">Step {step} of {totalSteps}</span>
          <div className="flex items-center gap-2">
            {step > 1 && step < 5 && (
              <button onClick={() => setStep(step - 1)} className="btn-ghost text-sm flex items-center gap-1">
                <ChevronLeft size={14} /> Back
              </button>
            )}
            {step < 4 && (
              <button
                onClick={() => setStep(step + 1)}
                disabled={!canProceed(step)}
                className="btn-primary text-sm flex items-center gap-1"
              >
                Next <ChevronRight size={14} />
              </button>
            )}
            {step === 4 && (
              <button
                onClick={handleSave}
                disabled={saving || !canProceed(4)}
                className="btn-primary text-sm"
              >
                {saving ? 'Saving…' : 'Save connector'}
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="border-t border-stone-200 px-5 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function MappingInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="text-xs text-stone-500 sm:w-32 sm:shrink-0">{label}</label>
      <input
        type="text"
        className="input flex-1 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

// Dynamically render a lucide icon by name
import {
  MessageSquare, FileText, Calendar, Mail, Phone, Video,
  Database, Cloud, Code, Briefcase, Folder, GitBranch, Bug,
  CheckSquare, Clipboard, Clock, BookOpen, PenTool,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  'message-square': MessageSquare,
  'file-text': FileText,
  'calendar': Calendar,
  'mail': Mail,
  'phone': Phone,
  'video': Video,
  'database': Database,
  'cloud': Cloud,
  'code': Code,
  'briefcase': Briefcase,
  'folder': Folder,
  'git-branch': GitBranch,
  'bug': Bug,
  'check-square': CheckSquare,
  'clipboard': Clipboard,
  'clock': Clock,
  'book-open': BookOpen,
  'pen-tool': PenTool,
  'zap': Zap,
  'webhook': Webhook,
};

export function IconPreview({ iconKey, size = 18, className = '' }: { iconKey: string; size?: number; className?: string }) {
  const Icon = ICON_MAP[iconKey] ?? Webhook;
  return <Icon size={size} className={className} />;
}

// ─── Preset detail view (shown when a template is selected) ──────────────────
function PresetDetail({
  preset,
  onBack,
  onApply,
}: {
  preset: ConnectorPreset;
  onBack: () => void;
  onApply: () => void;
}) {
  const { name, headline, description, useCases, iconKey, accentColor, helpUrl, baseUrl, endpointPath, httpMethod, authType } = preset;

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 transition-colors">
        <ArrowLeft size={14} /> Back to templates
      </button>

      <div className="flex gap-4">
        {/* Left illustration */}
        <div className="flex w-28 shrink-0 flex-col items-center rounded-xl p-4" style={{ background: `linear-gradient(135deg, ${accentColor}14, ${accentColor}06)` }}>
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-white shadow-sm border border-stone-200">
            {preset.brandIcon && BRAND_ICON_MAP[preset.brandIcon] ? (
              (() => { const BIcon = BRAND_ICON_MAP[preset.brandIcon]; return <BIcon size={28} />; })()
            ) : (
              <IconPreview iconKey={iconKey} size={28} className="text-stone-700" />
            )}
          </div>
          <span className="text-sm font-semibold text-stone-900">{name}</span>
        </div>

        {/* Right content */}
        <div className="flex-1 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-stone-900">{headline}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-600">{description}</p>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Use cases</p>
            <ul className="space-y-1.5">
              {useCases.map((uc) => (
                <li key={uc} className="flex items-start gap-2 text-sm text-stone-700">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-accent-500" />
                  {uc}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">API details</p>
            <div className="space-y-1.5 rounded-lg bg-stone-50 px-3 py-2.5 text-xs">
              <div className="flex items-center gap-2 text-stone-600">
                <Globe size={12} className="text-stone-400" />
                <span className="font-mono">{baseUrl}{endpointPath}</span>
              </div>
              <div className="flex items-center gap-2 text-stone-600">
                <Settings2 size={12} className="text-stone-400" />
                <span>{httpMethod} request · {authType === 'bearer' ? 'Bearer token' : authType === 'basic' ? 'Basic auth' : 'API key'}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={onApply} className="btn-primary text-sm flex items-center gap-2">
              Use this template <ArrowRight size={14} />
            </button>
            <a href={helpUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost text-sm flex items-center gap-1">
              <ExternalLink size={12} /> API docs
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
