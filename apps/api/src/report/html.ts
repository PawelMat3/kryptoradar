// Raport OSINT w HTML (do druku / PDF). Struktura zgodna z wymaganiami:
// fakty źródłowe, wyniki obliczeń, wnioski do weryfikacji, chronologia przepływów, metodologia
// i metadane potrzebne do odtworzenia analizy.
import { CATEGORY_BASE, CONTEXT_RULES, SYNERGY_BONUS, ONCHAIN_BONUS, TIERS } from '../core/scoring.js';

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TIER_PL: Record<string, string> = {
  BARDZO_WYSOKIE: 'bardzo wysokie',
  PRAWDOPODOBNE: 'prawdopodobne',
  SREDNIE: 'średnie',
  NISKIE: 'niskie',
  ZNIKOME: 'znikome',
  WYKLUCZONE: 'wykluczone',
};

export function renderReport(d: { kase: Row; run: Row; artifacts: Row[]; findings: Row[]; chain: Row[] }): string {
  const { kase, run, artifacts, findings, chain } = d;
  const ids = kase.identifiers ?? {};
  const concl: Row[] = run.conclusions ?? [];
  const attributed = findings.filter((f) => f.status === 'attributed').sort((a, b) => b.score - a.score);
  const excluded = findings.filter((f) => f.status === 'excluded');
  const section = (kind: string) =>
    concl
      .filter((c) => c.kind === kind)
      .map((c) => `<li>${esc(c.text)}</li>`)
      .join('') || '<li>—</li>';
  const flows = chain
    .flatMap((c) => (c.flows as Row[]).map((f): Row => ({ ...f, own: c.address })))
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));

  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Krypto Radar – ${esc(kase.name)} – #${run.seq}</title>
