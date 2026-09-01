import { describe, it, expect } from 'vitest';
import { cluster } from '@/lib/estimator/cluster';
import { normalize } from '@/lib/estimator/normalize';
import type { ActivityItem } from '@/types';

// Build an email activity item for testing.
function emailItem(
  id: string,
  hour: number,
  minute: number,
  opts: {
    direction: 'incoming' | 'outgoing';
    threadId: string;
    subject: string;
    sender?: string;
    wordCount?: number;
  },
): ActivityItem {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return {
    id,
    provider: 'email',
    timestamp: `2025-03-18T${h}:${m}:00`,
    summary: opts.subject,
    meta: {
      sender: opts.sender ?? 'someone@example.com',
      recipient: 'jan.novak@novaklaw.cz',
      subject: opts.subject,
      threadId: opts.threadId,
      direction: opts.direction,
      wordCount: opts.wordCount ?? 50,
    },
  };
}

describe('email banding and clustering', () => {
  it('applies 1× multiplier for sent messages under 50 words', () => {
    const items = [
      emailItem('e1', 9, 0, {
        direction: 'outgoing',
        threadId: 't1',
        subject: 'Short reply',
        wordCount: 30,
      }),
    ];
    const normalized = normalize(items);
    const sessions = cluster(normalized);

    expect(sessions).toHaveLength(1);
    // 6 min baseline × 1× band = 6 min
    expect(sessions[0].estimatedMinutes).toBe(6);
  });

  it('applies 1.5× multiplier for sent messages with 50–200 words', () => {
    const items = [
      emailItem('e1', 9, 0, {
        direction: 'outgoing',
        threadId: 't1',
        subject: 'Medium reply',
        wordCount: 120,
      }),
    ];
    const sessions = cluster(normalize(items));

    // 6 min × 1.5 = 9 min
    expect(sessions[0].estimatedMinutes).toBe(9);
  });

  it('applies 2.5× multiplier for sent messages over 200 words', () => {
    const items = [
      emailItem('e1', 9, 0, {
        direction: 'outgoing',
        threadId: 't1',
        subject: 'Long reply',
        wordCount: 350,
      }),
    ];
    const sessions = cluster(normalize(items));

    // 6 min × 2.5 = 15 min
    expect(sessions[0].estimatedMinutes).toBe(15);
  });

  it('gives 2 minutes for received messages that are part of a thread (replied)', () => {
    const items = [
      emailItem('e1', 9, 0, {
        direction: 'incoming',
        threadId: 't1',
        subject: 'Incoming',
        wordCount: 100,
      }),
    ];
    const sessions = cluster(normalize(items));

    // received + has threadId = 2 min
    expect(sessions[0].estimatedMinutes).toBe(2);
  });

  it('gives 1 minute for received messages with no thread (merely received)', () => {
    const items = [
      {
        ...emailItem('e1', 9, 0, {
          direction: 'incoming',
          threadId: 't1',
          subject: 'Incoming',
          wordCount: 100,
        }),
        meta: {
          sender: 'someone@example.com',
          recipient: 'jan.novak@novaklaw.cz',
          subject: 'Incoming',
          direction: 'incoming' as const,
          wordCount: 100,
          // No threadId — merely received
        },
      } as ActivityItem,
    ];
    const sessions = cluster(normalize(items));

    // received, no thread = 1 min
    expect(sessions[0].estimatedMinutes).toBe(1);
  });

  it('groups messages by thread and sums effort across the thread', () => {
    const items = [
      emailItem('e1', 8, 12, { direction: 'incoming', threadId: 'svoboda', subject: 'Re: Svoboda', wordCount: 320 }),
      emailItem('e2', 8, 35, { direction: 'outgoing', threadId: 'svoboda', subject: 'Re: Svoboda', wordCount: 410 }),
      emailItem('e3', 9, 22, { direction: 'incoming', threadId: 'svoboda', subject: 'Re: Svoboda', wordCount: 190 }),
    ];
    const sessions = cluster(normalize(items));

    expect(sessions).toHaveLength(1);
    expect(sessions[0].groupKey).toBe('svoboda');

    // e1: incoming with thread = 2 min
    // e2: outgoing, 410 words = 6 × 2.5 = 15 min
    // e3: incoming with thread = 2 min
    // total = 2 + 15 + 2 = 19 min
    expect(sessions[0].estimatedMinutes).toBe(19);

    // Session spans from 08:12 to 09:22 (+1 min for point-in-time last message)
    expect(sessions[0].start).toBe(8 * 60 + 12);
    expect(sessions[0].end).toBe(9 * 60 + 22 + 1);
  });

  it('caps a single thread at 90 minutes', () => {
    // Create a thread with many long sent messages to exceed 90 min
    const items: ActivityItem[] = [];
    for (let i = 0; i < 10; i++) {
      items.push(
        emailItem(`e${i}`, 8 + Math.floor(i / 2), (i % 2) * 30, {
          direction: 'outgoing',
          threadId: 'big-thread',
          subject: 'Big thread',
          wordCount: 300, // 6 × 2.5 = 15 min each
        }),
      );
    }
    const sessions = cluster(normalize(items));

    // 10 × 15 = 150, capped at 90
    expect(sessions[0].estimatedMinutes).toBe(90);
  });

  it('handles the messy mock case: Koncern Procházka thread spanning a meeting', () => {
    // Mock data: email thread "Koncern Procházka" with:
    //   09:50 incoming 520 words (received-replied = 2 min)
    //   10:05 outgoing 380 words (6 × 1.5 = 9 min)
    //   10:30 incoming 240 words (received-replied = 2 min)
    const items = [
      emailItem('email-6', 9, 50, {
        direction: 'incoming',
        threadId: 'thread-koncern-fuze',
        subject: 'Re: Koncern Procházka a.s. — připomínky ke fúzi',
        sender: 'martin.prochazka@prochazka-group.cz',
        wordCount: 520,
      }),
      emailItem('email-7', 10, 5, {
        direction: 'outgoing',
        threadId: 'thread-koncern-fuze',
        subject: 'Re: Koncern Procházka a.s. — připomínky ke fúzi',
        wordCount: 380,
      }),
      emailItem('email-8', 10, 30, {
        direction: 'incoming',
        threadId: 'thread-koncern-fuze',
        subject: 'Re: Koncern Procházka a.s. — připomínky ke fúzi',
        sender: 'martin.prochazka@prochazka-group.cz',
        wordCount: 240,
      }),
    ];
    const sessions = cluster(normalize(items));

    expect(sessions).toHaveLength(1);
    expect(sessions[0].groupKey).toBe('thread-koncern-fuze');

    // incoming 520w = 2 min (received-replied)
    // outgoing 380w = 6 × 1.5 = 9 min (50–200 band... wait 380 > 200, so 2.5×)
    // incoming 240w = 2 min
    // total = 2 + (6 × 2.5 = 15) + 2 = 19 min
    expect(sessions[0].estimatedMinutes).toBe(19);

    // Session spans 09:50 to 10:30 (+1 min for point-in-time last message)
    expect(sessions[0].start).toBe(590);
    expect(sessions[0].end).toBe(630 + 1);
  });

  it('separates different threads into different sessions', () => {
    const items = [
      emailItem('e1', 8, 12, { direction: 'incoming', threadId: 'thread-a', subject: 'Thread A', wordCount: 100 }),
      emailItem('e2', 8, 35, { direction: 'outgoing', threadId: 'thread-a', subject: 'Thread A', wordCount: 80 }),
      emailItem('e3', 9, 5, { direction: 'incoming', threadId: 'thread-b', subject: 'Thread B', wordCount: 200 }),
      emailItem('e4', 9, 22, { direction: 'incoming', threadId: 'thread-b', subject: 'Thread B', wordCount: 190 }),
    ];
    const sessions = cluster(normalize(items));

    expect(sessions).toHaveLength(2);
    const threadA = sessions.find((s) => s.groupKey === 'thread-a');
    const threadB = sessions.find((s) => s.groupKey === 'thread-b');

    // Thread A: 2 (received) + 9 (sent, 80 words = 50-200 band = 6×1.5) = 11 min
    expect(threadA!.estimatedMinutes).toBe(11);
    // Thread B: 2 + 2 = 4 min (both received-replied)
    expect(threadB!.estimatedMinutes).toBe(4);
  });
});
