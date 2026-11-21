#!/usr/bin/env node
// Testy akceptacyjne Krypto Radar (scenarios/demo-kowal.json).
// Wymaga działającego środowiska: docker compose up -d --build
// Uruchomienie: node scripts/acceptance.mjs [http://localhost:8080]
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? process.env.RADAR_URL ?? 'http://localhost:8080';
const scenario = JSON.parse(readFileSync(new URL('../scenarios/demo-kowal.json', import.meta.url), 'utf8'));

const call = async (path, init) => {
  const r = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json' } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
};
const waitRun = async (id) => {
  for (let i = 0; i < 240; i++) {
    const d = await call(`/api/runs/${id}`);
    if (d.run.status === 'done' || d.run.status === 'error') return d;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Przekroczono czas oczekiwania na przebieg');
};

let failed = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}${info ? ` – ${info}` : ''}`);
  if (!ok) failed++;
};
const find = (d, a) => d.findings.find((f) => f.address.toLowerCase() === a.toLowerCase());

console.log(`Krypto Radar – testy akceptacyjne (${BASE})\n`);
await call('/api/demo/profile-version', { method: 'POST', body: JSON.stringify({ version: 1 }) });
const { id: caseId, runId } = await call('/api/cases', { method: 'POST', body: JSON.stringify({ name: 'Test akceptacyjny', identifiers: scenario.input, mode: 'demo' }) });
const d1 = await waitRun(runId);
check('Przebieg #1 zakończony', d1.run.status === 'done', d1.run.error ?? '');

for (const e of scenario.expect.run1) {
  const f = find(d1, e.address);
  if (e.status === 'absent') {
    check(`[${e.id}] ${e.why}`, !f || f.status !== 'attributed', f ? `${f.status} ${f.score}%` : 'brak');
    continue;
  }
  // Reguła może dotyczyć wyniku adresu albo oceny tożsamości źródła (współczynnik T).
  const rules = f ? new Set([...f.hits.map((h) => h.rule), ...f.occurrences.flatMap((o) => o.identity.hits.map((h) => h.rule))]) : new Set();
  const ok = f && f.status === e.status && (e.min === undefined || f.score >= e.min) && (e.max === undefined || f.score <= e.max) && (!e.rules || e.rules.every((r) => rules.has(r)));
  check(`[${e.id}] ${e.why}`, !!ok, f ? `${f.status} ${f.score}% (${f.hits.map((h) => h.rule).join(', ')})` : 'nie znaleziono');
}
for (const e of scenario.expect.indicators) {
  const c = d1.chain.find((x) => x.address.toLowerCase() === e.address.toLowerCase());
  const ids = c?.indicators.map((i) => i.id) ?? [];
  check(`[${e.id}] ${e.why}`, e.indicators.every((i) => ids.includes(i)), ids.join(', ') || 'brak raportu');
}
const otherAuthors = d1.run.summary.otherAuthorAddresses.map((o) => o.address.toLowerCase());
check('[R1] Adresy innych autorów wątku nie są przypisane osobie', scenario.expect.otherAuthors.every((a) => otherAuthors.includes(a.toLowerCase())));
check('[R2] Adres z literówką odrzucony przez sumę kontrolną EIP-55', d1.run.summary.rejectedCandidates.some((r) => r.raw === scenario.expect.rejectedTypo));
check('[P1] Każde źródło ma URL, czas pobrania i SHA-256', d1.artifacts.every((a) => a.final_url && a.retrieved_at && /^[0-9a-f]{64}$/.test(a.content_sha256)));
check('[P2] Zapisano dziennik zapytań i wersje narzędzi', d1.run.request_log.length > 0 && d1.run.versions.app && d1.run.versions.maigret);
check('[P3] Raport rozróżnia fakty, obliczenia i wnioski', ['FAKT', 'OBLICZENIE', 'WNIOSEK'].every((k) => d1.run.conclusions.some((c) => c.kind === k)));
const html = await (await fetch(`${BASE}/api/runs/${runId}/report.html`)).text();
check('[P4] Raport HTML generuje się', html.includes('Krypto Radar') && html.includes('Metodologia'));

// Przebieg 2: podmiana adresu na profilu DevHub
await call('/api/demo/profile-version', { method: 'POST', body: JSON.stringify({ version: 2 }) });
const { runId: run2 } = await call(`/api/cases/${caseId}/runs`, { method: 'POST', body: '{}' });
const d2 = await waitRun(run2);
check('Przebieg #2 zakończony', d2.run.status === 'done', d2.run.error ?? '');
const swap = d2.run.diff?.addressSwaps?.[0];
check('[T1] Wykryto podmianę adresu na profilu między przebiegami', !!swap && swap.after.some((a) => a.toLowerCase() === scenario.expect.swap.after.toLowerCase()), JSON.stringify(swap ?? null));
const n = find(d2, scenario.expect.swap.after);
check('[T2] Nowy adres dostaje premię za przepływ on-chain z adresem osoby', !!n && n.hits.some((h) => h.rule === 'ONCHAIN_LINK'), n ? `${n.score}%` : 'brak');
await call('/api/demo/profile-version', { method: 'POST', body: JSON.stringify({ version: 1 }) });

console.log(`\n${failed ? `NIEZALICZONE: ${failed}` : 'Wszystkie scenariusze zaliczone.'}`);
process.exit(failed ? 1 : 0);
