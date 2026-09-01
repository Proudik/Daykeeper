import type { NormalizedItem, WorkSession } from './types';
import type { Provider } from '@/types';

// Stage 2: Cluster
// Group normalized items into work sessions. Each provider has its own
// clustering logic. Returns sessions sorted by start time.

export function cluster(items: NormalizedItem[]): WorkSession[] {
  const sessions: WorkSession[] = [];

  // Partition by provider
  const byProvider = partitionByProvider(items);

  sessions.push(...clusterCalendar(byProvider.get('calendar') ?? []));
  sessions.push(...clusterEmail(byProvider.get('email') ?? []));
  sessions.push(...clusterChat(byProvider.get('chat') ?? []));
  sessions.push(...clusterDocuments(byProvider.get('documents') ?? []));
  sessions.push(...clusterSingleCase(byProvider.get('singlecase') ?? []));
  sessions.push(...clusterBrowser(byProvider.get('browser') ?? []));

  sessions.sort((a, b) => a.start - b.start);
  return sessions;
}

function partitionByProvider(items: NormalizedItem[]): Map<Provider, NormalizedItem[]> {
  const map = new Map<Provider, NormalizedItem[]>();
  for (const item of items) {
    const list = map.get(item.provider) ?? [];
    list.push(item);
    map.set(item.provider, list);
  }
  return map;
}

// --- Calendar ---------------------------------------------------------------
// Each accepted event is its own session using its actual start/end.
// Declined and tentative events are excluded. All-day events are excluded
// (all-day = span >= 24h, i.e. end - start >= 1440 minutes).

function clusterCalendar(items: NormalizedItem[]): WorkSession[] {
  const sessions: WorkSession[] = [];
  for (const item of items) {
    if (item.kind === 'calendar.declined') continue;
    const span = item.end - item.start;
    if (span >= 1440) continue; // all-day
    sessions.push({
      id: item.id,
      provider: 'calendar',
      kind: 'calendar.accepted',
      start: item.start,
      end: item.end,
      estimatedMinutes: span,
      label: item.label,
      groupKey: item.groupKey,
      sourceItemIds: [item.id],
      confidence: 'high',
      absorbed: [],
      trimmed: false,
    });
  }
  return sessions;
}

// --- Email -----------------------------------------------------------------
// Group by thread id. A thread's session spans its first to last message that
// day. Baseline effort per message:
//   - 6 min for sent, 2 min for received-and-replied, 1 min for merely received.
// Scale sent-message effort by word count bands:
//   - under 50 words: 1×, 50–200 words: 1.5×, over 200 words: 2.5×.
// Cap any single thread at 90 minutes.

function clusterEmail(items: NormalizedItem[]): WorkSession[] {
  const byThread = new Map<string, NormalizedItem[]>();
  for (const item of items) {
    const list = byThread.get(item.groupKey) ?? [];
    list.push(item);
    byThread.set(item.groupKey, list);
  }

  const sessions: WorkSession[] = [];
  for (const [threadId, msgs] of byThread) {
    msgs.sort((a, b) => a.start - b.start);
    const start = msgs[0].start;
    const end = msgs[msgs.length - 1].end;

    let effort = 0;
    for (const msg of msgs) {
      if (msg.kind === 'email.sent') {
        const wordCount = msg.meta.wordCount ?? 50;
        const band = wordCount < 50 ? 1 : wordCount <= 200 ? 1.5 : 2.5;
        effort += 6 * band;
      } else {
        effort += msg.weight; // 2 for received-replied, 1 for merely received
      }
    }

    const estimatedMinutes = Math.min(Math.round(effort), 90);

    sessions.push({
      id: `email-${threadId}`,
      provider: 'email',
      kind: 'email.thread',
      start,
      end,
      estimatedMinutes,
      label: msgs[0].label,
      groupKey: threadId,
      sourceItemIds: msgs.map((m) => m.id),
      confidence: 'low',
      absorbed: [],
      trimmed: false,
    });
  }
  return sessions;
}

// --- Chat ------------------------------------------------------------------
// Sessions split on gaps of more than 15 minutes of inactivity within the
// same channel. Duration is the session span, plus 3 minutes trailing
// context-switch cost, capped at 60 minutes per session.

function clusterChat(items: NormalizedItem[]): WorkSession[] {
  const byChannel = new Map<string, NormalizedItem[]>();
  for (const item of items) {
    const list = byChannel.get(item.groupKey) ?? [];
    list.push(item);
    byChannel.set(item.groupKey, list);
  }

  const sessions: WorkSession[] = [];
  for (const [channel, msgs] of byChannel) {
    msgs.sort((a, b) => a.start - b.start);

    let current: NormalizedItem[] = [];
    let lastEnd: number | null = null;

    for (const msg of msgs) {
      if (lastEnd !== null && msg.start - lastEnd > 15 && current.length > 0) {
        sessions.push(makeChatSession(channel, current));
        current = [];
      }
      current.push(msg);
      lastEnd = Math.max(lastEnd ?? 0, msg.end);
    }
    if (current.length > 0) {
      sessions.push(makeChatSession(channel, current));
    }
  }
  return sessions;
}

