import { supabase } from '@/lib/supabase';

type LogLevel = 'info' | 'warning' | 'error';

interface LogEntry {
  action: string;
  detail?: string;
  level?: LogLevel;
  provider?: string;
}

function getOrgId(): string | null {
  // Read org_id from localStorage where the AuthContext profile is cached
  try {
    const raw = localStorage.getItem('dk_profile');
    if (raw) {
      const p = JSON.parse(raw);
      return p.org_id ?? null;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Writes a log entry to the audit_log table. Safe to call from anywhere —
 * silently swallows errors so it never crashes the app further.
 */
export async function logEvent({ action, detail, level = 'info', provider }: LogEntry): Promise<void> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    await supabase.from('audit_log').insert({
      user_id: userData.user.id,
      action,
      detail: detail ?? null,
      level,
      provider: provider ?? null,
      org_id: getOrgId(),
    });
  } catch {
    // Never let logging crash the app
  }
}

/**
 * Logs an unhandled error or crash. Used by the global error handler and
 * the Error Boundary.
 */
export async function logCrash(message: string, stack?: string): Promise<void> {
  const detail = stack ? `${message}\n\n${stack.slice(0, 2000)}` : message.slice(0, 2000);
  await logEvent({ action: 'crash', detail, level: 'error' });
}

/**
 * Installs global window-level error listeners that capture uncaught
 * exceptions and unhandled promise rejections, logging them to audit_log.
 * Call once at app startup.
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event: ErrorEvent) => {
    logCrash(event.message, event.error?.stack);
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    logCrash(`Unhandled promise rejection: ${message}`, stack);
  });
}
