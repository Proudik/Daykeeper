import { useEffect, useState, useRef, useCallback } from 'react';
import { Radio, Pause, WifiOff, AlertTriangle, RotateCw } from 'lucide-react';
import { getExtensionStatus, setRecording } from '@/lib/extensionBridge';
import type { ExtensionStatus } from '@/types/signals';
import { formatHours } from '@/lib/time';

function formatRelativeTime(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}

function formatTodayMs(ms: number): string {
  const min = ms / 60_000;
  if (min < 1) return '0.0 h';
  return formatHours(min);
}

export function ExtensionStatusCard() {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [toggling, setToggling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (document.hidden) return;
    const s = await getExtensionStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    poll();
    timerRef.current = setInterval(poll, 15_000);
    const onVisibility = () => {
      if (!document.hidden) poll();
      else if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (!document.hidden && !timerRef.current) {
        timerRef.current = setInterval(poll, 15_000);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [poll]);

  async function handleToggle() {
    if (!status) return;
    setToggling(true);
    await setRecording(status.paused);
    const s = await getExtensionStatus();
    setStatus(s);
    setToggling(false);
  }

  async function handleRetry() {
    // Trigger a re-read — the extension will attempt a flush on the next cycle
    const s = await getExtensionStatus();
    setStatus(s);
  }

  if (!status || !status.paired) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
        <WifiOff size={14} className="text-stone-400" />
        Not connected
      </div>
    );
  }

  const recording = status.recording;
  const lastFlush = status.last_flush;
  const flushFailed = lastFlush && !lastFlush.ok;

  return (
    <div className="flex items-center gap-3 rounded-md border border-stone-200 bg-white px-3 py-2">
      {/* Recording indicator */}
      <div className="flex items-center gap-1.5">
        {recording ? (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <Radio size={12} />
            Recording
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-medium text-stone-500">
            <Pause size={12} />
            Paused
          </span>
        )}
      </div>

      <span className="h-3 w-px bg-stone-200" />

      {/* Hours today */}
      <span className="text-xs text-stone-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatTodayMs(status.today_ms)} today
      </span>

      {/* Last flush */}
      {lastFlush && (
        <>
          <span className="h-3 w-px bg-stone-200" />
          <span
            className={`text-xs ${flushFailed ? 'text-amber-600' : 'text-stone-400'}`}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {flushFailed ? (
              <span className="flex items-center gap-1">
                <AlertTriangle size={11} />
                {lastFlush.reason ?? 'Send failed'}
                <button
                  onClick={handleRetry}
                  className="ml-1 inline-flex items-center gap-0.5 text-amber-700 hover:text-amber-800"
                >
                  <RotateCw size={11} /> Retry
                </button>
              </span>
            ) : (
              `sent ${formatRelativeTime(lastFlush.at)}`
            )}
          </span>
        </>
      )}
    </div>
  );
}
