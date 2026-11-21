// Ekstrakcja identyfikatorów Web2 z treści (e-mail, Telegram, ENS) – służą do łączenia
// profili ze sobą ("pivot") oraz do oceny, czy profil należy do badanej osoby.

export interface SubjectIdentifiers {
  fullName?: string;
  usernames: string[];
  emails: string[];
  messengers: string[];
  profileUrls: string[];
  addresses: string[];
}

export interface FoundIdentifier {
  type: 'email' | 'telegram' | 'ens' | 'username';
  value: string;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TG_RE = /(?:t\.me\/|telegram\.me\/|tg\.test\/s\/)([A-Za-z][A-Za-z0-9_]{4,31})/gi;
const ENS_RE = /(?<![A-Za-z0-9-])([a-z0-9-]{3,}\.eth)(?![A-Za-z0-9])/g;

export function extractIdentifiers(text: string): FoundIdentifier[] {
  const out = new Map<string, FoundIdentifier>();
  for (const m of text.matchAll(EMAIL_RE)) out.set('email:' + m[0].toLowerCase(), { type: 'email', value: m[0].toLowerCase() });
  for (const m of text.matchAll(TG_RE)) out.set('tg:' + m[1].toLowerCase(), { type: 'telegram', value: m[1].toLowerCase() });
  for (const m of text.matchAll(ENS_RE)) out.set('ens:' + m[1], { type: 'ens', value: m[1] });
  return [...out.values()];
}

export function normalizeHandle(h: string): string {
  return h.trim().replace(/^@/, '').toLowerCase();
}

/** Kandydaci na nick do wyszukiwania w Maigrecie, z informacją skąd pochodzą. */
export function usernameCandidates(ids: SubjectIdentifiers): { username: string; origin: string }[] {
  const out = new Map<string, string>();
  for (const u of ids.usernames) if (u.trim()) out.set(normalizeHandle(u), 'nick podany przez analityka');
  for (const m of ids.messengers) if (m.trim() && !out.has(normalizeHandle(m))) out.set(normalizeHandle(m), 'identyfikator komunikatora');
  for (const e of ids.emails) {
    const local = e.split('@')[0]?.toLowerCase();
    if (local && local.length >= 4 && !out.has(local)) out.set(local, 'część lokalna adresu e-mail (wyprowadzone)');
  }
  return [...out.entries()].map(([username, origin]) => ({ username, origin }));
}

/** Wszystkie "silne" identyfikatory badanej osoby do szukania w treści stron. */
export function subjectTokens(ids: SubjectIdentifiers): { type: string; value: string }[] {
  const t: { type: string; value: string }[] = [];
  if (ids.fullName?.trim()) t.push({ type: 'imię i nazwisko', value: ids.fullName.trim().toLowerCase() });
  for (const e of ids.emails) if (e.trim()) t.push({ type: 'e-mail', value: e.trim().toLowerCase() });
  for (const m of ids.messengers) if (m.trim()) t.push({ type: 'komunikator', value: normalizeHandle(m) });
  return t;
}
