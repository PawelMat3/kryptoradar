import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config, type Mode } from './config.js';
import { q } from './db/pool.js';
import { computeDiff, createRun, labels } from './pipeline/run.js';
import { renderReport } from './report/html.js';
import { SOURCES } from './connectors/sources.js';
import { providerCatalog } from './connectors/chain/providers.js';
import { CATEGORY_BASE, CONTEXT_RULES, SYNERGY_BONUS, ONCHAIN_BONUS, TIERS } from './core/scoring.js';
import { getLlm } from './ai/llm.js';
import { extractAddresses } from './core/addresses/extract.js';

const Identifiers = z.object({
  fullName: z.string().max(200).optional().default(''),
  usernames: z.array(z.string().max(100)).max(20).default([]),
  emails: z.array(z.string().max(200)).max(20).default([]),
  messengers: z.array(z.string().max(100)).max(20).default([]),
  profileUrls: z.array(z.string().url().max(500)).max(30).default([]),
  addresses: z.array(z.string().max(120)).max(30).default([]),
});

const CaseBody = z.object({
  name: z.string().min(1).max(200),
  identifiers: Identifiers,
  scheduleMinutes: z.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
  mode: z.enum(['demo', 'live']).default('demo'),
});

const RUN_LIST_COLS = 'id, seq, trigger, status, mode, started_at, finished_at, summary, error';

