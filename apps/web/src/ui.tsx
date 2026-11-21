import type { ReactNode } from 'react';

export const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'medium' }) : '—');

const STATUS: Record<string, string> = { queued: 'w kolejce', running: 'w toku', done: 'zakończony', error: 'błąd' };
export function StatusTag({ status }: { status: string }) {
  return <span className={`tag ${status === 'error' ? 'high' : status === 'running' || status === 'queued' ? 'medium' : ''}`}>{STATUS[status] ?? status}</span>;
}

export const TIER_LABEL: Record<string, string> = {
  BARDZO_WYSOKIE: 'bardzo wysokie',
  PRAWDOPODOBNE: 'prawdopodobne',
  SREDNIE: 'średnie',
  NISKIE: 'niskie',
  ZNIKOME: 'znikome',
  WYKLUCZONE: 'wykluczone',
};

export function ScoreBar({ score, tier }: { score: number; tier: string }) {
  return (
    <div className="score" title={TIER_LABEL[tier]}>
      <b className={`t-${tier}`}>{score}%</b>
      <span className="bar">
        <i className={`bg-${tier}`} style={{ width: `${Math.max(score, 2)}%` }} />
      </span>
    </div>
  );
}

export function Addr({ a, n = 0 }: { a: string; n?: number }) {
  const s = n && a.length > n * 2 + 1 ? `${a.slice(0, n + 2)}…${a.slice(-n)}` : a;
  return (
    <code title={a} style={{ cursor: 'copy' }} onClick={(e) => (e.stopPropagation(), navigator.clipboard?.writeText(a))}>
      {s}
    </code>
  );
}

/** Podświetla adres w kontekście wystąpienia. */
export function Highlight({ text, term }: { text: string; term: string }) {
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}

export function Kind({ kind }: { kind: 'FAKT' | 'OBLICZENIE' | 'WNIOSEK' }): ReactNode {
  const c = kind === 'FAKT' ? 'F' : kind === 'OBLICZENIE' ? 'O' : 'W';
  return <span className={`tag ${c}`}>{kind}</span>;
}

export const fmtAmount = (n: number) => n.toLocaleString('pl-PL', { maximumFractionDigits: 6 });
