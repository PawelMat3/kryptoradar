// Ocena tożsamości: na ile pewne jest, że dany profil / strona należy do badanej osoby.
// To osobny wymiar od kategorii źródła – ten sam nick na dwóch serwisach nie musi oznaczać
// tej samej osoby. Współczynnik T (0–1) mnoży wynik wystąpienia adresu.
import type { IdentityAssessment, RuleHit } from './scoring.js';

export type Discovery = 'analyst' | 'maigret' | 'crosslink' | 'search' | 'pivot';

export interface ProfileEvidence {
  discovery: Discovery;
  /** Profil wskazany linkiem z innego profilu – podajemy współczynnik T profilu linkującego. */
  linkedFrom: { url: string; factor: number }[];
  /** Profil sam linkuje do innego profilu badanej osoby o ustalonym T. */
  linksToSubject: { url: string; factor: number }[];
  tokenMatches: { type: string; value: string }[];
  /** Odsetek sprawdzonych serwisów, na których nick istnieje (0–1); null gdy nie sprawdzano. */
  nickPopularity: number | null;
  username: string | null;
  /** Imię/nazwisko zadeklarowane na profilu, gdy nie pasuje do badanej osoby. */
  conflictingName: string | null;
}

const BASE: Record<Discovery, { v: number; d: string }> = {
  analyst: { v: 1.0, d: 'Źródło wskazane bezpośrednio przez analityka' },
  crosslink: { v: 0.85, d: 'Profil wskazany linkiem z profilu badanej osoby' },
  maigret: { v: 0.6, d: 'Konto o identycznym nicku znalezione przez Maigret' },
  pivot: { v: 0.6, d: 'Strona powiązana z profilem (ten sam serwis)' },
  search: { v: 0.4, d: 'Strona znaleziona w wyszukiwarce po identyfikatorze' },
};

export function assessIdentity(e: ProfileEvidence): IdentityAssessment {
  const hits: RuleHit[] = [];
  let f = BASE[e.discovery].v;
  if (e.discovery === 'crosslink') {
    // Link jest tak wiarygodny jak profil, z którego prowadzi (maks. 0.85, min. 0.4).
    const best = Math.max(0, ...e.linkedFrom.map((l) => l.factor));
    f = Math.min(0.85, Math.max(0.4, best));
  }
  hits.push({ rule: `ID_${e.discovery.toUpperCase()}`, description: BASE[e.discovery].d, value: f, kind: 'base' });

  const strongIn = e.linkedFrom.filter((l) => l.factor >= 0.8);
  if (strongIn.length && f < 0.85) {
    hits.push({ rule: 'ID_CROSSLINK_IN', description: `Link do tego profilu z profilu badanej osoby (${strongIn[0].url})`, value: 0.85 - f, kind: 'add' });
    f = 0.85;
  }
  const out = e.linksToSubject.filter((l) => l.factor >= 0.6);
  if (out.length) {
    hits.push({ rule: 'ID_CROSSLINK_OUT', description: `Profil linkuje do innego profilu badanej osoby (${out[0].url})`, value: 0.1, kind: 'add' });
    f += 0.1;
  }
  const uniqTokens = [...new Map(e.tokenMatches.map((t) => [t.type + t.value, t])).values()];
  for (const t of uniqTokens.slice(0, 3)) {
    hits.push({ rule: 'ID_TOKEN_MATCH', description: `Na stronie występuje identyfikator badanej osoby (${t.type}: ${t.value})`, value: 0.15, kind: 'add' });
    f += 0.15;
  }
  if (e.nickPopularity !== null && e.nickPopularity >= 0.5 && e.discovery === 'maigret') {
    hits.push({
      rule: 'ID_COMMON_NICK',
      description: `Nick pospolity – istnieje na ${Math.round(e.nickPopularity * 100)}% sprawdzonych serwisów`,
      value: -0.2,
      kind: 'add',
    });
    f -= 0.2;
  }
  if (e.username && e.username.length <= 4 && e.discovery === 'maigret') {
    hits.push({ rule: 'ID_SHORT_NICK', description: 'Bardzo krótki nick – wysokie ryzyko zbieżności', value: -0.15, kind: 'add' });
    f -= 0.15;
  }
  if (e.conflictingName) {
    hits.push({ rule: 'ID_NAME_CONFLICT', description: `Profil deklaruje inną osobę („${e.conflictingName}”)`, value: -0.35, kind: 'add' });
    f -= 0.35;
  }
  f = Math.max(0.05, Math.min(1, Math.round(f * 100) / 100));
  return { factor: f, hits };
}

/** Czy imię i nazwisko zadeklarowane na profilu jest sprzeczne z badaną osobą. */
export function nameConflicts(subjectName: string | undefined, declared: string | null): boolean {
  if (!subjectName || !declared) return false;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l')
      .split(/[\s-]+/)
      .filter((w) => w.length > 2);
  const a = new Set(norm(subjectName));
  const b = norm(declared);
  return b.length > 0 && !b.some((w) => a.has(w));
}
