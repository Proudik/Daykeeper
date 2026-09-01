import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import {
  detectExtension,
  pairExtension,
  unpairExtension,
  getExtensionStatus,
  setRecording,
  setScope,
  openExtensionSettings,
  deriveDeviceLabel,
  isExtensionSupported,
  setMockState,
} from '@/lib/extensionBridge';
import {
  fetchDevices,
  issueDeviceToken,
  revokeDevice,
  deleteDaySignals,
  deleteAllSignals,
} from '@/lib/signals';
import type { BridgeState, ExtensionStatus, PairedDevice } from '@/types/signals';
import {
  Download, Chrome, Power, Shield, Trash2, Copy, Check, ChevronDown, ChevronUp,
  Monitor, AlertCircle, ExternalLink, Lock,
} from 'lucide-react';
import { todayLocal } from '@/lib/time';

interface ExtensionManifest {
  version: string;
  file: string;
}

export function ConnectedBrowsersPage() {
  const { profile } = useAuth();
  const [bridgeState, setBridgeState] = useState<BridgeState>('not_installed');
  const [extVersion, setExtVersion] = useState<string | undefined>();
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [manifest, setManifest] = useState<ExtensionManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [hostPermissionUrl, setHostPermissionUrl] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [scopeMode, setScopeMode] = useState<'all' | 'allowlist'>('allowlist');
  const [manualToken, setManualToken] = useState<string | null>(null);
  const [manualEndpoint, setManualEndpoint] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [deleteChoice, setDeleteChoice] = useState<'today' | 'all' | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [installCollapsed, setInstallCollapsed] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load extension manifest
  useEffect(() => {
    fetch('/extension.json')
      .then((r) => r.json())
      .then((d) => setManifest(d))
      .catch(() => setManifest(null));
  }, []);

  // Detect extension and poll status
  const refreshBridge = useCallback(async () => {
    const det = await detectExtension();
    setBridgeState(det.state);
    setExtVersion(det.version);
    setDeviceId(det.deviceId);
    if (det.state === 'paired') {
      const s = await getExtensionStatus();
      setStatus(s);
      if (s) setScopeMode(s.mode);
    }
  }, []);

  useEffect(() => {
    refreshBridge();
    setLoading(false);
    pollRef.current = setInterval(() => {
      if (!document.hidden) refreshBridge();
    }, 15_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refreshBridge]);

  // Load devices
  const refreshDevices = useCallback(async () => {
    const d = await fetchDevices();
    setDevices(d);
  }, []);

  useEffect(() => { refreshDevices(); }, [refreshDevices]);

  // Restore pending pairing credentials from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('daykeeper:pending-pair');
      if (saved) {
        const { endpoint, token } = JSON.parse(saved);
        if (endpoint && token) {
          setManualEndpoint(endpoint);
          setManualToken(token);
          setShowManual(true);
        }
      }
    } catch {
      localStorage.removeItem('daykeeper:pending-pair');
    }
  }, []);

  // Clear stored credentials once the extension is actually paired
  useEffect(() => {
    if (bridgeState === 'paired') {
      localStorage.removeItem('daykeeper:pending-pair');
      setManualToken(null);
      setManualEndpoint(null);
      setShowManual(false);
    }
  }, [bridgeState]);

  // Collapse install block when extension detected
  useEffect(() => {
    if (bridgeState === 'paired' || bridgeState === 'installed_unpaired') {
      setInstallCollapsed(true);
    }
  }, [bridgeState]);

  const supported = isExtensionSupported();

  // --- Actions ---

  async function handleConnect() {
    setPairing(true);
    setPairError(null);
    setHostPermissionUrl(null);
    try {
      const label = deriveDeviceLabel();
      const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/signals`;
      const token = await issueDeviceToken(label);
      if (!token) {
        setPairError('Could not issue a device token. Try again.');
        setPairing(false);
        return;
      }
      // Token passes straight from RPC to the message — never stored in state
      const result = await pairExtension(endpoint, token);
      if (!result.ok && result.error === 'host_permission_required') {
        setHostPermissionUrl(result.options_url || '');
        setPairing(false);
        return;
      }
      if (!result.ok) {
        // Auto-pairing failed — persist credentials so they survive refresh/navigation
        localStorage.setItem('daykeeper:pending-pair', JSON.stringify({ endpoint, token }));
        setManualToken(token);
        setManualEndpoint(endpoint);
        setShowManual(true);
        setPairError('Automatic pairing failed. Use the manual setup below — copy the endpoint and token into the extension settings page.');
        setPairing(false);
        return;
      }
      await refreshBridge();
      await refreshDevices();
    } catch {
      setPairError('Something went wrong during pairing.');
    }
    setPairing(false);
  }

  async function handleManualPair() {
    setPairing(true);
    setPairError(null);
    try {
      const label = deriveDeviceLabel();
      const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/signals`;
      const token = await issueDeviceToken(label);
      if (!token) {
        setPairError('Could not issue a device token.');
        setPairing(false);
        return;
      }
      localStorage.setItem('daykeeper:pending-pair', JSON.stringify({ endpoint, token }));
      setManualToken(token);
      setManualEndpoint(endpoint);
      await refreshDevices();
    } catch {
      setPairError('Something went wrong.');
    }
    setPairing(false);
  }

  async function handleToggleRecording() {
    if (!status) return;
    setToggling(true);
    await setRecording(status.paused); // flip
    const s = await getExtensionStatus();
    setStatus(s);
    setToggling(false);
  }

  async function handleScopeChange(mode: 'all' | 'allowlist') {
    await setScope(mode);
    setScopeMode(mode);
    const s = await getExtensionStatus();
    setStatus(s);
  }

  async function handleRevoke(device: PairedDevice) {
    if (!confirm(`Revoke "${device.label ?? 'This device'}"? It will stop sending data.`)) return;
    const isCurrent = device.id === deviceId;
    await revokeDevice(device.id);
    if (isCurrent) await unpairExtension();
    await refreshDevices();
    await refreshBridge();
  }

  async function handleDelete() {
    if (!deleteChoice) return;
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    if (deleteChoice === 'today') await deleteDaySignals(todayLocal());
    else await deleteAllSignals();
    setDeleteChoice(null);
    setDeleteConfirm(false);
  }

  function copyToken() {
    if (!manualToken) return;
    navigator.clipboard.writeText(manualToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  }

  function copyEndpoint() {
    if (!manualEndpoint) return;
    navigator.clipboard.writeText(manualEndpoint);
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 2000);
  }

  // --- Render ---

  if (loading) {
    return <div className="p-8 text-sm text-stone-400">Loading...</div>;
  }

  const recording = status?.recording ?? false;
  const paused = status?.paused ?? false;
  const toggleDisabled = bridgeState !== 'paired' || toggling;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-stone-900">Connected browsers</h1>

      {/* === Unsupported browser === */}
      {bridgeState === 'unsupported' && (
        <section className="card mb-6 border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-900">This browser can't connect to the extension</p>
              <p className="mt-1 text-sm text-amber-700">
                The Daykeeper Signals extension requires a Chromium browser: Chrome, Edge, Brave or Arc.
                Switch to one of those to pair this device.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* === Install / download block === */}
      {bridgeState !== 'unsupported' && (
        <section className="card mb-6 p-5">
          {!installCollapsed ? (
            <>
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Install the extension
              </h2>
              <div className="mt-4 flex items-center gap-4">
                <a
                  href={manifest ? `/${manifest.file}` : '/daykeeper-signals.zip'}
                  download
                  className="btn-primary"
                >
                  <Download size={16} />
                  Download the Chrome extension
                </a>
                {manifest && (
                  <span className="text-xs text-stone-400" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    v{manifest.version}
                  </span>
                )}
              </div>

              {!supported && (
                <p className="mt-3 text-xs text-amber-600">
                  The extension needs a Chromium browser: Chrome, Edge, Brave or Arc.
                </p>
              )}

              <ol className="mt-4 space-y-2 text-sm text-stone-600">
                <li className="flex gap-2">
                  <span className="font-medium text-stone-400">1.</span>
                  Unzip the file somewhere permanent. Don't delete the folder afterwards — Chrome reads it from disk.
                </li>
                <li className="flex gap-2">
                  <span className="font-medium text-stone-400">2.</span>
                  Open <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">chrome://extensions</code>
                  <button
                    onClick={() => navigator.clipboard.writeText('chrome://extensions')}
                    className="ml-1 text-stone-400 hover:text-stone-600"
                    title="Copy"
                  >
                    <Copy size={11} />
                  </button>
                  <span className="ml-1 text-xs text-stone-400">(copy this — Chrome blocks links to it)</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-medium text-stone-400">3.</span>
                  Turn on <strong className="font-medium text-stone-700">Developer mode</strong> in the top right.
                </li>
                <li className="flex gap-2">
                  <span className="font-medium text-stone-400">4.</span>
                  Click <strong className="font-medium text-stone-700">Load unpacked</strong> and select the unzipped folder.
                </li>
              </ol>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-stone-700">
                <Chrome size={16} className="text-stone-500" />
                Extension installed
                {extVersion && (
                  <span className="text-xs text-stone-400" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    v{extVersion}
                  </span>
                )}
                {manifest && extVersion && manifest.version !== extVersion && (
                  <a href={`/${manifest.file}`} download className="ml-2 text-xs text-accent-700 hover:text-accent-800">
                    Update to v{manifest.version}
                  </a>
                )}
              </div>
              <button
                onClick={() => setInstallCollapsed(false)}
                className="text-xs text-stone-400 hover:text-stone-600"
              >
                Show install steps
              </button>
            </div>
          )}
        </section>
      )}

      {/* === Recording toggle === */}
      <section className="card mb-6 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
              <Power size={16} className={recording ? 'text-emerald-600' : 'text-stone-400'} />
              Record browsing time
            </h2>
            <p className="mt-1 text-xs text-stone-500">
              {bridgeState === 'paired'
                ? paused
                  ? 'Recording is off. Your browsing is not being tracked.'
                  : 'Recording is on. Work sites are being tracked.'
                : 'Connect a browser to start recording.'}
            </p>
          </div>
          <button
            onClick={handleToggleRecording}
            disabled={toggleDisabled}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 ${
              recording ? 'border-emerald-600 bg-emerald-600' : 'border-stone-300 bg-stone-200'
            }`}
            role="switch"
            aria-checked={recording}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                recording ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {bridgeState === 'paired' && (
          <div className="mt-4 border-t border-stone-100 pt-4">
            <label className="label">Scope</label>
            <div className="flex gap-2">
              <button
                onClick={() => handleScopeChange('allowlist')}
                className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                  scopeMode === 'allowlist'
                    ? 'border-accent-500 bg-accent-50 text-accent-800'
                    : 'border-stone-300 text-stone-600 hover:bg-stone-50'
                }`}
              >
                Only my work sites
              </button>
              <button
                onClick={() => handleScopeChange('all')}
                className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                  scopeMode === 'all'
                    ? 'border-accent-500 bg-accent-50 text-accent-800'
                    : 'border-stone-300 text-stone-600 hover:bg-stone-50'
                }`}
              >
                Every site except my excluded list
              </button>
            </div>
            <p className="mt-2 text-xs text-stone-400">
              "Only my work sites" is the stricter option and the right default for a firm.
              Manage the site list in the extension's own settings.
            </p>
            <button
              onClick={() => openExtensionSettings()}
              className="mt-2 inline-flex items-center gap-1 text-xs text-accent-700 hover:text-accent-800"
            >
              <ExternalLink size={11} /> Open extension settings
            </button>
          </div>
        )}
      </section>

      {/* === Pairing === */}
      {bridgeState === 'installed_unpaired' && (
        <section className="card mb-6 p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Connect this browser
          </h2>
          <p className="mb-4 text-sm text-stone-600">
            The extension is installed but not paired. Connect it to start sending browsing signals.
          </p>
          <button onClick={handleConnect} disabled={pairing} className="btn-primary">
            {pairing ? 'Connecting...' : 'Connect this browser'}
          </button>

          {pairError && (
            <p className="mt-3 text-sm text-red-600">{pairError}</p>
          )}

          {hostPermissionUrl && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-900">Grant access to send data</p>
              <p className="mt-1 text-sm text-amber-700">
                Chrome needs you to approve the connection. The extension has saved your details —
                open its settings page and press Save once so Chrome shows the permission prompt.
              </p>
              <button
                onClick={() => openExtensionSettings()}
                className="mt-3 btn-secondary text-sm"
              >
                <ExternalLink size={14} /> Open extension settings
              </button>
            </div>
          )}

          {/* Manual fallback */}
          <div className="mt-5">
            <button
              onClick={() => setShowManual(!showManual)}
              className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600"
            >
              {showManual ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Connect manually instead
            </button>
            {showManual && (
              <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-4">
                <p className="text-sm text-stone-600">
                  For Edge installs with a different ID or enterprise-deployed variants where the direct channel doesn't match.
                </p>
                <button onClick={handleManualPair} disabled={pairing} className="mt-3 btn-secondary text-sm">
                  Generate pairing credentials
                </button>
                {manualToken && manualEndpoint && (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs text-stone-500">
                      Copy both values into the extension's settings page. The token is shown once.
                    </p>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-stone-600">Endpoint</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 truncate rounded border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700">
                          {manualEndpoint}
                        </code>
                        <button onClick={copyEndpoint} className="btn-ghost px-2 py-1.5" title="Copy endpoint">
                          {copiedEndpoint ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-stone-600">Token</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 truncate rounded border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700">
                          {manualToken}
                        </code>
                        <button onClick={copyToken} className="btn-ghost px-2 py-1.5" title="Copy token">
                          {copiedToken ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => openExtensionSettings()}
                      className="inline-flex items-center gap-1 text-xs text-accent-700 hover:text-accent-800"
                    >
                      <ExternalLink size={11} /> Open extension settings
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* === Paired status === */}
      {bridgeState === 'paired' && status && (
        <section className="card mb-6 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Status
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
            <div>
              <span className="text-xs text-stone-400">State</span>
              <div className="mt-0.5 font-medium text-stone-800">
                {status.recording ? 'Recording' : 'Paused'}
              </div>
            </div>
            <div>
              <span className="text-xs text-stone-400">Today</span>
              <div className="mt-0.5 font-medium text-stone-800" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {(status.today_ms / 3_600_000).toFixed(1)} h
              </div>
            </div>
            <div>
              <span className="text-xs text-stone-400">Last send</span>
              <div className="mt-0.5 font-medium text-stone-800">
                {status.last_flush
                  ? status.last_flush.ok
                    ? `${status.last_flush.sent ?? 0} rollups, ${new Date(status.last_flush.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
                    : `Failed: ${status.last_flush.reason ?? 'unknown'}`
                  : 'Never'}
              </div>
            </div>
            <div>
              <span className="text-xs text-stone-400">Scope</span>
              <div className="mt-0.5 font-medium text-stone-800">
                {status.mode === 'allowlist' ? 'Work sites only' : 'All sites'}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* === Devices === */}
      {devices.length > 0 && (
        <section className="card mb-6 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            <Monitor size={14} /> Paired browsers
          </h2>
          <div className="space-y-2">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-md border border-stone-200 px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium text-stone-800">{d.label ?? 'Unnamed device'}</div>
                  <div className="text-xs text-stone-400">
                    Added {new Date(d.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {d.last_seen_at && ` · Last seen ${relativeTime(d.last_seen_at)}`}
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(d)}
                  className="btn-ghost text-xs text-stone-400 hover:text-red-700"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* === Delete recorded browsing === */}
      <section className="card mb-6 p-5">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
          <Trash2 size={14} /> Delete recorded browsing
        </h2>
        <p className="mb-4 text-sm text-stone-600">
          Remove your browsing signals from Daykeeper. This does not affect your timesheets.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setDeleteChoice('today'); setDeleteConfirm(false); }}
            className={`btn-secondary text-sm ${deleteChoice === 'today' ? 'border-accent-500 bg-accent-50 text-accent-800' : ''}`}
          >
            Today only
          </button>
          <button
            onClick={() => { setDeleteChoice('all'); setDeleteConfirm(false); }}
            className={`btn-secondary text-sm ${deleteChoice === 'all' ? 'border-accent-500 bg-accent-50 text-accent-800' : ''}`}
          >
            Everything
          </button>
          {deleteChoice && (
            <button
              onClick={handleDelete}
              className="btn-danger text-sm"
            >
              {deleteConfirm ? 'Confirm delete' : 'Delete'}
            </button>
          )}
        </div>
        {deleteConfirm && (
          <p className="mt-2 text-xs text-red-600">
            This permanently removes the selected browsing signals. Are you sure?
          </p>
        )}
      </section>

      {/* === Privacy summary === */}
      <section className="card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
          <Lock size={14} /> What we record
        </h2>
        <ul className="space-y-1.5 text-sm text-stone-600">
          <li>Domains and time spent — nothing else.</li>
          <li>No page content, no form values, no keystrokes, no query strings.</li>
          <li>Incognito tabs are never recorded.</li>
          <li>Daykeeper's own pages are not recorded.</li>
          <li>Your firm sees the approved timesheet, never the raw browsing.</li>
        </ul>
      </section>

      {/* === Mock controls (preview only) === */}
      {import.meta.env.VITE_MOCK_EXTENSION === 'true' && (
        <MockControls current={bridgeState} onRefresh={refreshBridge} />
      )}
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}

