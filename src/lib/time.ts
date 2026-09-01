import type { RoundingMinutes } from '@/types';

// Format minutes as "X h Y min" (e.g. 95 -> "1 h 35 min").
export function formatMinutes(min: number): string {
  if (min <= 0) return '0 min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

// Format minutes as decimal hours (e.g. 95 -> "1.6 h").
export function formatHours(min: number): string {
  return `${(min / 60).toFixed(1)} h`;
}

// Round minutes to the configured increment. 0 = exact (no rounding).
export function roundMinutes(min: number, increment: RoundingMinutes): number {
  if (increment === 0) return min;
  return Math.ceil(min / increment) * increment;
}

// Extract { hours, minutes } from a timestamp in the given IANA timezone.
function toTzParts(iso: string, timezone: string): { h: number; m: number } {
  const d = new Date(iso);
  // Intl.DateTimeFormat gives us the wall-clock time in the target tz.
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  // hour12:false can return 24 for midnight
  return { h: h === 24 ? 0 : h, m };
}

// Format a timestamp as HH:mm in the given IANA timezone (defaults to browser local).
export function formatTime(iso: string, timezone?: string): string {
  if (!iso) return '';
  // If no timezone hint and no UTC marker, treat as a bare local string (YYYY-MM-DDTHH:mm)
  if (!timezone && !iso.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(iso)) {
    return iso.slice(11, 16) || '';
  }
  const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const src = iso.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  const { h, m } = toTzParts(src, tz);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Format a time range "HH:mm – HH:mm" from two timestamp strings.
export function formatTimeRange(startIso: string, endIso?: string, timezone?: string): string {
  if (!endIso) return formatTime(startIso, timezone);
  return `${formatTime(startIso, timezone)}–${formatTime(endIso, timezone)}`;
}

// Parse "HH:mm" into minutes since midnight.
export function parseHHmm(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Convert a timestamp to minutes-since-midnight in the given IANA timezone.
export function timestampToMinutes(iso: string, timezone?: string): number {
  if (!iso) return 0;
  if (!timezone && !iso.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(iso)) {
    return parseHHmm(iso.slice(11, 16));
  }
  const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const src = iso.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  const { h, m } = toTzParts(src, tz);
  return h * 60 + m;
}

// Minutes between two timestamp strings in the given timezone.
export function minutesBetween(startIso: string, endIso: string, timezone?: string): number {
  return Math.max(0, timestampToMinutes(endIso, timezone) - timestampToMinutes(startIso, timezone));
}

// Format a date as a locale-aware long date string.
export function formatLongDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// Get today's date as YYYY-MM-DD in local time.
export function todayLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

// Add or subtract days from a YYYY-MM-DD date string.
export function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}
