import { Fragment, useEffect, useState } from 'react';
import { api, type Finding, type RunDetail, type RunDiff } from './api';
import { Addr, fmtAmount, fmtDate, Highlight, Kind, ScoreBar, StatusTag, TIER_LABEL } from './ui';
import { Graph } from './Graph';

type Tab = 'steps' | 'addresses' | 'graph' | 'chain' | 'sources' | 'excluded' | 'diff' | 'conclusions' | 'log';

const DISCOVERY: Record<string, string> = {
  analyst: 'wskazane przez analityka',
  maigret: 'Maigret (nick)',
  crosslink: 'link z innego profilu',
  pivot: 'strona powiązana',
  search: 'wyszukiwarka',
};

export function RunView({ id, against, initialTab }: { id: string; against: string | null; initialTab?: string | null }) {
  const [d, setD] = useState<RunDetail | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab | null>((initialTab as Tab) ?? null);
  const [cmp, setCmp] = useState<RunDiff | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const x = await api.run(id);
        if (stop) return;
        setD(x);
        if (x.run.status === 'queued' || x.run.status === 'running') timer = setTimeout(load, 1200);
      } catch (e) {
        setErr((e as Error).message);
      }
    };
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);
  useEffect(() => {
    if (against) api.diff(id, against).then(setCmp).catch(() => setCmp(null));
  }, [id, against]);

  if (err) return <div className="notice warn">{err}</div>;
  if (!d) return <div className="empty">Wczytywanie…</div>;

  const { run, kase, findings, artifacts, chain } = d;
  const finished = run.status === 'done';
  const active: Tab = tab ?? (against ? 'diff' : finished ? 'addresses' : 'steps');
  const attributed = findings.filter((f) => f.status !== 'excluded');
  const excluded = findings.filter((f) => f.status === 'excluded');
  const diff = cmp ?? run.diff;
  const s = run.summary;

  const tabs: [Tab, string, number | null][] = [
    ['steps', 'Przebieg', run.steps?.length ?? 0],
    ['addresses', 'Adresy', attributed.length],
    ['graph', 'Graf', null],
    ['chain', 'Blockchain', chain.length],
    ['sources', 'Źródła', artifacts.length],
    ['excluded', 'Odrzucone', excluded.length + (s?.otherAuthorAddresses?.length ?? 0) + (s?.rejectedCandidates?.length ?? 0)],
    ['diff', 'Zmiany', diff ? diff.addressSwaps.length + diff.newAddresses.length + diff.removedAddresses.length : null],
    ['conclusions', 'Wnioski', run.conclusions?.length ?? 0],
    ['log', 'Log', run.request_log?.length ?? 0],
  ];

  return (
    <>
      <div className="row">
        <div>
          <div className="muted small">
            <a href="#/">Sprawy</a> / <a href={`#/case/${kase.id}`}>{kase.name}</a> /
          </div>
          <h1>
            Przebieg #{run.seq} <StatusTag status={run.status} />
          </h1>
          <div className="muted small">
            {fmtDate(run.started_at)} → {fmtDate(run.finished_at)} · {run.mode}
          </div>
        </div>
        <div className="spacer" />
        {finished && (
          <>
            <a className="btn primary" href={`/api/runs/${id}/report.html`} target="_blank" rel="noreferrer">
              Raport (HTML / PDF)
            </a>
            <a className="btn" href={`/api/runs/${id}/export.json`}>
              Eksport JSON
            </a>
          </>
        )}
      </div>

      {run.status === 'error' && <div className="notice warn error-box">{run.error}</div>}

      {s && (
        <div className="stats" style={{ marginTop: 16 }}>
          <div className="stat">
            <div className="v">{s.sources}</div>
            <div className="l">źródeł</div>
          </div>
          <div className="stat">
            <div className="v">{s.addresses}</div>
            <div className="l">adresów</div>
          </div>
          <div className="stat">
            <div className="v">{s.high}</div>
            <div className="l">pewność ≥80%</div>
          </div>
          <div className="stat">
            <div className="v">{s.excluded}</div>
            <div className="l">odrzuconych</div>
          </div>
          <div className="stat">
            <div className="v">{s.cashOutHigh}</div>
            <div className="l">cash-out: wysoki</div>
          </div>
        </div>
      )}
      {run.ai_summary && (
        <div className="notice">
          <b>AI</b> <span className="muted small">do weryfikacji</span>
          <div>{run.ai_summary}</div>
        </div>
      )}

      <div className="tabs" role="tablist">
        {tabs.map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={active === k} className={active === k ? 'active' : ''} onClick={() => setTab(k)}>
            {label}
            {n !== null && <span className="count">{n}</span>}
          </button>
        ))}
      </div>

      {active === 'steps' && (
        <div className="panel">
          <ul className="steps">
            {(run.steps ?? []).map((st) => (
              <li key={st.id} className={st.status}>
                <span className="dot" />
                <div>
                  <b>{st.title}</b>
                  {st.detail && <div className="small muted">{st.detail}</div>}
                </div>
                <span className="small muted">{st.finishedAt ? `${((Date.parse(st.finishedAt) - Date.parse(st.startedAt)) / 1000).toFixed(1)} s` : '…'}</span>
              </li>
            ))}
            {!run.steps?.length && <li className="muted">Oczekiwanie na rozpoczęcie…</li>}
          </ul>
        </div>
      )}

      {active === 'addresses' && <AddressTable findings={attributed} />}
      {active === 'graph' && <Graph d={d} />}

      {active === 'chain' && (
        <>
          {!chain.length && <div className="empty">Brak.</div>}
          {chain.map((c) => {
            const f = findings.find((x) => x.address.toLowerCase() === c.address.toLowerCase());
            return (
              <div className="panel" key={c.id}>
                <div className="row">
                  <b>{c.chain}</b> <Addr a={c.address} />
                  <div className="spacer" />
                  {f && <ScoreBar score={f.score} tier={f.tier} />}
                  <span className={`tag ${c.cash_out_level === 'wysoki' ? 'high' : c.cash_out_level === 'średni' ? 'medium' : ''}`}>cash-out: {c.cash_out_level}</span>
                </div>
                <div className="small muted">
                  {c.metrics.txCount} transakcji · {c.metrics.firstSeen?.slice(0, 10) ?? '—'} – {c.metrics.lastSeen?.slice(0, 10) ?? '—'} · kontrahentów: {c.metrics.uniqueCounterparties} · wpływy:{' '}
                  {Object.entries(c.metrics.inflow).map(([a, v]) => `${fmtAmount(v)} ${a}`).join(', ') || '—'} · wypływy: {Object.entries(c.metrics.outflow).map(([a, v]) => `${fmtAmount(v)} ${a}`).join(', ') || '—'} · źródło danych: {c.provider}
                </div>
                {c.indicators.map((i) => (
                  <div key={i.id} className="notice status" style={{ borderLeftColor: i.severity === 'high' ? 'var(--danger)' : i.severity === 'medium' ? 'var(--mid)' : 'var(--line)' }}>
                    <span className={`tag ${i.severity}`}>{i.id}</span> <b>{i.title}</b>
                    <div className="small">{i.explanation}</div>
                  </div>
                ))}
                <h3>Chronologia przepływów</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Kierunek</th>
                      <th>Kwota</th>
                      <th>Kontrahent</th>
                      <th>Transakcja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.flows.map((fl) => (
                      <tr key={fl.hash + fl.asset}>
                        <td className="small">{fl.time.replace('T', ' ').slice(0, 16)}</td>
                        <td>{fl.direction === 'in' ? '← wpływ' : fl.direction === 'out' ? '→ wypływ' : 'własny'}</td>
                        <td>
                          {fmtAmount(fl.amount)} {fl.asset}
                          {fl.method && <div className="small muted">{fl.method}</div>}
                        </td>
                        <td>
                          {fl.counterpartyLabel && <b>{fl.counterpartyLabel}</b>} {fl.counterparty && <div><Addr a={fl.counterparty} n={8} /></div>}
                        </td>
                        <td>
                          <Addr a={fl.hash} n={8} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </>
      )}

      {active === 'sources' && (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Źródło</th>
                <th>Kategoria</th>
                <th>Jak odkryto</th>
                <th>Tożsamość T</th>
                <th>Pobrano / SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {artifacts.map((a) => (
                <tr key={a.id}>
                  <td>
                    <b>{a.source_name}</b>
                    <div>
                      <a href={`/api/artifacts/${a.id}/snapshot`} target="_blank" rel="noreferrer" className="small">
                        {a.final_url}
                      </a>
                    </div>
                    {a.meta.declaredName && <div className="small muted">Deklarowane imię: {a.meta.declaredName}</div>}
                  </td>
                  <td className="small">{a.category}</td>
                  <td className="small">
                    {DISCOVERY[a.discovery] ?? a.discovery}
                    <div className="muted">{a.discovered_via}</div>
                  </td>
                  <td>
                    <b>{a.identity?.factor.toFixed(2)}</b>
                    <div className="small muted">{a.identity?.hits.map((h) => h.rule).join(', ')}</div>
                  </td>
                  <td className="small">
                    {fmtDate(a.retrieved_at)} · HTTP {a.http_status}
                    <div className="mono muted">{a.content_sha256.slice(0, 24)}…</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {active === 'excluded' && (
        <>
          <div className="panel" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Adres</th>
                  <th>Powód wykluczenia (0%)</th>
                  <th>Gdzie wspomniany</th>
                </tr>
              </thead>
              <tbody>
                {excluded.map((f) => (
                  <tr key={f.id}>
                    <td>
                      {f.chain} <Addr a={f.address} n={8} />
                    </td>
                    <td>
                      {f.exclusion?.reason}
                      <div className="small muted">
                        <code>{f.exclusion?.rule}</code> · dowód: {f.exclusion?.evidence}
                      </div>
                    </td>
                    <td className="small">{[...new Set(f.occurrences.map((o) => o.sourceName))].join(', ') || 'adres wejściowy'}</td>
                  </tr>
                ))}
                {!excluded.length && (
                  <tr>
                    <td colSpan={3} className="muted">
                      Brak
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!!s?.otherAuthorAddresses?.length && (
            <>
              <h2>Adresy innych autorów w tych samych wątkach (nieprzypisane)</h2>
              <div className="panel" style={{ padding: 0 }}>
                <table>
                  <tbody>
                    {s.otherAuthorAddresses.map((o, i) => (
                      <tr key={i}>
                        <td>
                          <Addr a={o.address} n={8} />
                        </td>
                        <td>autor: {o.author}</td>
                        <td className="small">{o.url}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!!s?.rejectedCandidates?.length && (
            <>
              <h2>Ciągi odrzucone przez walidację sumy kontrolnej</h2>
              <div className="panel" style={{ padding: 0 }}>
                <table>
                  <tbody>
                    {s.rejectedCandidates.map((o, i) => (
                      <tr key={i}>
                        <td>
                          <code>{o.raw}</code>
                        </td>
                        <td>{o.reason}</td>
                        <td className="small">{o.url}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {active === 'diff' &&
        (!diff ? (
          <div className="empty">Pierwszy przebieg.</div>
        ) : (
          <div className="panel">
            <div>
              <b>{diff.summary}</b>
              {cmp && <span className="muted small"> (porównanie wybranych przebiegów)</span>}
            </div>
            {diff.addressSwaps.map((sw) => (
              <div key={sw.url} className="notice warn">
                <b>Podmiana adresu na profilu</b> <span className="small">{sw.url}</span>
                <div className="small">
                  było: {sw.before.map((a) => <Addr key={a} a={a} />)} → jest: {sw.after.map((a) => <Addr key={a} a={a} />)}
                </div>
              </div>
            ))}
            <div className="grid2">
              <div>
                <h3>Nowe adresy</h3>
                {diff.newAddresses.map((f) => (
                  <div key={f.address}>
                    + {f.chain} <Addr a={f.address} n={8} /> ({f.score}%)
                  </div>
                ))}
                {!diff.newAddresses.length && <div className="muted">brak</div>}
              </div>
              <div>
                <h3>Adresy, które zniknęły</h3>
                {diff.removedAddresses.map((f) => (
                  <div key={f.address}>
                    − {f.chain} <Addr a={f.address} n={8} /> ({f.score}%)
                  </div>
                ))}
                {!diff.removedAddresses.length && <div className="muted">brak</div>}
              </div>
            </div>
            {!!diff.scoreChanges.length && (
              <>
                <h3>Zmiany Wskaźnika Pewności</h3>
                {diff.scoreChanges.map((c) => (
                  <div key={c.address}>
                    <Addr a={c.address} n={8} />: {c.before}% → {c.after}%
                  </div>
                ))}
              </>
            )}
          </div>
        ))}

      {active === 'conclusions' && (
        <div className="panel">
          {(['WNIOSEK', 'OBLICZENIE', 'FAKT'] as const).map((k) => (
            <Fragment key={k}>
              <h3>
                <Kind kind={k} />
              </h3>
              <ul className="small">
                {(run.conclusions ?? [])
                  .filter((c) => c.kind === k)
                  .map((c, i) => (
                    <li key={i} style={{ margin: '4px 0' }}>
                      {c.text}
                    </li>
                  ))}
              </ul>
            </Fragment>
          ))}
        </div>
      )}

      {active === 'log' && (
        <div className="grid2">
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Wersje i parametry</h3>
            <pre className="mono small" style={{ whiteSpace: 'pre-wrap' }}>
              {JSON.stringify({ versions: run.versions, params: run.params }, null, 2)}
            </pre>
          </div>
          <div className="panel" style={{ padding: 0, maxHeight: 600, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Czas</th>
                  <th>Zapytanie</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(run.request_log ?? []).map((r, i) => (
                  <tr key={i}>
                    <td className="small">{r.at.slice(11, 19)}</td>
                    <td className="mono">{r.url}</td>
                    <td className="small">
                      {String(r.status)} · {r.ms} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function AddressTable({ findings }: { findings: Finding[] }) {
  const [open, setOpen] = useState<string | null>(findings[0]?.id ?? null);
  if (!findings.length) return <div className="empty">Brak adresów.</div>;
  return (
    <div className="panel" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            <th>Wskaźnik Pewności</th>
            <th>Sieć</th>
            <th>Adres</th>
            <th>Źródła</th>
            <th>Poziom</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <Fragment key={f.id}>
              <tr className="clickable" onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id}>
                <td>
                  <ScoreBar score={f.score} tier={f.tier} />
                </td>
                <td>{f.chain}</td>
                <td>
                  <Addr a={f.address} />
                  <div className="small muted">
                    {f.format} · {f.validation}
                  </div>
                </td>
                <td className="small">{[...new Set(f.occurrences.map((o) => o.sourceName))].join(', ') || 'brak śladów Web2 (adres wejściowy)'}</td>
                <td className={`small t-${f.tier}`}>{TIER_LABEL[f.tier]}</td>
              </tr>
              {open === f.id && (
                <tr>
                  <td colSpan={5} className="detail">
                    <div className="grid2">
                      <div>
                        <h3 style={{ marginTop: 0 }}>Jak policzono wynik</h3>
                        <table className="rules">
                          <tbody>
                            {f.hits.map((h, i) => (
                              <tr key={i}>
                                <td>
                                  <code>{h.rule}</code> <span className="small">{h.description}</span>
                                </td>
                                <td>{h.kind === 'factor' ? `×${h.value.toFixed(2)}` : h.kind === 'add' ? `${h.value > 0 ? '+' : ''}${h.value}` : h.value}</td>
                              </tr>
                            ))}
                            <tr>
                              <td>
                                <b>Wynik</b>
                              </td>
                              <td>
                                <b>{f.score}%</b>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <h3 style={{ marginTop: 0 }}>Wystąpienia w źródłach ({f.occurrences.length})</h3>
                        {f.occurrences.map((o, i) => (
                          <div key={i} style={{ marginBottom: 10 }}>
                            <div className="row small">
                              <b>{o.sourceName}</b>
                              <span className="tag">{o.category}</span>
                              <span className="muted">wynik {o.score}% · T={o.identity.factor.toFixed(2)}</span>
                            </div>
                            <div className="ctx">
                              <Highlight text={o.context} term={f.address.slice(0, 12)} />
                            </div>
                            <div className="small muted">
                              <a href={`/api/artifacts/${o.artifactId}/snapshot`} target="_blank" rel="noreferrer">
                                kopia archiwalna
                              </a>{' '}
                              · {o.url}
                              {o.author ? ` · autor: ${o.author}` : ''} · {fmtDate(o.retrievedAt)}
                            </div>
                            <div className="small muted">Tożsamość: {o.identity.hits.map((h) => h.description).join('; ')}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
