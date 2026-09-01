// Generic email domains excluded from the domain→matter lookup entirely.
// Exact address matches on these domains are still valid — only the domain
// shortcut is blocked, because a gmail.com domain match would be ambiguous
// across potentially hundreds of matters.

export const GENERIC_EMAIL_DOMAINS = new Set<string>([
  'gmail.com',
  'seznam.cz',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'yahoo.com',
  'yahoo.cz',
  'protonmail.com',
  'proton.me',
  'centrum.cz',
  'email.cz',
  'post.cz',
]);
