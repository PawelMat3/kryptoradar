import { useEffect, useState } from 'react';
import { api, type Case, type Identifiers, type Meta } from './api';
import { RunView } from './RunView';
import { fmtDate, StatusTag } from './ui';

function useHashRoute(): string[] {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

export const go = (path: string) => {
  window.location.hash = '#/' + path;
};

export function App() {
  const route = useHashRoute();
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    api.meta().then(setMeta).catch(() => setMeta(null));
  }, []);

  let page;
  if (route[0] === 'new') page = <NewCase meta={meta} />;
  else if (route[0] === 'case' && route[1]) page = <CaseView id={route[1]} />;
  else if (route[0] === 'run' && route[1]) {
    const [rid, qs] = route[1].split('?');
    const p = new URLSearchParams(qs ?? '');
    page = <RunView key={route[1]} id={rid} against={p.get('against')} initialTab={p.get('tab')} />;
  } else if (route[0] === 'method') page = <Method meta={meta} />;
  else page = <CaseList />;

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/">
          Krypto Radar
        </a>
        <nav>
          <a href="#/" className={!route[0] || route[0] === 'case' || route[0] === 'run' ? 'active' : ''}>
            Sprawy
          </a>
          <a href="#/new" className={route[0] === 'new' ? 'active' : ''}>
            Nowa analiza
          </a>
          <a href="#/method" className={route[0] === 'method' ? 'active' : ''}>
            Metodologia
          </a>
        </nav>
        <div className="mode">
          {meta && !meta.worker?.ok && <span className="tag high">Maigret niedostępny</span>}
          {meta?.ai && <span>AI: {meta.ai}</span>}
        </div>
      </header>
      <main>{page}</main>
    </>
  );
}

const summarizeIds = (i: Identifiers) => [i.fullName, ...i.usernames, ...i.emails, ...i.messengers, ...i.addresses.map((a) => a.slice(0, 10) + '…')].filter(Boolean).join(', ');

