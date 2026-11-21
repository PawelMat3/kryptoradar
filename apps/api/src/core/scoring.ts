// Wskaźnik Pewności (Confidence Score) – w pełni deterministyczny i wyjaśnialny.
// Każdy krok obliczenia zapisuje regułę (id, opis, wartość), dzięki czemu analityk KAS
// może odtworzyć wynik ręcznie. AI nie uczestniczy w obliczeniu.
//
// Wzór dla pojedynczego wystąpienia adresu (occurrence):
//   wystąpienie = clamp(BAZA[kategoria źródła] + Σ modyfikatory kontekstu, 0, 100) × T(tożsamość profilu)
// Wynik adresu:
//   wynik = max(wystąpienie) + premia synergii (+15 za ≥2 niezależne źródła)
//                            + premia on-chain (+10 za bezpośredni przepływ z/do adresu ≥80%)
//   ograniczony do 100; wykluczenie (giełda, kontrakt, mikser, zbiórka…) → 0.

export type SourceCategory =
  | 'OWN_PROFILE'
  | 'PERSONAL_SITE'
  | 'CODE_REPOSITORY'
  | 'P2P_LISTING'
  | 'EMAIL_SIGNATURE'
  | 'MESSENGER_SETTLEMENT'
  | 'FORUM_POST'
  | 'MASS_COMMENT'
  | 'UNKNOWN_WEB';

export const CATEGORY_BASE: Record<SourceCategory, { base: number; label: string }> = {
  OWN_PROFILE: { base: 90, label: 'Własny, autorski profil (np. GitHub, zweryfikowane konto)' },
  PERSONAL_SITE: { base: 85, label: 'Osobista strona WWW' },
  CODE_REPOSITORY: { base: 80, label: 'Repozytorium kodu należące do profilu' },
  P2P_LISTING: { base: 70, label: 'Ogłoszenie sprzedaży / oferta P2P' },
  EMAIL_SIGNATURE: { base: 65, label: 'Stopka e-mail' },
  MESSENGER_SETTLEMENT: { base: 65, label: 'Komunikator – kontekst rozliczenia' },
  FORUM_POST: { base: 50, label: 'Wpis w dyskusji na forum / grupie' },
  MASS_COMMENT: { base: 20, label: 'Masowe komentarze (konkursy, giveawaye)' },
  UNKNOWN_WEB: { base: 40, label: 'Inna strona internetowa' },
};

export interface RuleHit {
  rule: string;
  description: string;
  /** Zmiana punktowa (+/-) albo mnożnik (gdy kind = 'factor'). */
  value: number;
  kind: 'base' | 'add' | 'factor' | 'exclude' | 'cap';
}

export interface ContextRule {
  id: string;
  description: string;
  delta: number;
  pattern: RegExp;
}

// Słowa kluczowe PL/EN wskazujące, że adres należy do autora wpisu…
export const CONTEXT_RULES: ContextRule[] = [
  {
    id: 'CTX_OWNERSHIP',
    description: 'Kontekst własności („mój portfel”, „wpłaty na”, „donate”)',
    delta: 5,
    pattern: /(m[oó]j (adres|portfel)|moje portfele|wp[łl]at[yaę]? na|p[łl]atno[śs][ćc] na|przelej na|donat|donate|tip jar|send to me|my wallet|my address|pay(ment)? to)/i,
  },
  {
    id: 'CTX_SETTLEMENT',
    description: 'Kontekst rozliczenia transakcji („sprzedam”, „cena”, „kupię”)',
    delta: 5,
    pattern: /(sprzedam|kupi[eę]|cena|z[łl]\b|pln|wts|wtb|for sale|rozliczeni)/i,
  },
  // …lub że adres należy do kogoś innego.
  {
    id: 'CTX_THIRD_PARTY',
    description: 'Kontekst wskazujący na cudzy adres („adres giełdy”, „oszust”, „kontrakt”)',
    delta: -25,
    pattern: /(adres gie[łl]dy|na gie[łl]d[eęy]|wysy[łl]am na (binance|kraken|coinbase|zonda|okx)|scam|oszust|uwa[żz]ajcie|nie wysy[łl]ajcie|kontrakt|contract|router|exchange address|hot wallet)/i,
  },
];

export interface IdentityAssessment {
  /** Współczynnik 0–1: jak pewne jest, że profil/źródło należy do badanej osoby. */
  factor: number;
  hits: RuleHit[];
}

export interface Occurrence {
  artifactId: string;
  sourceId: string;
  sourceName: string;
  url: string;
  category: SourceCategory;
  context: string;
  /** Zdanie z adresem – reguły kontekstu są sprawdzane tylko na nim. Brak = cały kontekst. */
  sentence?: string;
  quoted: boolean;
  author: string | null;
  identity: IdentityAssessment;
  retrievedAt: string;
}

export interface OccurrenceScore {
  score: number;
  hits: RuleHit[];
}