function makeChatSession(channel: string, msgs: NormalizedItem[]): WorkSession {
  const start = msgs[0].start;
  const end = msgs[msgs.length - 1].end;
  const span = end - start;
  const withContext = span + 3;
  const estimatedMinutes = Math.min(withContext, 60);
  return {
    id: `chat-${channel}-${start}`,
    provider: 'chat',
    kind: 'chat.session',
    start,
    end,
    estimatedMinutes,
    label: msgs[0].label,
    groupKey: channel,
    sourceItemIds: msgs.map((m) => m.id),
    confidence: 'medium',
    absorbed: [],
    trimmed: false,
  };
}

// --- Documents -------------------------------------------------------------
// Sessions split on revision gaps of more than 20 minutes. Duration is the
// session span.

function clusterDocuments(items: NormalizedItem[]): WorkSession[] {
  const byFile = new Map<string, NormalizedItem[]>();
  for (const item of items) {
    const list = byFile.get(item.groupKey) ?? [];
    list.push(item);
    byFile.set(item.groupKey, list);
  }

  const sessions: WorkSession[] = [];
  for (const [fileName, revs] of byFile) {
    revs.sort((a, b) => a.start - b.start);

    let current: NormalizedItem[] = [];
    let lastEnd: number | null = null;

    for (const rev of revs) {
      if (lastEnd !== null && rev.start - lastEnd > 20 && current.length > 0) {
        sessions.push(makeDocSession(fileName, current));
        current = [];
      }
      current.push(rev);
      lastEnd = Math.max(lastEnd ?? 0, rev.end);
    }
    if (current.length > 0) {
      sessions.push(makeDocSession(fileName, current));
    }
  }
  return sessions;
}

function makeDocSession(fileName: string, revs: NormalizedItem[]): WorkSession {
  const start = revs[0].start;
  const end = revs[revs.length - 1].end;
  const span = end - start;
  return {
    id: `doc-${fileName}-${start}`,
    provider: 'documents',
    kind: 'documents.session',
    start,
    end,
    estimatedMinutes: Math.max(span, 2),
    label: revs[0].label,
    groupKey: fileName,
    sourceItemIds: revs.map((r) => r.id),
    confidence: 'medium',
    absorbed: [],
    trimmed: false,
  };
}

// --- SingleCase -------------------------------------------------------------
// Items arrive with the case already known. Group by case id — each case
// gets one session spanning its activity that day. Confidence is always high
// because the case attribution is confirmed by the source system.

function clusterSingleCase(items: NormalizedItem[]): WorkSession[] {
  const byCase = new Map<string, NormalizedItem[]>();
  for (const item of items) {
    const list = byCase.get(item.groupKey) ?? [];
    list.push(item);
    byCase.set(item.groupKey, list);
  }

  const sessions: WorkSession[] = [];
  for (const [caseId, caseItems] of byCase) {
    caseItems.sort((a, b) => a.start - b.start);
    const start = caseItems[0].start;
    const end = caseItems[caseItems.length - 1].end;
    const span = Math.max(end - start, 2);

    sessions.push({
      id: `sc-${caseId}`,
      provider: 'singlecase',
      kind: 'singlecase.session',
      start,
      end,
      estimatedMinutes: span,
      label: caseItems[0].label,
      groupKey: caseId,
      sourceItemIds: caseItems.map((i) => i.id),
      confidence: 'high',
      absorbed: [],
      trimmed: false,
    });
  }
  return sessions;
}

// --- Browser ----------------------------------------------------------------
// Browser signals arrive as per-domain rollups within 15-minute buckets.
// Group by domain. Merge adjacent buckets for the same domain when the gap
// is under 15 minutes. Duration is the sum of bucket spans (not the overall
// span, which would include gaps between merged buckets).

function clusterBrowser(items: NormalizedItem[]): WorkSession[] {
  const byDomain = new Map<string, NormalizedItem[]>();
  for (const item of items) {
    const list = byDomain.get(item.groupKey) ?? [];
    list.push(item);
    byDomain.set(item.groupKey, list);
  }

  const sessions: WorkSession[] = [];
  for (const [domain, buckets] of byDomain) {
    buckets.sort((a, b) => a.start - b.start);

    let current: NormalizedItem[] = [];
    let lastEnd: number | null = null;

    for (const bucket of buckets) {
      if (lastEnd !== null && bucket.start - lastEnd > 15 && current.length > 0) {
        sessions.push(makeBrowserSession(domain, current));
        current = [];
      }
      current.push(bucket);
      lastEnd = Math.max(lastEnd ?? 0, bucket.end);
    }
    if (current.length > 0) {
      sessions.push(makeBrowserSession(domain, current));
    }
  }
  return sessions;
}

function makeBrowserSession(domain: string, buckets: NormalizedItem[]): WorkSession {
  const start = buckets[0].start;
  const end = buckets[buckets.length - 1].end;
  const totalMinutes = buckets.reduce((sum, b) => sum + (b.end - b.start), 0);
  return {
    id: `browser-${domain}-${start}`,
    provider: 'browser',
    kind: 'browser.session',
    start,
    end,
    estimatedMinutes: Math.max(totalMinutes, 2),
    label: buckets[0].label,
    groupKey: domain,
    sourceItemIds: buckets.map((b) => b.id),
    confidence: 'low',
    absorbed: [],
    trimmed: false,
  };
}
