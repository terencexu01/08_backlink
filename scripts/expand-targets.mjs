#!/usr/bin/env node
// expand-targets.mjs — Pull directory sites from a community awesome-list
// (awesome-saas-directories), filter out social/repo links + dedupe vs the
// existing targets.yaml, and append the fresh ones as a new group.
//
// Usage: node scripts/expand-targets.mjs

import { readFileSync, writeFileSync } from 'fs';
import { parse } from 'yaml';

const SOURCE_REPO = process.argv[2] || 'theshubh77/awesome-saas-directories';
const TARGETS_FILE = 'targets.yaml';

// 1. Fetch raw README (try main then master)
let md = '';
for (const branch of ['main', 'master']) {
  for (const file of ['README.md', 'readme.md']) {
    try {
      const r = await fetch(`https://raw.githubusercontent.com/${SOURCE_REPO}/${branch}/${file}`);
      if (r.ok) { md = await r.text(); break; }
    } catch {}
  }
  if (md) break;
}
if (!md) { console.error('❌ could not fetch README'); process.exit(1); }

// 2. Extract markdown links [name](url)
const links = [...md.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)]
  .map(m => ({ name: m[1].replace(/\*+/g, '').trim(), url: m[2].trim() }))
  .filter(l => l.url.startsWith('http'));

// 3. Exclude social media, GitHub repos/gists, aggregators (not directories)
const EXCLUDE = /reddit\.com|facebook\.com|x\.com|twitter\.com|youtube\.com|t\.me|linkedin\.com|github\.com|gist\.|medium\.com|news\.ycombinator/i;
const SUBMIT_LIKE = u => /submit|\/new|launch|create|\/add|posts|manage-item|submit-a-tool|onboard|submit-your|submit-startup/i.test(u)
  || /submit|launch|directory|tools/i.test(u);
const dirs = links.filter(l => !EXCLUDE.test(l.url) && SUBMIT_LIKE(l.url));

// 4. Dedupe vs existing targets.yaml (by origin)
const t = parse(readFileSync(TARGETS_FILE, 'utf-8'));
const existing = new Set();
for (const g of Object.values(t)) {
  if (!Array.isArray(g)) continue;
  for (const s of g) {
    for (const u of [s.submit_url, s.url]) {
      if (!u) continue;
      try { existing.add(new URL(u).origin); } catch {}
    }
  }
}
const seen = new Set();
const fresh = dirs.filter(d => {
  let origin;
  try { origin = new URL(d.url).origin; } catch { return false; }
  if (existing.has(origin) || seen.has(origin)) return false;
  seen.add(origin);
  return true;
});

console.log(`links: ${links.length} | submit-like dirs: ${dirs.length} | fresh (new origin): ${fresh.length}`);

if (fresh.length === 0) {
  console.log('nothing new to add');
  process.exit(0);
}

// 5. Append to targets.yaml as a new group
const today = new Date().toISOString().split('T')[0];
const yamlBlock = `
# ============================================================
# Community-curated directories (from ${SOURCE_REPO}, ${fresh.length} new, added ${today})
# Run scripts/probe-blogs.mjs-style liveness check before bulk submit
# ============================================================
community_curated_from_${SOURCE_REPO.replace(/[^a-z0-9]/gi, '_')}:

` + fresh.map(d => {
  const cleanUrl = d.url.split('?')[0].replace(/\/$/, '');
  let name = d.name;
  if (!name || /submit|here|launch|add|new/i.test(name)) {
    try { name = new URL(cleanUrl).hostname.replace(/^www\./, '').split('.')[0]; } catch {}
  }
  name = name.charAt(0).toUpperCase() + name.slice(1);
  return `  - name: ${JSON.stringify(name)}\n    submit_url: ${cleanUrl}\n    type: form\n    auto: yes\n    lang: en`;
}).join('\n') + '\n';

writeFileSync(TARGETS_FILE, readFileSync(TARGETS_FILE, 'utf-8') + yamlBlock, 'utf-8');
console.log(`\n✅ appended ${fresh.length} new directories to ${TARGETS_FILE} (group: community_curated_directories)`);
console.log('first 10:');
fresh.slice(0, 10).forEach(d => console.log(`  + ${d.name} — ${d.url}`));