<style>
:root{--ink:#1d2330;--muted:#5b6474;--line:#d9dde4;--fact:#1f5fa8;--calc:#6b4fa0;--hyp:#a8611f;--bg:#fff}
*{box-sizing:border-box}body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);max-width:1000px;margin:0 auto;padding:32px 24px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px;border-bottom:2px solid var(--ink);padding-bottom:4px}h3{font-size:15px;margin:18px 0 6px}
.muted{color:var(--muted)}table{width:100%;border-collapse:collapse;margin:8px 0;font-size:12.5px}th,td{border:1px solid var(--line);padding:5px 7px;text-align:left;vertical-align:top}th{background:#f3f5f8}
code{font:12px ui-monospace,Consolas,monospace;word-break:break-all}.k{display:inline-block;padding:1px 7px;border-radius:3px;font-size:11px;font-weight:600;color:#fff}
.F{background:var(--fact)}.O{background:var(--calc)}.W{background:var(--hyp)}ul.c li{margin:4px 0}.legend{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0}
.box{border:1px solid var(--line);padding:10px 14px;margin:10px 0;border-radius:4px}.score{font-size:20px;font-weight:700}
@media print{body{padding:0}h2{break-after:avoid}table{break-inside:auto}}
</style></head><body>
<h1>Krypto Radar – raport</h1>
<div class="muted"><b>${esc(kase.name)}</b> · przebieg #${run.seq} · ${esc(run.mode)} · ${esc(run.started_at)} – ${esc(run.finished_at)} · <code>${esc(run.id)}</code></div>
${run.mode === 'demo' ? '<p class="box">Dane syntetyczne.</p>' : ''}

<h2>1. Legenda</h2>
<div class="legend"><span><span class="k F">FAKT</span> ze źródła</span><span><span class="k O">OBLICZENIE</span> wynik algorytmu</span><span><span class="k W">WNIOSEK</span> do weryfikacji</span></div>

<h2>2. Dane wejściowe</h2>
<table><tr><th>Imię i nazwisko</th><td>${esc(ids.fullName || '—')}</td></tr><tr><th>Nicki / loginy</th><td>${esc((ids.usernames ?? []).join(', ') || '—')}</td></tr>
<tr><th>E-mail</th><td>${esc((ids.emails ?? []).join(', ') || '—')}</td></tr><tr><th>Komunikatory</th><td>${esc((ids.messengers ?? []).join(', ') || '—')}</td></tr>
<tr><th>URL profili</th><td>${esc((ids.profileUrls ?? []).join(', ') || '—')}</td></tr><tr><th>Adresy krypto</th><td>${esc((ids.addresses ?? []).join(', ') || '—')}</td></tr></table>

<h2>3. Podsumowanie</h2>
<div class="box">Zarchiwizowane źródła: <b>${run.summary?.sources ?? 0}</b> · Adresy wykryte: <b>${run.summary?.addresses ?? 0}</b> · Przypisane: <b>${run.summary?.attributed ?? 0}</b> (≥80%: <b>${run.summary?.high ?? 0}</b>) · Wykluczone: <b>${run.summary?.excluded ?? 0}</b> · Adresy z wysokim poziomem wskaźników cash-out: <b>${run.summary?.cashOutHigh ?? 0}</b>${run.summary?.diffSummary ? `<br>Zmiany względem poprzedniego przebiegu: <b>${esc(run.summary.diffSummary)}</b>` : ''}</div>
${run.ai_summary ? `<div class="box"><b>Streszczenie wygenerowane przez AI (pomocnicze – wymaga weryfikacji):</b><br>${esc(run.ai_summary)}</div>` : ''}

<h2>4. Adresy przypisane</h2>
${
  attributed
    .map(
      (f) => `<div class="box"><div><span class="score">${f.score}%</span> · ${esc(TIER_PL[f.tier] ?? f.tier)} · ${esc(f.chain)} <code>${esc(f.address)}</code></div>
<div class="muted">Walidacja: ${esc(f.validation)} · Format: ${esc(f.format)}</div>
<h3>Uzasadnienie wyniku (reguły punktacji)</h3><table><tr><th>Reguła</th><th>Opis</th><th>Wartość</th></tr>${(f.hits as Row[]).map((h) => `<tr><td><code>${esc(h.rule)}</code></td><td>${esc(h.description)}</td><td>${h.kind === 'factor' ? '×' + Number(h.value).toFixed(2) : h.kind === 'add' ? (h.value > 0 ? '+' : '') + h.value : esc(h.value)}</td></tr>`).join('')}</table>
<h3>Wystąpienia w źródłach</h3><table><tr><th>Źródło</th><th>Kontekst</th><th>Pewność tożsamości</th><th>Wynik</th></tr>${(f.occurrences as Row[]).map((o) => `<tr><td>${esc(o.sourceName)}<br><code>${esc(o.url)}</code><br><span class="muted">${esc(o.retrievedAt)}${o.author ? ' · autor: ' + esc(o.author) : ''}</span></td><td>${esc(o.context)}</td><td>${Number(o.identity?.factor ?? 0).toFixed(2)}</td><td>${o.score}%</td></tr>`).join('')}</table></div>`,
    )
    .join('') || '<p>Brak.</p>'
}

<h2>5. Odrzucone</h2>
<table><tr><th>Adres</th><th>Powód</th><th>Reguła i dowód</th></tr>${excluded.map((f) => `<tr><td>${esc(f.chain)} <code>${esc(f.address)}</code></td><td>${esc(f.exclusion?.reason)}</td><td><code>${esc(f.exclusion?.rule)}</code><br>${esc(f.exclusion?.evidence)}</td></tr>`).join('') || '<tr><td colspan="3">Brak</td></tr>'}</table>
${
  (run.summary?.otherAuthorAddresses ?? []).length
    ? `<h3>Adresy innych autorów w tych samych wątkach (nieprzypisane)</h3><table><tr><th>Adres</th><th>Autor</th><th>Źródło</th></tr>${(run.summary.otherAuthorAddresses as Row[]).map((o) => `<tr><td><code>${esc(o.address)}</code></td><td>${esc(o.author)}</td><td><code>${esc(o.url)}</code></td></tr>`).join('')}</table>`
    : ''
}
${
  (run.summary?.rejectedCandidates ?? []).length
    ? `<h3>Ciągi odrzucone przez walidację sumy kontrolnej</h3><table><tr><th>Ciąg</th><th>Powód</th><th>Źródło</th></tr>${(run.summary.rejectedCandidates as Row[]).map((o) => `<tr><td><code>${esc(o.raw)}</code></td><td>${esc(o.reason)}</td><td><code>${esc(o.url)}</code></td></tr>`).join('')}</table>`
    : ''
}

<h2>6. Blockchain i cash-out</h2>
${chain
  .map(
    (c) => `<div class="box"><b>${esc(c.chain)}</b> <code>${esc(c.address)}</code> · poziom wskaźników cash-out: <b>${esc(c.cash_out_level)}</b> · dostawca: ${esc(c.provider)} · pobrano ${esc(c.retrieved_at)}
<table><tr><th>Transakcje</th><td>${c.metrics.txCount}</td><th>Okres</th><td>${esc(c.metrics.firstSeen?.slice(0, 10))} – ${esc(c.metrics.lastSeen?.slice(0, 10))}</td></tr>
<tr><th>Wpływy</th><td>${esc(Object.entries(c.metrics.inflow).map(([a, v]) => `${v} ${a}`).join(', ') || '—')}</td><th>Wypływy</th><td>${esc(Object.entries(c.metrics.outflow).map(([a, v]) => `${v} ${a}`).join(', ') || '—')}</td></tr></table>
${(c.indicators as Row[]).map((i) => `<p><span class="k ${i.severity === 'high' ? 'W' : 'O'}">${esc(i.id)}</span> <b>${esc(i.title)}</b> – ${esc(i.explanation)}</p>`).join('')}</div>`,
  )
  .join('') || '<p>Brak adresów do analizy on-chain.</p>'}

<h3>Chronologiczny opis przepływu środków</h3>
<table><tr><th>Data</th><th>Adres osoby</th><th>Kierunek</th><th>Kwota</th><th>Kontrahent</th><th>Tx</th></tr>${flows
    .map(
      (f) =>
        `<tr><td>${esc(String(f.time).replace('T', ' ').slice(0, 16))}</td><td><code>${esc(String(f.own).slice(0, 12))}…</code></td><td>${f.direction === 'in' ? 'wpływ' : f.direction === 'out' ? 'wypływ' : 'własny'}</td><td>${esc(f.amount)} ${esc(f.asset)}</td><td>${f.counterpartyLabel ? `<b>${esc(f.counterpartyLabel)}</b><br>` : ''}<code>${esc(f.counterparty ?? '—')}</code></td><td><code>${esc(String(f.hash).slice(0, 14))}…</code></td></tr>`,
    )
    .join('') || '<tr><td colspan="6">Brak</td></tr>'}</table>

<h2>7. Fakty, obliczenia i wnioski</h2>
<h3><span class="k F">FAKT</span> Fakty źródłowe</h3><ul class="c">${section('FAKT')}</ul>
<h3><span class="k O">OBLICZENIE</span> Wyniki obliczeń</h3><ul class="c">${section('OBLICZENIE')}</ul>
<h3><span class="k W">WNIOSEK</span> Wnioski wymagające weryfikacji</h3><ul class="c">${section('WNIOSEK')}</ul>

<h2>8. Źródła</h2>
<table><tr><th>#</th><th>Źródło / URL</th><th>Kategoria</th><th>Jak odkryto</th><th>Pobrano</th><th>HTTP</th><th>SHA-256</th><th>Tożsamość T</th></tr>${artifacts
    .map(
      (a, i) =>
        `<tr><td>${i + 1}</td><td>${esc(a.source_name)}<br><code>${esc(a.final_url)}</code></td><td>${esc(a.category)}</td><td>${esc(a.discovery)}<br><span class="muted">${esc(a.discovered_via)}</span></td><td>${esc(a.retrieved_at)}</td><td>${esc(a.http_status)}</td><td><code>${esc(a.content_sha256)}</code></td><td>${Number(a.identity?.factor ?? 0).toFixed(2)}</td></tr>`,
    )
    .join('')}</table>

<h2>9. Metodologia</h2>
<p><code>wynik = min(100, max(clamp(baza + kontekst, 0, 100) × T) + ${SYNERGY_BONUS} [≥2 niezależne źródła] + ${ONCHAIN_BONUS} [przepływ on-chain z adresem ≥80%])</code>. Giełda, kontrakt, mikser, zbiórka → 0%.</p>
<table><tr><th>Kategoria źródła</th><th>Baza</th></tr>${Object.entries(CATEGORY_BASE).map(([k, v]) => `<tr><td><code>${k}</code> ${esc(v.label)}</td><td>${v.base}</td></tr>`).join('')}</table>
<table><tr><th>Modyfikator kontekstu</th><th>Zmiana</th></tr>${CONTEXT_RULES.map((r) => `<tr><td><code>${r.id}</code> ${esc(r.description)}</td><td>${r.delta > 0 ? '+' : ''}${r.delta}</td></tr>`).join('')}<tr><td><code>CTX_QUOTED</code> Adres w cytacie</td><td>-20</td></tr></table>
<table><tr><th>Przedział</th></tr>${TIERS.map((t) => `<tr><td>${esc(t.label)}</td></tr>`).join('')}<tr><td>0% – wykluczenie</td></tr></table>

<h2>10. Odtwarzalność</h2>
<table><tr><th>Wersje</th><td><code>${esc(JSON.stringify(run.versions))}</code></td></tr><tr><th>Parametry</th><td><code>${esc(JSON.stringify(run.params))}</code></td></tr></table>
<h3>Dziennik zapytań sieciowych (${(run.request_log ?? []).length})</h3>
<table><tr><th>Czas</th><th>URL</th><th>Status</th><th>ms</th></tr>${(run.request_log as Row[]).map((r) => `<tr><td>${esc(r.at)}</td><td><code>${esc(r.url)}</code></td><td>${esc(r.status)}</td><td>${esc(r.ms)}</td></tr>`).join('')}</table>
<p class="muted">Krypto Radar ${esc(run.versions?.app)} · ${new Date().toISOString()}</p>
</body></html>`;
}