export async function routes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true, liveEnabled: config.liveEnabled, version: config.version }));

  app.get('/api/meta', async () => {
    let worker: unknown = null;
    try {
      worker = await (await fetch(`${config.workerUrl}/health`, { signal: AbortSignal.timeout(3000) })).json();
    } catch {
      worker = { ok: false };
    }
    return {
      liveEnabled: config.liveEnabled,
      version: config.version,
      worker,
      sources: SOURCES.map((s) => ({ id: s.id, name: s.name, category: s.category, demo: !!s.demo })),
      chainProviders: providerCatalog(),
      labels: { count: labels.size, files: labels.files },
      egressAllowlist: config.egressAllowlist,
      ai: getLlm()?.id ?? null,
      scoring: { categories: CATEGORY_BASE, contextRules: CONTEXT_RULES.map((r) => ({ id: r.id, description: r.description, delta: r.delta })), synergyBonus: SYNERGY_BONUS, onchainBonus: ONCHAIN_BONUS, tiers: TIERS },
    };
  });

  /** Narzędzie pomocnicze: ekstrakcja adresów z wklejonego tekstu (bez zapisu). */
  app.post('/api/extract', async (req) => {
    const { text } = z.object({ text: z.string().max(200_000) }).parse(req.body);
    return extractAddresses(text);
  });

  app.get('/api/cases', async () =>
    q(`SELECT c.*, (SELECT row_to_json(r) FROM (SELECT ${RUN_LIST_COLS} FROM runs WHERE case_id=c.id ORDER BY seq DESC LIMIT 1) r) AS last_run,
       (SELECT count(*)::int FROM runs WHERE case_id=c.id) AS run_count FROM cases c ORDER BY created_at DESC`),
  );

  app.post('/api/cases', async (req, reply) => {
    const b = CaseBody.parse(req.body);
    if (b.mode === 'live' && !config.liveEnabled) return reply.code(400).send({ error: 'Tryb live jest wyłączony (RADAR_LIVE_ENABLED)' });
    const [c] = await q<{ id: string }>('INSERT INTO cases(name, identifiers, schedule_minutes, mode) VALUES ($1,$2,$3,$4) RETURNING id', [
      b.name,
      JSON.stringify(b.identifiers),
      b.scheduleMinutes ?? null,
      b.mode,
    ]);
    const runId = await createRun(c.id, b.mode, 'manual');
    reply.code(201);
    return { id: c.id, runId };
  });

  app.get<{ Params: { id: string } }>('/api/cases/:id', async (req, reply) => {
    const [c] = await q('SELECT * FROM cases WHERE id=$1', [req.params.id]);
    if (!c) return reply.code(404).send({ error: 'Nie znaleziono sprawy' });
    const runs = await q(`SELECT ${RUN_LIST_COLS} FROM runs WHERE case_id=$1 ORDER BY seq DESC`, [req.params.id]);
    return { ...c, runs };
  });

  app.patch<{ Params: { id: string } }>('/api/cases/:id', async (req) => {
    const b = z.object({ scheduleMinutes: z.number().int().min(0).max(43200).nullable() }).parse(req.body);
    await q('UPDATE cases SET schedule_minutes=$2 WHERE id=$1', [req.params.id, b.scheduleMinutes || null]);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/cases/:id', async (req) => {
    await q('DELETE FROM cases WHERE id=$1', [req.params.id]);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/cases/:id/runs', async (req, reply) => {
    const [c] = await q<{ mode: Mode }>('SELECT mode FROM cases WHERE id=$1', [req.params.id]);
    if (!c) return reply.code(404).send({ error: 'Nie znaleziono sprawy' });
    if (c.mode === 'live' && !config.liveEnabled) return reply.code(400).send({ error: 'Tryb live jest wyłączony (RADAR_LIVE_ENABLED)' });
    const runId = await createRun(req.params.id, c.mode, 'manual');
    reply.code(201);
    return { runId };
  });

  async function loadRun(id: string) {
    const [run] = await q<Record<string, any>>('SELECT * FROM runs WHERE id=$1', [id]); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!run) return null;
    const [kase] = await q('SELECT * FROM cases WHERE id=$1', [run.case_id]);
    const artifacts = await q(
      'SELECT id, url, final_url, source_id, source_name, category, discovery, discovered_via, retrieved_at, http_status, content_type, content_sha256, bytes, adapter, title, identity, meta FROM artifacts WHERE run_id=$1 ORDER BY retrieved_at',
      [id],
    );
    const findings = await q('SELECT * FROM findings WHERE run_id=$1 ORDER BY score DESC, address', [id]);
    const chain = await q('SELECT * FROM chain_reports WHERE run_id=$1', [id]);
    return { kase, run, artifacts, findings, chain };
  }

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const d = await loadRun(req.params.id);
    if (!d) return reply.code(404).send({ error: 'Nie znaleziono przebiegu' });
    return d;
  });

  app.get<{ Params: { id: string }; Querystring: { against: string } }>('/api/runs/:id/diff', async (req) => computeDiff(req.query.against, req.params.id));

  app.get<{ Params: { id: string } }>('/api/runs/:id/report.html', async (req, reply) => {
    const d = await loadRun(req.params.id);
    if (!d) return reply.code(404).send('Nie znaleziono');
    reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'");
    return reply.type('text/html; charset=utf-8').send(renderReport(d as never));
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/export.json', async (req, reply) => {
    const d = await loadRun(req.params.id);
    if (!d) return reply.code(404).send({ error: 'Nie znaleziono' });
    reply.header('content-disposition', `attachment; filename="krypto-radar-run-${req.params.id}.json"`);
    return d;
  });

  /** Zarchiwizowana kopia źródła – wyświetlana jako tekst (bez wykonywania skryptów). */
  app.get<{ Params: { id: string } }>('/api/artifacts/:id/snapshot', async (req, reply) => {
    const [a] = await q<{ raw: string; final_url: string; retrieved_at: string; content_sha256: string }>('SELECT raw, final_url, retrieved_at, content_sha256 FROM artifacts WHERE id=$1', [req.params.id]);
    if (!a) return reply.code(404).send('Nie znaleziono');
    reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    reply.header('x-source-url', a.final_url);
    reply.header('x-source-sha256', a.content_sha256);
    return reply.type('text/html; charset=utf-8').send(
      `<!doctype html><meta charset="utf-8"><div style="font:12px system-ui;background:#fff6d6;border:1px solid #e0c060;padding:8px;margin-bottom:12px">Kopia archiwalna · źródło: ${a.final_url.replace(/</g, '&lt;')} · pobrano: ${a.retrieved_at} · SHA-256: ${a.content_sha256}</div>${a.raw}`,
    );
  });

  /** Tylko demo: przełącza wersję syntetycznego profilu, żeby pokazać wykrycie podmiany adresu. */
  app.post('/api/demo/profile-version', async (req, reply) => {
    const { version } = z.object({ version: z.number().int().min(1).max(2) }).parse(req.body);
    const r = await fetch(`${config.mockAdminUrl}/__admin/version`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version }) });
    return r.json();
  });
  app.get('/api/demo/profile-version', async (_req, reply) => {
    return (await fetch(`${config.mockAdminUrl}/__admin/version`)).json();
  });
}
