import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSiteLastSubmitDate,
  isProjectSubmitted,
  getBlogCommentStats,
} from '../src/tracker.js';

const NOW = new Date('2026-08-12T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = d => new Date(d).toISOString();

describe('getSiteLastSubmitDate', () => {
  it('returns null when site never submitted', () => {
    assert.equal(getSiteLastSubmitDate('newsite', { submissions: [] }), null);
  });

  it('returns the most recent submission date for a site', () => {
    const tracker = { submissions: [
      { site: 's', timestamp: iso(NOW - 10 * DAY) },
      { site: 's', timestamp: iso(NOW - 2 * DAY) },
      { site: 'other', timestamp: iso(NOW) },
    ] };
    const last = getSiteLastSubmitDate('s', tracker);
    assert.equal(last.getTime(), NOW - 2 * DAY);
  });
});

describe('isProjectSubmitted', () => {
  it('true when project has a submitted record for the site', () => {
    const tracker = { submissions: [
      { project: 'Tool1', site: 's', status: 'submitted' },
    ] };
    assert.equal(isProjectSubmitted('Tool1', 's', tracker), true);
  });

  it('false for a different project on same site', () => {
    const tracker = { submissions: [
      { project: 'Tool1', site: 's', status: 'submitted' },
    ] };
    assert.equal(isProjectSubmitted('Tool2', 's', tracker), false);
  });

  it('ignores failed submissions', () => {
    const tracker = { submissions: [
      { project: 'Tool1', site: 's', status: 'failed' },
    ] };
    assert.equal(isProjectSubmitted('Tool1', 's', tracker), false);
  });
});

describe('getBlogCommentStats', () => {
  it('counts blog_comment records and lists projects', () => {
    const tracker = { submissions: [
      { site: 'https://blog.io/a', type: 'blog_comment', project: 'Tool1', timestamp: iso(NOW - 3 * DAY) },
      { site: 'https://blog.io/a', type: 'blog_comment', project: 'Tool2', timestamp: iso(NOW - 1 * DAY) },
      { site: 'https://blog.io/a', type: 'directory', project: 'Tool3', timestamp: iso(NOW) },
    ] };
    const stats = getBlogCommentStats('https://blog.io/a', tracker);
    assert.equal(stats.count, 2);
    assert.deepEqual(stats.projects, ['Tool1', 'Tool2']);
    assert.equal(stats.lastDate.getTime(), NOW - 1 * DAY);
  });

  it('returns zero count for unseen blog', () => {
    const stats = getBlogCommentStats('https://blog.io/x', { submissions: [] });
    assert.equal(stats.count, 0);
    assert.deepEqual(stats.projects, []);
    assert.equal(stats.lastDate, null);
  });
});