export function scoreOccurrence(o: Occurrence): OccurrenceScore {
  const hits: RuleHit[] = [];
  const cat = CATEGORY_BASE[o.category];
  let s = cat.base;
  hits.push({ rule: `BASE_${o.category}`, description: `Baza: ${cat.label}`, value: cat.base, kind: 'base' });
  for (const r of CONTEXT_RULES) {
    if (r.pattern.test(o.sentence ?? o.context)) {
      s += r.delta;
      hits.push({ rule: r.id, description: r.description, value: r.delta, kind: 'add' });
    }
  }
  if (o.quoted) {
    s -= 20;
    hits.push({ rule: 'CTX_QUOTED', description: 'Adres w cytacie cudzej wypowiedzi', value: -20, kind: 'add' });
  }
  s = Math.max(0, Math.min(100, s));
  const f = o.identity.factor;
  hits.push({
    rule: 'IDENTITY_FACTOR',
    description: `Pewność, że źródło należy do badanej osoby (×${f.toFixed(2)}: ${o.identity.hits.map((h) => h.rule).join(', ') || 'brak reguł'})`,
    value: f,
    kind: 'factor',
  });
  return { score: Math.round(s * f), hits };
}

export type ExclusionCategory = 'exchange' | 'custodial' | 'contract' | 'mixer' | 'charity' | 'institution' | 'token' | 'defi' | 'p2p' | 'offramp' | 'bridge';

/** Kategorie, które wykluczają przypisanie osobowe (cheat sheet KROK 3). */
export const EXCLUDING_CATEGORIES: ExclusionCategory[] = ['exchange', 'custodial', 'contract', 'mixer', 'charity', 'institution', 'token', 'defi', 'p2p', 'offramp', 'bridge'];

export interface Exclusion {
  rule: string;
  reason: string;
  category: ExclusionCategory;
  evidence: string;
}

export interface AddressScoreInput {
  occurrences: (Occurrence & { occ: OccurrenceScore })[];
  exclusion: Exclusion | null;
  /** Bezpośrednie przepływy on-chain do/z innych adresów badanej osoby o wysokiej pewności. */
  onChainLinks: { address: string; score: number; txHash: string }[];
}

export type Tier = 'BARDZO_WYSOKIE' | 'PRAWDOPODOBNE' | 'SREDNIE' | 'NISKIE' | 'ZNIKOME' | 'WYKLUCZONE';

export const TIERS: { tier: Tier; min: number; label: string }[] = [
  { tier: 'BARDZO_WYSOKIE', min: 80, label: 'Bardzo wysokie prawdopodobieństwo (80–100%)' },
  { tier: 'PRAWDOPODOBNE', min: 60, label: 'Prawdopodobne (60–79%)' },
  { tier: 'SREDNIE', min: 40, label: 'Średnie – wymaga drugiego śladu (40–59%)' },
  { tier: 'NISKIE', min: 10, label: 'Niskie / szum (10–39%)' },
  { tier: 'ZNIKOME', min: 1, label: 'Znikome (1–9%)' },
];

export function tierOf(score: number, excluded: boolean): Tier {
  if (excluded || score <= 0) return 'WYKLUCZONE';
  return TIERS.find((t) => score >= t.min)?.tier ?? 'ZNIKOME';
}

export interface AddressScore {
  score: number;
  tier: Tier;
  status: 'attributed' | 'excluded';
  best: OccurrenceScore | null;
  hits: RuleHit[];
  independentSources: string[];
}

export const SYNERGY_BONUS = 15;
export const ONCHAIN_BONUS = 10;
/** Minimalna pewność tożsamości, by źródło liczyło się do synergii. */
export const SYNERGY_MIN_IDENTITY = 0.5;

export function scoreAddress(input: AddressScoreInput): AddressScore {
  const hits: RuleHit[] = [];
  const sorted = [...input.occurrences].sort((a, b) => b.occ.score - a.occ.score);
  const best = sorted[0]?.occ ?? null;
  const independent = [...new Set(input.occurrences.filter((o) => o.identity.factor >= SYNERGY_MIN_IDENTITY).map((o) => o.sourceId))];

  if (input.exclusion) {
    hits.push({ rule: input.exclusion.rule, description: `Wykluczenie: ${input.exclusion.reason}`, value: 0, kind: 'exclude' });
    return { score: 0, tier: 'WYKLUCZONE', status: 'excluded', best, hits, independentSources: independent };
  }

  let score = best?.score ?? 0;
  if (best) hits.push(...best.hits, { rule: 'BEST_OCCURRENCE', description: `Najsilniejsze wystąpienie (${sorted[0].sourceName})`, value: best.score, kind: 'base' });

  if (independent.length >= 2) {
    score += SYNERGY_BONUS;
    hits.push({
      rule: 'SYNERGY',
      description: `Synergia śladów: adres w ${independent.length} niezależnych źródłach (${independent.join(', ')})`,
      value: SYNERGY_BONUS,
      kind: 'add',
    });
  }
  const strongLink = input.onChainLinks.find((l) => l.score >= 80);
  if (strongLink && score > 0) {
    score += ONCHAIN_BONUS;
    hits.push({
      rule: 'ONCHAIN_LINK',
      description: `Bezpośredni przepływ on-chain z adresem badanej osoby o wysokiej pewności (${strongLink.address.slice(0, 10)}…, tx ${strongLink.txHash.slice(0, 12)}…)`,
      value: ONCHAIN_BONUS,
      kind: 'add',
    });
  }
  if (score > 100) {
    hits.push({ rule: 'CAP_100', description: 'Ograniczenie do 100%', value: 100, kind: 'cap' });
    score = 100;
  }
  return { score, tier: tierOf(score, false), status: 'attributed', best, hits, independentSources: independent };
}
