import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

export async function migrate(): Promise<void> {
  // Migracje SQL leżą obok kodu źródłowego (src/db/migrations); w obrazie Docker kopiowane do dist.
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, 'migrations');
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (e) {
      if (attempt >= 30) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  const done = new Set((await q<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    await pool.query(readFileSync(join(dir, f), 'utf8'));
    await pool.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
  }
}
