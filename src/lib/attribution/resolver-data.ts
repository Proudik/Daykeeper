import type { Matter, MatterRule, ActivityItem } from '@/types';
import type { EstimatedEntry } from '@/lib/estimator/types';
import type {
  ContactIndexEntry,
  MatterContactEntry,
  ResolverContext,
  ResolvedSession,
  ScoredCandidate,
} from '@/lib/attribution/scoring-resolver';
import { resolveSessions } from '@/lib/attribution/scoring-resolver';
import type { EmailLookupIndex } from '@/providers/singlecase/lookups';

// ============================================================================
// Resolver data helpers — pure functions that build a ResolverContext from
// real org data loaded from Supabase. No mock fixtures.
// ============================================================================

export function getClientName(
  clientExternalId: string | null,
  clients: { id: string; name: string }[],
): string | null {
  if (!clientExternalId) return null;
  const client = clients.find((c) => c.id === clientExternalId);
  return client?.name ?? null;
}

export function getMatterPath(
  matter: Matter,
  matters: Matter[],
  clients: { id: string; name: string }[],
): string {
  const client = getClientName(matter.client_external_id, clients);
  if (matter.parent_external_id) {
    const parent = matters.find((m) => m.external_id === matter.parent_external_id);
    if (parent) {
      const parentClient = getClientName(parent.client_external_id, clients);
      if (parentClient && parentClient !== client) {
        return `${parentClient} › ${parent.name} › ${matter.name}`;
      }
      return `${parent.name} › ${matter.name}`;
    }
  }
  if (client) return `${client} › ${matter.name}`;
  return matter.name;
}

export function makeResolverContext(
  matters: Matter[],
  contacts: ContactIndexEntry[],
  matterContacts: MatterContactEntry[],
  emailLookup: EmailLookupIndex,
  currentUserId: string,
  rules: MatterRule[] = [],
): ResolverContext {
  return {
    matters,
    contacts,
    matterContacts,
    matterRules: rules,
    emailLookup,
    currentUserId,
  };
}

export function resolveDay(
  entries: EstimatedEntry[],
  sourceItems: ActivityItem[],
  matters: Matter[],
  contacts: ContactIndexEntry[],
  matterContacts: MatterContactEntry[],
  emailLookup: EmailLookupIndex,
  currentUserId: string,
  rules: MatterRule[] = [],
): ResolvedSession[] {
  return resolveSessions(
    entries,
    sourceItems,
    makeResolverContext(matters, contacts, matterContacts, emailLookup, currentUserId, rules),
  );
}

export { resolveSessions } from '@/lib/attribution/scoring-resolver';
export type { ResolvedSession, ScoredCandidate, ContactIndexEntry, MatterContactEntry } from '@/lib/attribution/scoring-resolver';