function CaseList() {
  const [cases, setCases] = useState<Case[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const load = () => api.cases().then(setCases).catch((e: Error) => setErr(e.message));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <div className="row">
        <h1>Sprawy</h1>
        <div className="spacer" />
        <button className="primary" onClick={() => go('new')}>
          Nowa analiza
        </button>
      </div>
      {err && <div className="notice warn">{err}</div>}
      <div className="panel" style={{ marginTop: 16, padding: 0 }}>
        {!cases ? (
          <div className="empty">Wczytywanie…</div>
        ) : !cases.length ? (
          <div className="empty">Brak spraw.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Sprawa</th>
                <th>Identyfikatory</th>
                <th>Ostatni przebieg</th>
                <th>Wynik</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => go(`case/${c.id}`)}>
                  <td>
                    <b>{c.name}</b> <span className="tag">{c.mode}</span>
                  </td>
                  <td className="small">{summarizeIds(c.identifiers)}</td>
                  <td>
                    {c.last_run ? (
                      <>
                        #{c.last_run.seq} <StatusTag status={c.last_run.status} />
                        <div className="muted small">{fmtDate(c.last_run.started_at)}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="small">{c.last_run?.summary ? `${c.last_run.summary.attributed} adresów · maks. ${c.last_run.summary.maxScore}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

const DEMO: Identifiers = {
  fullName: 'Jan Testowy',
  usernames: ['kryptokowal77'],
  emails: ['jan.testowy@example.com'],
  messengers: [],
  profileUrls: [],
  addresses: [],
};

const lines = (s: string) =>
  s
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

function NewCase({ meta }: { meta: Meta | null }) {
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [name, setName] = useState('');
  const [fullName, setFullName] = useState('');
  const [usernames, setUsernames] = useState('');
  const [emails, setEmails] = useState('');
  const [messengers, setMessengers] = useState('');
  const [urls, setUrls] = useState('');
  const [addresses, setAddresses] = useState('');
  const [schedule, setSchedule] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const fillDemo = () => {
    setMode('demo');
    setName('Demo – Jan Testowy');
    setFullName(DEMO.fullName);
    setUsernames(DEMO.usernames.join('\n'));
    setEmails(DEMO.emails.join('\n'));
    setMessengers('');
    setUrls('');
    setAddresses('');
  };

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const identifiers: Identifiers = { fullName, usernames: lines(usernames), emails: lines(emails), messengers: lines(messengers), profileUrls: lines(urls), addresses: lines(addresses) };
      if (!fullName && !Object.values(identifiers).some((v) => Array.isArray(v) && v.length)) throw new Error('Podaj co najmniej jeden identyfikator.');
      const r = await api.createCase({ name: name || fullName || identifiers.usernames[0] || 'Sprawa', identifiers, scheduleMinutes: schedule ? Number(schedule) : null, mode });
      go(`run/${r.runId}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="row">
        <h1>Nowa analiza</h1>
        <div className="spacer" />
        <div className="segmented" role="radiogroup" aria-label="Tryb">
          <button role="radio" aria-checked={mode === 'demo'} className={mode === 'demo' ? 'on' : ''} onClick={() => setMode('demo')}>
            Demo
          </button>
          <button role="radio" aria-checked={mode === 'live'} className={mode === 'live' ? 'on' : ''} disabled={!meta?.liveEnabled} title={meta?.liveEnabled ? '' : 'RADAR_LIVE_ENABLED=false'} onClick={() => setMode('live')}>
            Live
          </button>
        </div>
        {mode === 'demo' && <button onClick={fillDemo}>Wypełnij danymi demo</button>}
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <label>Nazwa sprawy</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <div className="form-grid">
          <div>
            <label>Imię i nazwisko</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <label>Nicki</label>
            <textarea value={usernames} onChange={(e) => setUsernames(e.target.value)} />
            <label>E-mail</label>
            <textarea value={emails} onChange={(e) => setEmails(e.target.value)} />
          </div>
          <div>
            <label>Komunikatory</label>
            <textarea value={messengers} onChange={(e) => setMessengers(e.target.value)} placeholder="@handle" />
            <label>URL profili</label>
            <textarea value={urls} onChange={(e) => setUrls(e.target.value)} />
            <label>Adresy krypto</label>
            <textarea value={addresses} onChange={(e) => setAddresses(e.target.value)} />
          </div>
        </div>
        <label>Powtarzaj co (min)</label>
        <input style={{ maxWidth: 160 }} type="number" min={0} value={schedule} onChange={(e) => setSchedule(e.target.value)} />
        {err && <div className="notice warn">{err}</div>}
        <div className="row" style={{ marginTop: 16 }}>
          <button className="primary" disabled={busy} onClick={submit}>
            {busy ? 'Uruchamianie…' : 'Uruchom'}
          </button>
        </div>
      </div>
    </>
  );
}

function CaseView({ id }: { id: string }) {
  const [c, setC] = useState<Case | null>(null);
  const [err, setErr] = useState('');
  const [demoV, setDemoV] = useState<number | null>(null);
  const [sched, setSched] = useState('');
  const [cmp, setCmp] = useState<{ a: string; b: string }>({ a: '', b: '' });

  useEffect(() => {
    const load = () =>
      api
        .case(id)
        .then((x) => {
          setC(x);
          setSched((s) => s || (x.schedule_minutes ? String(x.schedule_minutes) : ''));
        })
        .catch((e: Error) => setErr(e.message));
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [id]);
  useEffect(() => {
    if (c?.mode === 'demo' && demoV === null) api.demoVersion().then((v) => setDemoV(v.version)).catch(() => undefined);
  }, [c, demoV]);

  if (err) return <div className="notice warn">{err}</div>;
  if (!c) return <div className="empty">Wczytywanie…</div>;
  const runs = c.runs ?? [];
  const done = runs.filter((r) => r.status === 'done');

  return (
    <>
      <div className="row">
        <div>
          <div className="muted small">
            <a href="#/">Sprawy</a> /
          </div>
          <h1>
            {c.name} <span className="tag">{c.mode}</span>
          </h1>
          <div className="muted small">{summarizeIds(c.identifiers)}</div>
        </div>
        <div className="spacer" />
        <button className="primary" onClick={() => api.startRun(id).then((r) => go(`run/${r.runId}`))}>
          Uruchom ponownie
        </button>
        <button
          onClick={() => {
            if (confirm('Usunąć sprawę i jej historię?')) api.deleteCase(id).then(() => go(''));
          }}
        >
          Usuń
        </button>
      </div>

      <div className="row" style={{ marginTop: 16, gap: 24 }}>
        <div className="row">
          <span className="small">Powtarzaj co</span>
          <input style={{ width: 90 }} type="number" min={0} value={sched} onChange={(e) => setSched(e.target.value)} />
          <span className="small">min</span>
          <button onClick={() => api.setSchedule(id, sched ? Number(sched) : null)}>Zapisz</button>
        </div>
        {c.mode === 'demo' && (
          <div className="row">
            <span className="small">Profil DevHub</span>
            <div className="segmented">
              {[1, 2].map((v) => (
                <button key={v} className={demoV === v ? 'on' : ''} onClick={() => api.setDemoVersion(v).then((r) => setDemoV(r.version))}>
                  v{v}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <h2>Przebiegi</h2>
      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Status</th>
              <th>Start</th>
              <th>Wynik</th>
              <th>Zmiany</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => go(`run/${r.id}`)}>
                <td>#{r.seq}</td>
                <td>
                  <StatusTag status={r.status} />
                </td>
                <td>
                  {fmtDate(r.started_at)}
                  {r.trigger === 'schedule' && <span className="muted small"> · harmonogram</span>}
                </td>
                <td className="small">{r.summary ? `${r.summary.attributed} przypisanych · ${r.summary.excluded} odrzuconych` : '—'}</td>
                <td className="small">{r.summary?.diffSummary ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {done.length >= 2 && (
        <div className="row" style={{ marginTop: 12 }}>
          <span className="small">Porównaj</span>
          <select style={{ width: 90 }} value={cmp.a} onChange={(e) => setCmp({ ...cmp, a: e.target.value })}>
            <option value="" />
            {done.map((r) => (
              <option key={r.id} value={r.id}>
                #{r.seq}
              </option>
            ))}
          </select>
          <span>→</span>
          <select style={{ width: 90 }} value={cmp.b} onChange={(e) => setCmp({ ...cmp, b: e.target.value })}>
            <option value="" />
            {done.map((r) => (
              <option key={r.id} value={r.id}>
                #{r.seq}
              </option>
            ))}
          </select>
          <button disabled={!cmp.a || !cmp.b || cmp.a === cmp.b} onClick={() => go(`run/${cmp.b}?against=${cmp.a}`)}>
            Porównaj
          </button>
        </div>
      )}
    </>
  );
}

interface Scoring {
  categories: Record<string, { base: number; label: string }>;
  contextRules: { id: string; description: string; delta: number }[];
  synergyBonus: number;
  onchainBonus: number;
}

function Method({ meta }: { meta: Meta | null }) {
  const s = (meta as (Meta & { scoring?: Scoring }) | null)?.scoring;
  return (
    <>
      <h1>Metodologia</h1>
      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="panel">
          <p className="mono small">
            wynik = min(100, max(clamp(baza + kontekst, 0, 100) × T) + {s?.synergyBonus ?? 15} synergia + {s?.onchainBonus ?? 10} on-chain)
            <br />
            giełda · kontrakt · mikser · zbiórka → 0%
          </p>
          <table className="rules">
            <tbody>
              {s &&
                Object.entries(s.categories).map(([k, v]) => (
                  <tr key={k}>
                    <td>{v.label}</td>
                    <td>{v.base}</td>
                  </tr>
                ))}
              {s?.contextRules.map((r) => (
                <tr key={r.id}>
                  <td>{r.description}</td>
                  <td>
                    {r.delta > 0 ? '+' : ''}
                    {r.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel small">
          <b>Źródła</b>
          <ul>
            {meta?.sources
              .filter((x) => !x.demo)
              .map((x) => (
                <li key={x.id}>{x.name}</li>
              ))}
          </ul>
          <b>Blockchain</b>
          <ul>
            {meta?.chainProviders.map((p) => (
              <li key={p.id}>
                {p.id} <span className="muted">({p.chains.join(', ')})</span>
              </li>
            ))}
          </ul>
          <b>Etykiety:</b> {meta?.labels.count}
          <br />
          <b>Dozwolone hosty:</b> <span className="mono">{meta?.egressAllowlist.join(', ')}</span>
        </div>
      </div>
    </>
  );
}