/** Preview-only controls to cycle through bridge states without a real extension. */
function MockControls({ current, onRefresh }: { current: BridgeState; onRefresh: () => Promise<void> }) {
  return (
    <section className="card mt-6 border-dashed border-stone-300 bg-stone-50 p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">
        Preview mock — cycle bridge states
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { setMockState({ installed: false, paired: false }); onRefresh(); }}
          className={`btn-secondary text-xs ${current === 'not_installed' ? 'border-accent-500 bg-accent-50' : ''}`}
        >
          Not installed
        </button>
        <button
          onClick={() => { setMockState({ installed: true, paired: false }); onRefresh(); }}
          className={`btn-secondary text-xs ${current === 'installed_unpaired' ? 'border-accent-500 bg-accent-50' : ''}`}
        >
          Installed, unpaired
        </button>
        <button
          onClick={() => { setMockState({ installed: true, paired: true, paused: false, todayMs: 5_400_000 }); onRefresh(); }}
          className={`btn-secondary text-xs ${current === 'paired' ? 'border-accent-500 bg-accent-50' : ''}`}
        >
          Paired, recording
        </button>
        <button
          onClick={() => { setMockState({ installed: true, paired: true, paused: true, todayMs: 3_600_000 }); onRefresh(); }}
          className="btn-secondary text-xs"
        >
          Paused
        </button>
        <button
          onClick={() => { setMockState({ installed: true, paired: true, lastFlush: { ok: false, reason: 'Network error', at: Date.now() } }); onRefresh(); }}
          className="btn-secondary text-xs"
        >
          Flush failed
        </button>
      </div>
    </section>
  );
}
