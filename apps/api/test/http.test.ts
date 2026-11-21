import { describe, expect, it } from 'vitest';
import { isPrivateIp } from '../src/connectors/http.js';

describe('ochrona SSRF w trybie otwartej sieci', () => {
  it('blokuje adresy prywatne, pętlę zwrotną i metadane chmury', () => {
    for (const ip of ['10.0.0.5', '127.0.0.1', '172.20.0.3', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.1.2.3']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it('przepuszcza adresy publiczne', () => {
    for (const ip of ['140.82.112.3', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) expect(isPrivateIp(ip), ip).toBe(false);
  });
});
