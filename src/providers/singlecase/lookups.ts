import type {
  SingleCaseCase,
  SingleCaseContact,
  SingleCaseProjectState,
} from './types';
import { GENERIC_EMAIL_DOMAINS } from './constants';

export interface EmailMatterMatch {
  email_address: string;
  email_domain: string;
  matter_id: string;
  contact_external_id: string;
  is_adversary: boolean;
}

export interface EmailLookupIndex {
  byAddress: Map<string, EmailMatterMatch[]>;
  byDomain: Map<string, EmailMatterMatch[]>;
}

export function buildEmailLookup(
  cases: SingleCaseCase[],
  contacts: SingleCaseContact[],
): EmailLookupIndex {
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const byAddress = new Map<string, EmailMatterMatch[]>();
  const byDomain = new Map<string, EmailMatterMatch[]>();

  for (const scCase of cases) {
    for (const ref of scCase.contacts) {
      const contact = contactById.get(ref.id);
      if (!contact || !contact.email) continue;
      const domain = contact.email.split('@')[1]?.toLowerCase() ?? '';
      const match: EmailMatterMatch = {
        email_address: contact.email.toLowerCase(),
        email_domain: domain,
        matter_id: scCase.id,
        contact_external_id: contact.id,
        is_adversary: false,
      };
      addToList(byAddress, match.email_address, match);
      if (!isGenericDomain(domain)) addToList(byDomain, domain, match);
    }
    for (const ref of scCase.adversaries) {
      const contact = contactById.get(ref.id);
      if (!contact || !contact.email) continue;
      const domain = contact.email.split('@')[1]?.toLowerCase() ?? '';
      const match: EmailMatterMatch = {
        email_address: contact.email.toLowerCase(),
        email_domain: domain,
        matter_id: scCase.id,
        contact_external_id: contact.id,
        is_adversary: true,
      };
      addToList(byAddress, match.email_address, match);
      if (!isGenericDomain(domain)) addToList(byDomain, domain, match);
    }
  }
  return { byAddress, byDomain };
}

function addToList(map: Map<string, EmailMatterMatch[]>, key: string, match: EmailMatterMatch): void {
  const list = map.get(key) ?? [];
  list.push(match);
  map.set(key, list);
}

function isGenericDomain(domain: string): boolean {
  return GENERIC_EMAIL_DOMAINS.has(domain);
}

export function deriveClientPrimaryDomains(
  cases: SingleCaseCase[],
  contacts: SingleCaseContact[],
): Map<string, string | null> {
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const domainsByClient = new Map<string, Map<string, number>>();

  for (const scCase of cases) {
    const clientId = scCase.client_id;
    const domainCounts = domainsByClient.get(clientId) ?? new Map<string, number>();
    for (const ref of [...scCase.contacts, ...scCase.adversaries]) {
      const contact = contactById.get(ref.id);
      if (!contact || !contact.email) continue;
      const domain = contact.email.split('@')[1]?.toLowerCase() ?? '';
      if (!domain || isGenericDomain(domain)) continue;
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    }
    domainsByClient.set(clientId, domainCounts);
  }

  const result = new Map<string, string | null>();
  for (const [clientId, domainCounts] of domainsByClient) {
    let bestDomain: string | null = null;
    let bestCount = 0;
    for (const [domain, count] of domainCounts) {
      if (count > bestCount) { bestDomain = domain; bestCount = count; }
    }
    result.set(clientId, bestDomain);
  }
  return result;
}

export function buildStateMap(states: SingleCaseProjectState[]): Map<string, SingleCaseProjectState> {
  return new Map(states.map((s) => [s.id, s]));
}

export function resolveStateIsOpen(
  projectStateId: string,
  stateMap: Map<string, SingleCaseProjectState>,
): boolean {
  const state = stateMap.get(projectStateId);
  if (state) return state.is_open;
  return true;
}

export function resolveStateName(
  projectStateId: string,
  stateMap: Map<string, SingleCaseProjectState>,
): string {
  const state = stateMap.get(projectStateId);
  if (state) return state.name;
  return projectStateId;
}
