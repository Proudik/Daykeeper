import type { BridgeState, ExtensionStatus, PairResult } from '@/types/signals';

const EXTENSION_ID = import.meta.env.VITE_EXTENSION_ID ?? 'gilcihmibjhijcdfmeacdjdkebmfknkg';
const USE_MOCK = import.meta.env.VITE_MOCK_EXTENSION === 'true';

// --- Mock state (preview mode) ------------------------------------------------

let mockState: {
  installed: boolean;
  paired: boolean;
  paused: boolean;
  mode: 'all' | 'allowlist';
  version: string;
  deviceId: string;
  todayMs: number;
  lastFlush: { ok: boolean; sent?: number; reason?: string; at: number } | null;
} = {
  installed: true,
  paired: false,
  paused: false,
  mode: 'allowlist',
  version: '0.1.0',
  deviceId: '',
  todayMs: 0,
  lastFlush: null,
};

/** Exposed so the settings page can cycle through states for testing. */
export function setMockState(patch: Partial<typeof mockState>): void {
  mockState = { ...mockState, ...patch };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mockSend<T>(message: Record<string, unknown>): T | null {
  switch (message.type) {
    case 'ping': {
      const state: BridgeState = !mockState.installed
        ? 'not_installed'
        : mockState.paired
          ? 'paired'
          : 'installed_unpaired';
      return {
        ok: true,
        installed: true,
        version: mockState.version,
        paired: mockState.paired,
        device_id: mockState.deviceId,
        state,
      } as T;
    }
    case 'status':
      return {
        ok: true,
        version: mockState.version,
        paired: mockState.paired,
        paused: mockState.paused,
        recording: mockState.paired && !mockState.paused,
        device_id: mockState.deviceId,
        today_ms: mockState.todayMs,
        last_flush: mockState.lastFlush,
        mode: mockState.mode,
      } as T;
    case 'pair': {
      mockState.paired = true;
      mockState.deviceId = crypto.randomUUID();
      mockState.todayMs = 0;
      mockState.lastFlush = { ok: true, sent: 0, at: Date.now() };
      return {
        ok: true,
        device_id: mockState.deviceId,
        first_send: { ok: true, sent: 0 },
      } as T;
    }
    case 'set_paused':
      mockState.paused = message.paused as boolean;
      return { ok: true, paused: mockState.paused } as T;
    case 'set_mode':
      mockState.mode = message.mode as 'all' | 'allowlist';
      return { ok: true, mode: mockState.mode } as T;
    case 'unpair':
      mockState.paired = false;
      mockState.deviceId = '';
      mockState.todayMs = 0;
      mockState.lastFlush = null;
      return { ok: true } as T;
    case 'open_settings':
      return { ok: true } as T;
    default:
      return null;
  }
}

// --- Real Chrome messaging ----------------------------------------------------

function isChromeRuntimeAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.chrome !== 'undefined' &&
    typeof window.chrome.runtime !== 'undefined' &&
    typeof window.chrome.runtime.sendMessage === 'function'
  );
}

function chromeSend<T>(message: Record<string, unknown>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    if (!isChromeRuntimeAvailable()) {
      resolve(null);
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve(null);
    }, timeoutMs);

    try {
      window.chrome.runtime.sendMessage(EXTENSION_ID, message, (response: T | undefined) => {
        if (settled) return;
        clearTimeout(timer);
        // lastError is set when the extension is missing or the channel fails.
        // In that case the callback receives undefined.
        if (window.chrome.runtime.lastError || response === undefined) {
          resolve(null);
          return;
        }
        resolve(response);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

// --- Public API ---------------------------------------------------------------

async function sendToExtension<T>(
  message: Record<string, unknown>,
  timeoutMs = 2000,
): Promise<T | null> {
  if (USE_MOCK) {
    await delay(300);
    return mockSend<T>(message);
  }
  return chromeSend<T>(message, timeoutMs);
}

export async function detectExtension(): Promise<{
  state: BridgeState;
  version?: string;
  deviceId?: string;
}> {
  const resp = await sendToExtension<{
    ok: boolean;
    installed: boolean;
    version: string;
    paired: boolean;
    device_id: string;
  }>({ type: 'ping' });

  if (!resp || !resp.ok) {
    // If chrome.runtime doesn't exist at all, the browser is unsupported.
    // If it exists but the ping failed, the extension is not installed.
    if (!isChromeRuntimeAvailable() && !USE_MOCK) {
      return { state: 'unsupported' };
    }
    return { state: 'not_installed' };
  }

  const state: BridgeState = resp.paired ? 'paired' : 'installed_unpaired';
  return { state, version: resp.version, deviceId: resp.device_id };
}

export async function pairExtension(endpoint: string, token: string): Promise<PairResult> {
  return (
    sendToExtension<PairResult>({ type: 'pair', endpoint, token }) ??
    ({ ok: false, error: 'host_permission_required', options_url: '' } as PairResult)
  );
}

export async function unpairExtension(): Promise<boolean> {
  const resp = await sendToExtension<{ ok: boolean }>({ type: 'unpair' });
  return resp?.ok ?? false;
}

export async function getExtensionStatus(): Promise<ExtensionStatus | null> {
  return sendToExtension<ExtensionStatus>({ type: 'status' });
}

export async function setRecording(enabled: boolean): Promise<boolean> {
  const resp = await sendToExtension<{ ok: boolean; paused: boolean }>({
    type: 'set_paused',
    paused: !enabled,
  });
  return resp?.ok ?? false;
}

export async function setScope(mode: 'all' | 'allowlist'): Promise<boolean> {
  const resp = await sendToExtension<{ ok: boolean; mode: 'all' | 'allowlist' }>({
    type: 'set_mode',
    mode,
  });
  return resp?.ok ?? false;
}

export async function openExtensionSettings(): Promise<void> {
  await sendToExtension<{ ok: boolean }>({ type: 'open_settings' });
}

export function isExtensionSupported(): boolean {
  if (USE_MOCK) return true;
  return isChromeRuntimeAvailable();
}

/**
 * Derives a human-readable device label from the user agent, e.g.
 * "Chrome on Windows", "Edge on macOS".
 */
export function deriveDeviceLabel(): string {
  const ua = navigator.userAgent;
  let browser = 'Chrome';
  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('OPR/') || ua.includes('Opera')) browser = 'Opera';
  else if (ua.includes('Brave')) browser = 'Brave';
  else if (ua.includes('Firefox')) browser = 'Firefox';

  let os = 'Unknown';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';

  return `${browser} on ${os}`;
}
