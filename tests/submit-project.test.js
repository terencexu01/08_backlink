import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProduct } from '../src/submit.js';

const config = {
  _projects: [
    { name: 'Tool1', url: 'https://t1.io', email: 't1@x.io', description: 'd1' },
    { name: 'Game', url: 'https://g.io', email: 'g@x.io', description: 'd2' },
  ],
  utm: { medium: 'directory', campaign: 'backlink' },
};

describe('resolveProduct', () => {
  it('returns the named project with utm_url attached', () => {
    const p = resolveProduct(config, 'Game', 'futuretools');
    assert.equal(p.name, 'Game');
    assert.equal(p.email, 'g@x.io');
    assert.match(p.utm_url, /utm_source=futuretools/);
    assert.match(p.utm_url, /^https:\/\/g\.io\?/);
  });

  it('falls back to first project when no name given', () => {
    const p = resolveProduct(config, undefined, 's');
    assert.equal(p.name, 'Tool1');
  });

  it('throws on unknown project name', () => {
    assert.throws(() => resolveProduct(config, 'Nope', 's'), /not found/);
  });
});
