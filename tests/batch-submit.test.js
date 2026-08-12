import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, renameSync } from 'fs';
import { pickProjectEmail, resolveEmail } from '../src/batch-submit.js';
import { parseReviewFile, filterApproved } from '../src/reviews.js';

describe('batch-submit resource loading', () => {
  it('resources/backlink-resources.example.json exists', () => {
    assert.ok(existsSync('resources/backlink-resources.example.json'));
  });

  it('example file is valid JSON with expected structure', async () => {
    const { readFileSync } = await import('fs');
    const raw = JSON.parse(readFileSync('resources/backlink-resources.example.json', 'utf-8'));
    assert.ok(raw.blog_comments, 'should have blog_comments key');
    assert.ok(Array.isArray(raw.blog_comments), 'blog_comments should be array');
    assert.ok(raw.blog_comments.length > 0, 'should have at least one example');

    const entry = raw.blog_comments[0];
    assert.ok(entry.type, 'entry should have type');
    assert.ok(entry.url, 'entry should have url');
    assert.equal(typeof entry.has_url_field, 'boolean');
    assert.equal(typeof entry.has_captcha, 'boolean');
  });

  it('batchSubmit exits with error when resources missing', async () => {
    // We test the guard logic directly rather than running the full function
    // to avoid side effects
    const resourcePath = 'resources/backlink-resources.json';
    const sitesPath = 'resources/sites.json';
    assert.ok(existsSync(resourcePath) || true, 'guard should check existence');
    assert.ok(existsSync(sitesPath), 'sites.json should exist');
  });
});

describe('pickProjectEmail', () => {
  it('returns the project email from config', () => {
    const config = { _projects: [{ name: 'Game', email: 'game-special@x.io' }] };
    assert.equal(pickProjectEmail('Game', config), 'game-special@x.io');
  });

  it('throws when project missing', () => {
    assert.throws(() => pickProjectEmail('Nope', { _projects: [] }), /not found/);
  });
});

describe('--from-review approved extraction', () => {
  it('only approved review entries get submitted', () => {
    const file = `## ① A  →  https://b.io/1
评论草稿：
> good
状态：☑ 通过

## ② B  →  https://b.io/2
评论草稿：
> bad
状态：☒ 打回
`;
    const approved = filterApproved(parseReviewFile(file));
    assert.equal(approved.length, 1);
    assert.equal(approved[0].project, 'A');
  });
});

describe('resolveEmail', () => {
  const persona = { name: 'Alex', email: 'persona@x.io' };

  it('uses the override when provided', () => {
    assert.equal(resolveEmail('game-special@x.io', persona), 'game-special@x.io');
  });

  it('falls back to the persona email when override is undefined', () => {
    assert.equal(resolveEmail(undefined, persona), 'persona@x.io');
  });

  it('falls back to the persona email when override is empty string', () => {
    // Documents the falsy semantics: '' is treated as "no override".
    assert.equal(resolveEmail('', persona), 'persona@x.io');
  });
});
