// Graf powiązań: identyfikatory → źródła → adresy → kontrahenci oznaczeni (giełdy, bramki…).
// Układ kolumnowy czyta się od lewej do prawej jak ścieżkę dowodową.
import type { RunDetail } from './api';

interface Node {
  id: string;
  col: number;
  label: string;
  sub: string;
  color: string;
  dashed?: boolean;
}
interface Edge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

const COLS = ['Identyfikatory', 'Źródła (Web2)', 'Adresy (Web3)', 'Kontrahenci oznaczeni'];
const W = 1180;
const COL_X = [20, 300, 600, 900];
const NODE_W = 250;
const NODE_H = 40;
const GAP = 14;

const tierColor = (t: string) =>
  t === 'BARDZO_WYSOKIE' || t === 'PRAWDOPODOBNE' ? 'var(--high)' : t === 'SREDNIE' ? 'var(--mid)' : t === 'WYKLUCZONE' ? 'var(--excl)' : 'var(--low)';
const short = (a: string) => (a.length > 22 ? `${a.slice(0, 10)}…${a.slice(-8)}` : a);

export function Graph({ d }: { d: RunDetail }) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const ids = d.kase.identifiers;
  const add = (n: Node) => {
    if (!nodes.some((x) => x.id === n.id)) nodes.push(n);
  };

  const idTokens: [string, string][] = [
    ...(ids.fullName ? [['imię i nazwisko', ids.fullName] as [string, string]] : []),
    ...ids.usernames.map((u) => ['nick', u] as [string, string]),
    ...ids.emails.map((u) => ['e-mail', u] as [string, string]),
    ...ids.messengers.map((u) => ['komunikator', u] as [string, string]),
  ];
  idTokens.forEach(([t, v]) => add({ id: `id:${v.toLowerCase()}`, col: 0, label: v, sub: t, color: 'var(--accent)' }));

  const usedArtifacts = new Set(d.findings.flatMap((f) => f.occurrences.map((o) => o.artifactId)));
  for (const a of d.artifacts) {
    if (!usedArtifacts.has(a.id) && a.discovery !== 'maigret') continue;
    const f = a.identity?.factor ?? 0;
    add({ id: `a:${a.id}`, col: 1, label: a.source_name.replace(/ \(.*\)$/, ''), sub: `${new URL(a.final_url).host}${new URL(a.final_url).pathname} · T=${f.toFixed(2)}`, color: f >= 0.8 ? 'var(--high)' : f >= 0.5 ? 'var(--mid)' : 'var(--low)', dashed: f < 0.5 });
    const user = a.meta.username?.toLowerCase();
    const q = a.meta.searchQuery?.replace(/"/g, '').toLowerCase();
    const from = user ? `id:${user}` : q ? `id:${q}` : null;
    if (from && nodes.some((n) => n.id === from)) edges.push({ from, to: `a:${a.id}`, label: a.discovery });
  }
  // krawędzie "link z profilu"
  for (const a of d.artifacts) {
    if (a.discovery !== 'crosslink' && a.discovery !== 'pivot') continue;
    const parent = d.artifacts.find((p) => a.discovered_via?.includes(p.final_url));
    if (parent && nodes.some((n) => n.id === `a:${parent.id}`) && nodes.some((n) => n.id === `a:${a.id}`)) edges.push({ from: `a:${parent.id}`, to: `a:${a.id}`, label: 'link', dashed: true });
  }

  for (const f of d.findings) {
    if (!f.occurrences.length && f.status !== 'no-evidence') continue;
    add({ id: `f:${f.id}`, col: 2, label: `${f.chain} ${short(f.address)}`, sub: f.status === 'excluded' ? `0% · ${f.exclusion?.category}` : `${f.score}%`, color: tierColor(f.tier), dashed: f.status === 'excluded' });
    for (const o of f.occurrences) if (nodes.some((n) => n.id === `a:${o.artifactId}`)) edges.push({ from: `a:${o.artifactId}`, to: `f:${f.id}`, dashed: f.status === 'excluded' });
  }

  for (const c of d.chain) {
    const f = d.findings.find((x) => x.address.toLowerCase() === c.address.toLowerCase());
    if (!f) continue;
    const seen = new Set<string>();
    for (const fl of c.flows) {
      if (!fl.counterpartyLabel || !fl.counterparty) continue;
      const k = `cp:${fl.counterparty.toLowerCase()}`;
      add({ id: k, col: 3, label: fl.counterpartyLabel, sub: fl.counterpartyCategory ?? '', color: fl.counterpartyCategory === 'exchange' || fl.counterpartyCategory === 'offramp' ? 'var(--danger)' : 'var(--ink-3)' });
      const ek = `${f.id}->${k}`;
      if (seen.has(ek)) continue;
      seen.add(ek);
      edges.push({ from: `f:${f.id}`, to: k, label: fl.direction === 'out' ? 'wypływ' : 'wpływ' });
    }
    // przepływy między adresami osoby
    for (const fl of c.flows) {
      const g = fl.counterparty && d.findings.find((x) => x.address.toLowerCase() === fl.counterparty!.toLowerCase() && x.id !== f.id);
      if (g && fl.direction === 'out') edges.push({ from: `f:${f.id}`, to: `f:${g.id}`, label: 'przelew', dashed: true });
    }
  }

  const pos = new Map<string, { x: number; y: number }>();
  const colCount = [0, 0, 0, 0];
  for (const n of nodes) {
    pos.set(n.id, { x: COL_X[n.col], y: 40 + colCount[n.col] * (NODE_H + GAP) });
    colCount[n.col]++;
  }
  const H = 60 + Math.max(...colCount, 1) * (NODE_H + GAP);

  return (
    <>
      <div className="graph-wrap">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Graf powiązań identyfikatorów, źródeł, adresów i kontrahentów">
          {COLS.map((c, i) => (
            <text key={c} className="col" x={COL_X[i]} y={22}>
              {c}
            </text>
          ))}
          {edges.map((e, i) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const sameCol = a.x === b.x;
            const x1 = sameCol ? a.x + NODE_W : a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = sameCol ? b.x + NODE_W : b.x;
            const y2 = b.y + NODE_H / 2;
            const path = sameCol ? `M${x1},${y1} C${x1 + 40},${y1} ${x2 + 40},${y2} ${x2},${y2}` : `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
            return <path key={i} d={path} fill="none" stroke="var(--ink-3)" strokeOpacity={0.6} strokeWidth={1.3} strokeDasharray={e.dashed ? '4 3' : undefined} />;
          })}
          {nodes.map((n) => {
            const p = pos.get(n.id)!;
            return (
              <g key={n.id} transform={`translate(${p.x},${p.y})`}>
                <title>{`${n.label}\n${n.sub}`}</title>
                <rect width={NODE_W} height={NODE_H} rx={5} fill="var(--surface)" stroke={n.color} strokeWidth={1.5} strokeDasharray={n.dashed ? '4 3' : undefined} />
                <rect width={4} height={NODE_H} rx={2} fill={n.color} />
                <text x={12} y={16}>
                  {n.label.length > 34 ? n.label.slice(0, 33) + '…' : n.label}
                </text>
                <text x={12} y={31} className="sub">
                  {n.sub.length > 40 ? n.sub.slice(0, 39) + '…' : n.sub}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}
