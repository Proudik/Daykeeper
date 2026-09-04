import type { ActivityItem, ActivityMeta, Provider } from '@/types';

/**
 * Generates realistic mock activity items for testing the calendar board.
 * Produces a dense hour (9:00–10:00) with overlapping signals across all columns,
 * plus scattered items throughout the day.
 */

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `mock-${prefix}-${counter}`;
}

function iso(date: string, h: number, m: number): string {
  return `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function isoEnd(date: string, h: number, m: number, durMin: number): string {
  const total = h * 60 + m + durMin;
  const eh = Math.floor(total / 60);
  const em = total % 60;
  return `${date}T${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`;
}

export function generateMockItems(date: string): ActivityItem[] {
  const items: ActivityItem[] = [];

  // ── Calendar column (3 events, one overlapping) ──────────────────────
  items.push(
    calItem(date, 9, 0, 45, 'Client meeting — Smith v. Jones', 6, 'Smith v. Jones'),
    calItem(date, 10, 30, 60, 'Internal case review', 3, 'Internal matter'),
    calItem(date, 14, 0, 30, 'Phone call with opposing counsel', 2, 'Novak dispute'),
  );

  // ── Sent Emails column (5 emails in the 9:00 hour, plus scattered) ──
  items.push(
    emailSent(date, 9, 5, 3, 'Re: Contract review — draft attached', 'j.novak@lawfirm.cz', 'client@novak.cz'),
    emailSent(date, 9, 12, 5, 'Update on filing deadline', 'p.kovar@lawfirm.cz', 'court@msoud.cz'),
    emailSent(date, 9, 18, 2, 'Re: Re: Re: Settlement discussion', 'a.dvorak@lawfirm.cz', 'opposing@partner.cz'),
    emailSent(date, 9, 28, 8, 'Memo: Case strategy notes', 'j.novak@lawfirm.cz', 'team@lawfirm.cz'),
    emailSent(date, 9, 45, 3, 'Confirmation: Meeting tomorrow', 'j.novak@lawfirm.cz', 'client@novak.cz'),
    emailSent(date, 11, 15, 5, 'Re: Invoice query', 'p.kovar@lawfirm.cz', 'billing@client.cz'),
    emailSent(date, 15, 30, 4, 'Document request — financial records', 'a.dvorak@lawfirm.cz', 'bank@csob.cz'),
  );

  // ── SC Documents column (4 doc edits, 3 in the same hour) ──────────
  items.push(
    scDoc(date, 9, 10, 20, 'Contract_Novak_v3.docx', 'case-novak-001', 'Novak v. CSOB', 'NOV-2024-001'),
    scDoc(date, 9, 35, 15, 'Memorandum_research.docx', 'case-novak-001', 'Novak v. CSOB', 'NOV-2024-001'),
    scDoc(date, 9, 52, 8, 'Settlement_draft_v2.docx', 'case-dvorak-002', 'Dvorak dispute', 'DV-2024-002'),
    scDoc(date, 13, 20, 25, 'Pleadings_final.docx', 'case-kovar-003', 'Kovars estate', 'KOV-2024-003'),
  );

  // ── SC Other column (notes, tasks, proceedings — grouped by case) ──
  // Case: Novak — 3 actions
  items.push(
    scNote(date, 9, 15, 'Note: Reviewed opposing counsel arguments', 'case-novak-001', 'Novak v. CSOB', 'NOV-2024-001'),
    scTask(date, 9, 22, 10, 'Task: Prepare witness list', 'case-novak-001', 'Novak v. CSOB', 'NOV-2024-001'),
    scNote(date, 9, 38, 'Note: Filed motion to compel', 'case-novak-001', 'Novak v. CSOB', 'NOV-2024-001'),
  );
  // Case: Dvorak — 2 actions
  items.push(
    scNote(date, 9, 55, 'Note: Settlement negotiation points', 'case-dvorak-002', 'Dvorak dispute', 'DV-2024-002'),
    scTask(date, 10, 5, 15, 'Task: Draft response to motion', 'case-dvorak-002', 'Dvorak dispute', 'DV-2024-002'),
  );
  // Case: Kovar — 2 actions
  items.push(
    scNote(date, 14, 10, 'Note: Estate inventory review', 'case-kovar-003', 'Kovars estate', 'KOV-2024-003'),
    scTask(date, 14, 25, 20, 'Task: Contact heirs for signatures', 'case-kovar-003', 'Kovars estate', 'KOV-2024-003'),
  );
  // No-case action
  items.push(
    scNote(date, 11, 0, 'Note: General research on precedent', undefined, undefined, undefined),
  );

  // ── Browser column (many short visits, dense in 9:00 hour) ──────────
  const browserSites = [
    'msoud.cz', 'zakony.cz', 'nsoud.cz', 'justice.cz', 'courthouse.cz',
    'caselaw.eu', 'echr.cz', 'lawlibrary.cz', 'regulation.cz', 'barassociation.cz',
  ];
  // Dense: 8 visits between 9:00 and 10:00
  for (let i = 0; i < 8; i++) {
    const m = i * 7;
    items.push(browserItem(date, 9, m, 3 + (i % 3), browserSites[i]));
  }
  // Scattered: 5 more throughout the day
  items.push(
    browserItem(date, 11, 30, 12, 'msoud.cz'),
    browserItem(date, 12, 45, 5, 'seznam.cz'),
    browserItem(date, 14, 30, 8, 'justice.cz'),
    browserItem(date, 15, 50, 3, 'zakony.cz'),
    browserItem(date, 16, 20, 15, 'caselaw.eu'),
  );

  // ── Other column (received emails, chat, custom) ────────────────────
  items.push(
    emailReceived(date, 8, 45, 'Re: Case update from court', 'court@msoud.cz', 'j.novak@lawfirm.cz'),
    emailReceived(date, 9, 3, 'FW: Opposing counsel response', 'opposing@partner.cz', 'a.dvorak@lawfirm.cz'),
    emailReceived(date, 9, 20, 'Re: Re: Contract terms', 'client@novak.cz', 'j.novak@lawfirm.cz'),
    emailReceived(date, 10, 15, 'Newsletter: Legal updates this week', 'newsletter@lawnews.cz', 'j.novak@lawfirm.cz'),
    emailReceived(date, 13, 0, 'Re: Invoice attached', 'billing@client.cz', 'p.kovar@lawfirm.cz'),
    chatItem(date, 9, 30, 5, '#novak-case', 8),
    chatItem(date, 10, 0, 3, '#general', 4),
    chatItem(date, 14, 45, 10, '#dvorak-litigation', 12),
  );

  return items;
}

// ── Builders ───────────────────────────────────────────────────────────

function calItem(
  date: string, h: number, m: number, dur: number,
  title: string, attendees: number, _matter: string,
): ActivityItem {
  return {
    id: uid('cal'),
    provider: 'calendar',
    timestamp: iso(date, h, m),
    endTimestamp: isoEnd(date, h, m, dur),
    durationMinutes: dur,
    summary: title,
    meta: { title, attendeeCount: attendees, accepted: true },
  };
}

function emailSent(
  date: string, h: number, m: number, dur: number,
  subject: string, sender: string, recipient: string,
): ActivityItem {
  const meta: ActivityMeta = {
    subject,
    sender,
    recipient,
    direction: 'outgoing',
    threadId: `thread-${h}${m}`,
    wordCount: 100 + dur * 20,
  };
  return {
    id: uid('mail'),
    provider: 'email',
    timestamp: iso(date, h, m),
    durationMinutes: dur,
    summary: subject,
    meta,
  };
}

function emailReceived(
  date: string, h: number, m: number,
  subject: string, sender: string, recipient: string,
): ActivityItem {
  return {
    id: uid('mail'),
    provider: 'email',
    timestamp: iso(date, h, m),
    durationMinutes: 2,
    summary: subject,
    meta: { subject, sender, recipient, direction: 'incoming', threadId: `thread-r-${h}${m}` },
  };
}

function scDoc(
  date: string, h: number, m: number, dur: number,
  fileName: string, caseId: string | undefined, caseName: string | undefined, caseIdVisible: string | undefined,
): ActivityItem {
  return {
    id: uid('scdoc'),
    provider: 'singlecase',
    timestamp: iso(date, h, m),
    endTimestamp: isoEnd(date, h, m, dur),
    durationMinutes: dur,
    summary: `Editing ${fileName}`,
    meta: {
      caseId, caseName, caseIdVisible,
      scActivityKind: 'document',
      fileName,
      revisionCount: 1 + Math.floor(Math.random() * 3),
    },
  };
}

function scNote(
  date: string, h: number, m: number,
  summary: string, caseId: string | undefined, caseName: string | undefined, caseIdVisible: string | undefined,
): ActivityItem {
  return {
    id: uid('scnote'),
    provider: 'singlecase',
    timestamp: iso(date, h, m),
    durationMinutes: 5,
    summary,
    meta: { caseId, caseName, caseIdVisible, scActivityKind: 'note', noteTitle: summary },
  };
}

function scTask(
  date: string, h: number, m: number, dur: number,
  summary: string, caseId: string | undefined, caseName: string | undefined, caseIdVisible: string | undefined,
): ActivityItem {
  return {
    id: uid('sctask'),
    provider: 'singlecase',
    timestamp: iso(date, h, m),
    durationMinutes: dur,
    summary,
    meta: { caseId, caseName, caseIdVisible, scActivityKind: 'task', ticketTitle: summary },
  };
}

function browserItem(
  date: string, h: number, m: number, dur: number,
  domain: string,
): ActivityItem {
  return {
    id: uid('brw'),
    provider: 'browser',
    timestamp: iso(date, h, m),
    endTimestamp: isoEnd(date, h, m, dur),
    durationMinutes: dur,
    summary: domain,
    meta: { fileName: domain },
  };
}

function chatItem(
  date: string, h: number, m: number, dur: number,
  channel: string, msgCount: number,
): ActivityItem {
  return {
    id: uid('chat'),
    provider: 'chat',
    timestamp: iso(date, h, m),
    endTimestamp: isoEnd(date, h, m, dur),
    durationMinutes: dur,
    summary: `Chat in ${channel}`,
    meta: { channel, messageCount: msgCount },
  };
}
