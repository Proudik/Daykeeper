import { describe, it, expect } from 'vitest';
import { resolveOverlaps } from '@/lib/estimator/overlap';
import type { WorkSession } from '@/lib/estimator/types';

function makeSession(
  provider: WorkSession['provider'],
  start: number,
  end: number,
  opts: Partial<WorkSession> = {},
): WorkSession {
  return {
    id: opts.id ?? `${provider}-${start}`,
    provider,
    kind: opts.kind ?? `${provider}.session`,
    start,
    end,
    estimatedMinutes: opts.estimatedMinutes ?? end - start,
    label: opts.label ?? `${provider} session`,
    groupKey: opts.groupKey ?? `${provider}-${start}`,
    sourceItemIds: opts.sourceItemIds ?? [],
    confidence: opts.confidence ?? 'medium',
    absorbed: [],
    trimmed: false,
  };
}

describe('overlap resolver', () => {
  it('returns non-overlapping sessions unchanged', () => {
    const sessions = [
      makeSession('calendar', 540, 600), // 9:00–10:00
      makeSession('email', 660, 720),   // 11:00–12:00
    ];
    const result = resolveOverlaps(sessions);
    expect(result).toHaveLength(2);
    expect(result[0].trimmed).toBe(false);
    expect(result[1].trimmed).toBe(false);
  });

  it('trims the lower-priority session to the non-overlapping remainder', () => {
    // Calendar 10:00–11:00 (priority 4), Email 10:30–11:30 (priority 1)
    // Email should be trimmed to 11:00–11:30
    const sessions = [
      makeSession('calendar', 600, 660), // 10:00–11:00
      makeSession('email', 630, 690),    // 10:30–11:30
    ];
    const result = resolveOverlaps(sessions);
    const email = result.find((s) => s.provider === 'email');
    const cal = result.find((s) => s.provider === 'calendar');

    expect(cal).toBeDefined();
    expect(cal!.start).toBe(600);
    expect(cal!.end).toBe(660);
    expect(cal!.trimmed).toBe(false);

    expect(email).toBeDefined();
    expect(email!.start).toBe(660); // trimmed to start at 11:00
    expect(email!.end).toBe(690);   // ends at 11:30
    expect(email!.trimmed).toBe(true);
    expect(email!.originalStart).toBe(630);
    expect(email!.originalEnd).toBe(690);
  });

  it('absorbs a fully-consumed session into the winner as context', () => {
    // Calendar 10:00–11:00, Email 10:15–10:45 (fully inside calendar)
    const sessions = [
      makeSession('calendar', 600, 660),
      makeSession('email', 615, 645, { estimatedMinutes: 30, label: 'Email thread' }),
    ];
    const result = resolveOverlaps(sessions);

    const cal = result.find((s) => s.provider === 'calendar');
    const email = result.find((s) => s.provider === 'email');

    expect(cal).toBeDefined();
    expect(email).toBeUndefined(); // fully absorbed, not in result

    expect(cal!.absorbed).toHaveLength(1);
    expect(cal!.absorbed[0].provider).toBe('email');
    expect(cal!.absorbed[0].label).toBe('Email thread');
    expect(cal!.absorbed[0].estimatedMinutes).toBe(30);
  });

  it('applies priority: calendar > documents > chat > email', () => {
    // All four overlap at 10:00–10:30
    const sessions = [
      makeSession('email', 600, 630, { estimatedMinutes: 30 }),
      makeSession('chat', 600, 630, { estimatedMinutes: 30 }),
      makeSession('documents', 600, 630, { estimatedMinutes: 30 }),
      makeSession('calendar', 600, 630, { estimatedMinutes: 30 }),
    ];
    const result = resolveOverlaps(sessions);

    // Calendar wins the 10:00–10:30 slot
    const cal = result.find((s) => s.provider === 'calendar');
    expect(cal).toBeDefined();
    expect(cal!.start).toBe(600);
    expect(cal!.end).toBe(630);
    expect(cal!.absorbed.length).toBe(3); // absorbs documents, chat, email

    // Documents, chat, email are all absorbed
    expect(result.find((s) => s.provider === 'documents')).toBeUndefined();
    expect(result.find((s) => s.provider === 'chat')).toBeUndefined();
    expect(result.find((s) => s.provider === 'email')).toBeUndefined();
  });

  it('handles the messy mock case: overlapping calendar events', () => {
    // Mock data has: cal-2 10:00–11:00 and cal-3 10:30–11:00
    // Same priority — the first one processed wins (earlier start)
    const sessions = [
      makeSession('calendar', 600, 660, { id: 'cal-2', label: 'Klient Procházka' }),
      makeSession('calendar', 630, 660, { id: 'cal-3', label: 'Interní schůzka' }),
    ];
    const result = resolveOverlaps(sessions);

    // cal-2 (earlier start) keeps 10:00–11:00
    const cal2 = result.find((s) => s.id === 'cal-2');
    expect(cal2).toBeDefined();
    expect(cal2!.start).toBe(600);
    expect(cal2!.end).toBe(660);

    // cal-3 is fully absorbed (10:30–11:00 is inside 10:00–11:00)
    const cal3 = result.find((s) => s.id === 'cal-3');
    expect(cal3).toBeUndefined();
    expect(cal2!.absorbed).toHaveLength(1);
    expect(cal2!.absorbed[0].label).toBe('Interní schůzka');
  });

  it('handles the messy mock case: email thread spanning a meeting', () => {
    // Mock data has email thread "Koncern Procházka" with messages at
    // 09:50, 10:05, 10:30 — and a calendar event 10:00–11:00.
    // The email thread session spans 09:50–10:30 (first to last message).
    // Calendar 10:00–11:00 should trim the email to 09:50–10:00.
    const sessions = [
      makeSession('email', 590, 630, { id: 'email-koncern', estimatedMinutes: 20, label: 'Koncern Procházka' }),
      makeSession('calendar', 600, 660, { id: 'cal-2', label: 'Klient Procházka' }),
    ];
    const result = resolveOverlaps(sessions);

    const cal = result.find((s) => s.provider === 'calendar');
    const email = result.find((s) => s.provider === 'email');

    expect(cal).toBeDefined();
    expect(cal!.start).toBe(600);
    expect(cal!.end).toBe(660);

    expect(email).toBeDefined();
    expect(email!.start).toBe(590); // 09:50
    expect(email!.end).toBe(600);   // trimmed to 10:00
    expect(email!.trimmed).toBe(true);
    expect(email!.confidence).toBe('low'); // downgraded from low stays low
  });

  it('downgrades confidence when a session is trimmed', () => {
    const sessions = [
      makeSession('calendar', 600, 660, { confidence: 'high' }),
      makeSession('documents', 630, 690, { confidence: 'medium' }),
    ];
    const result = resolveOverlaps(sessions);

    const doc = result.find((s) => s.provider === 'documents');
    expect(doc).toBeDefined();
    expect(doc!.trimmed).toBe(true);
    expect(doc!.confidence).toBe('low'); // medium downgraded to low
  });

  it('downgrades winner confidence when absorbing many sessions', () => {
    const sessions = [
      makeSession('calendar', 600, 660, { confidence: 'high' }),
      makeSession('email', 610, 620, { estimatedMinutes: 10 }),
      makeSession('chat', 620, 630, { estimatedMinutes: 10 }),
    ];
    const result = resolveOverlaps(sessions);
    const cal = result.find((s) => s.provider === 'calendar');
    expect(cal!.confidence).toBe('medium'); // high downgraded due to absorbing
    expect(cal!.absorbed).toHaveLength(2);
  });
});
