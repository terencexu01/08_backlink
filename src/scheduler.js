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

  return sites
    .map(siteKey)
    .filter(site => !isProjectSubmitted(project, site, tracker))
    .filter(site => {
      const last = getSiteLastSubmitDate(site, tracker);
      return !last || now - last.getTime() >= intervalMs;
    })
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
