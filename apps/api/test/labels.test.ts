import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractAddresses } from '../src/core/addresses/extract.js';

const dir = join(__dirname, '..', 'data', 'labels');

describe('rejestr etykiet', () => {
  for (const f of readdirSync(dir)) {
    it(`${f}: każdy adres ma poprawną sumę kontrolną i zgodną sieć`, () => {
      const items = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { chain: string; address: string }[];
      for (const l of items) {
        const { found } = extractAddresses(l.address);
        expect(found, l.address).toHaveLength(1);
        expect(found[0].chain, l.address).toBe(l.chain);
      }
    });
  }
});
