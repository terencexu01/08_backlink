import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECTORY_INTERVAL_DAYS,
  BLOG_INTERVAL_DAYS,
  BLOG_MAX_PROJECTS,
  getDirectoryCandidates,
  getBlogCandidates,
} from '../src/scheduler.js';

const NOW = new Date();
const DAY = 24 * 60 * 60 * 1000;
const iso = d => new Date(d).toISOString();

describe('constants', () => {
  it('matches spec §4 intervals', () => {
    assert.equal(DIRECTORY_INTERVAL_DAYS, 5);
    assert.equal(BLOG_INTERVAL_DAYS, 3);
    assert.equal(BLOG_MAX_PROJECTS, 3);
  });
});

describe('getDirectoryCandidates', () => {
  it('excludes sites the project already submitted to', () => {
    const tracker = { submissions: [
      { project: 'Tool1', site: 's1', status: 'submitted', timestamp: iso(NOW) },
    ] };
    const out = getDirectoryCandidates('Tool1', ['s1', 's2', 's3'], tracker);
    assert.deepEqual(out, ['s2', 's3']);
  });

  it('excludes sites submitted by ANY project within the interval', () => {
    const tracker = { submissions: [
      // Tool2 submitted s4 two days ago — still inside 5-day window
      { project: 'Tool2', site: 's4', status: 'submitted', timestamp: iso(NOW - 2 * DAY) },
    ] };
    const out = getDirectoryCandidates('Tool1', ['s4', 's5'], tracker);
    assert.deepEqual(out, ['s5']);
  });

  it('allows a site last submitted outside the interval', () => {
    const tracker = { submissions: [
      { project: 'Tool2', site: 's6', status: 'submitted', timestamp: iso(NOW - 6 * DAY) },
    ] };
    const out = getDirectoryCandidates('Tool1', ['s6'], tracker);
    assert.deepEqual(out, ['s6']);
  });

  it('respects the limit option', () => {
    const out = getDirectoryCandidates('Tool1', ['a', 'b', 'c', 'd'], { submissions: [] }, { limit: 2 });
    assert.deepEqual(out, ['a', 'b']);
  });

  it('accepts {name} objects as sites', () => {
    const out = getDirectoryCandidates('Tool1', [{ name: 'obj' }], { submissions: [] });
    assert.deepEqual(out, ['obj']);
  });
});

describe('getBlogCandidates', () => {
  it('excludes blogs where this project already commented', () => {
    const tracker = { submissions: [
      { site: 'b1', type: 'blog_comment', project: 'Tool1', timestamp: iso(NOW) },
    ] };
    const out = getBlogCandidates('Tool1', [{ url: 'b1' }, { url: 'b2' }], tracker);
    assert.deepEqual(out.map(b => b.url), ['b2']);
  });

  it('excludes blogs already at max projects (3)', () => {
    const tracker = { submissions: [
      { site: 'b1', type: 'blog_comment', project: 'T1', timestamp: iso(NOW - 10 * DAY) },
      { site: 'b1', type: 'blog_comment', project: 'T2', timestamp: iso(NOW - 7 * DAY) },
      { site: 'b1', type: 'blog_comment', project: 'T3', timestamp: iso(NOW - 4 * DAY) },
    ] };
    const out = getBlogCandidates('Tool4', [{ url: 'b1' }], tracker);
    assert.deepEqual(out, []);
  });

  it('excludes blogs commented within the 3-day interval', () => {
    const tracker = { submissions: [
      { site: 'b1', type: 'blog_comment', project: 'T1', timestamp: iso(NOW - 1 * DAY) },
    ] };
    const out = getBlogCandidates('Tool2', [{ url: 'b1' }], tracker);
    assert.deepEqual(out, []); // last comment 1 day ago < 3 days
  });

  it('allows a blog with room and outside interval', () => {
    const tracker = { submissions: [
      { site: 'b1', type: 'blog_comment', project: 'T1', timestamp: iso(NOW - 4 * DAY) },
    ] };
    const out = getBlogCandidates('Tool2', [{ url: 'b1' }], tracker);
    assert.deepEqual(out.map(b => b.url), ['b1']);
  });
});
