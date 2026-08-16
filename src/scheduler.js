// scheduler.js — Interval-aware candidate selection for multi-project backlink scheduling
// Rules (spec §4):
//   - Directory: same site, any two submissions ≥ DIRECTORY_INTERVAL_DAYS apart
//   - Blog (tools): ≤ BLOG_MAX_PROJECTS per blog, ≥ BLOG_INTERVAL_DAYS between them

import { isProjectSubmitted, getSiteLastSubmitDate, getBlogCommentStats } from './tracker.js';

export const DIRECTORY_INTERVAL_DAYS = 5;
export const BLOG_INTERVAL_DAYS = 3;
export const BLOG_MAX_PROJECTS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const siteKey = s => (typeof s === 'string' ? s : s.name);

export function getDirectoryCandidates(project, sites, tracker, opts = {}) {
  const limit = opts.limit ?? 10;
  const intervalMs = (opts.intervalDays ?? DIRECTORY_INTERVAL_DAYS) * DAY_MS;
  const now = Date.now();

  // Normalize URLs for matching: strip query, trailing slash, and www prefix
  // (tracker may record https://www.example.com while targets has https://example.com).
  const normalize = u => {
    if (!u || typeof u !== 'string') return u;
    let n = u.split('?')[0].replace(/\/$/, '');
    n = n.replace(/^https?:\/\/www\./, 'https://').replace(/^http:\/\/www\./, 'http://');
    return n;
  };

  // Sites may be strings (names) or objects with {name, submit_url}. Tracker
  // records submit_url, so resolve each site to its URL for matching, falling
  // back to the name if no URL is available.
  const toKeys = s => {
    if (typeof s === 'string') return [s];
    return [s.submit_url, s.name].filter(Boolean).map(normalize);
  };

  // Build normalized lookup sets from tracker
  const submittedUrls = new Set();
  const lastByNormUrl = {};
  for (const sub of (tracker.submissions || [])) {
    const key = sub.site || sub.url;
    if (!key || typeof key !== 'string') continue;
    const nk = normalize(key);
    if (sub.status === 'submitted' && sub.project === project) submittedUrls.add(nk);
    const t = new Date(sub.timestamp).getTime();
    if (!lastByNormUrl[nk] || t > lastByNormUrl[nk]) lastByNormUrl[nk] = t;
  }

  return sites
    .map(s => ({ site: s, keys: toKeys(s) }))
    .filter(({ keys }) => !keys.some(k => submittedUrls.has(k)))
    .filter(({ keys }) => {
      const lastDates = keys.map(k => lastByNormUrl[k]).filter(Boolean);
      if (lastDates.length === 0) return true;
      return now - Math.max(...lastDates) >= intervalMs;
    })
    .map(({ site }) => siteKey(site))
    .slice(0, limit);
}

export function getBlogCandidates(project, blogs, tracker, opts = {}) {
  const intervalMs = (opts.intervalDays ?? BLOG_INTERVAL_DAYS) * DAY_MS;
  const now = Date.now();

  return blogs.filter(blog => {
    const stats = getBlogCommentStats(blog.url, tracker);
    if (stats.projects.includes(project)) return false;
    if (stats.count >= BLOG_MAX_PROJECTS) return false;
    if (stats.lastDate && now - stats.lastDate.getTime() < intervalMs) return false;
    return true;
  });
}
