// Porównanie dwóch przebiegów analizy tej samej sprawy (kryterium opcjonalne):
// nowe/zniknięte adresy, zmiany wyniku, nowe profile oraz PODMIANA adresu na tym samym profilu.

export interface DiffFinding {
  chain: string;
  address: string;
  score: number;
  status: string;
  urls: string[];
}

export interface DiffInput {
  findings: DiffFinding[];
  profiles: string[];
}

export interface RunDiff {
  newAddresses: DiffFinding[];
  removedAddresses: DiffFinding[];
  scoreChanges: { address: string; chain: string; before: number; after: number }[];
  addressSwaps: { url: string; before: string[]; after: string[] }[];
  newProfiles: string[];
  removedProfiles: string[];
  summary: string;
}

const key = (f: DiffFinding) => `${f.chain}:${f.address.toLowerCase()}`;

export function diffRuns(prev: DiffInput, curr: DiffInput): RunDiff {
  const pm = new Map(prev.findings.map((f) => [key(f), f]));
  const cm = new Map(curr.findings.map((f) => [key(f), f]));
  const newAddresses = curr.findings.filter((f) => !pm.has(key(f)));
  const removedAddresses = prev.findings.filter((f) => !cm.has(key(f)));
  const scoreChanges = curr.findings
    .filter((f) => pm.has(key(f)) && Math.abs(pm.get(key(f))!.score - f.score) >= 5)
    .map((f) => ({ address: f.address, chain: f.chain, before: pm.get(key(f))!.score, after: f.score }));

  // Podmiana: ten sam URL, inny zestaw adresów niż poprzednio.
  const byUrl = (fs: DiffFinding[]) => {
    const m = new Map<string, Set<string>>();
    for (const f of fs) for (const u of f.urls) (m.get(u) ?? m.set(u, new Set()).get(u)!).add(f.address);
    return m;
  };
  const pu = byUrl(prev.findings);
  const cu = byUrl(curr.findings);
  const addressSwaps: RunDiff['addressSwaps'] = [];
  for (const [url, after] of cu) {
    const before = pu.get(url);
    if (!before) continue;
    const removed = [...before].filter((a) => !after.has(a));
    const added = [...after].filter((a) => !before.has(a));
    if (removed.length && added.length) addressSwaps.push({ url, before: removed, after: added });
  }

  const newProfiles = curr.profiles.filter((p) => !prev.profiles.includes(p));
  const removedProfiles = prev.profiles.filter((p) => !curr.profiles.includes(p));
  const parts = [
    addressSwaps.length && `${addressSwaps.length} podmian(a) adresu na profilu`,
    newAddresses.length && `${newAddresses.length} nowych adresów`,
    removedAddresses.length && `${removedAddresses.length} adresów zniknęło`,
    scoreChanges.length && `${scoreChanges.length} zmian wyniku`,
    newProfiles.length && `${newProfiles.length} nowych źródeł`,
  ].filter(Boolean);
  return {
    newAddresses,
    removedAddresses,
    scoreChanges,
    addressSwaps,
    newProfiles,
    removedProfiles,
    summary: parts.length ? parts.join(', ') : 'Brak zmian względem poprzedniego przebiegu',
  };
}
