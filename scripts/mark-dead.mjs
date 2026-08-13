#!/usr/bin/env node
// mark-dead.mjs — Mark dead/paid directory sites in targets.yaml, then output
// the next batch of fresh (alive, not-yet-submitted) sites rotated across projects.
//
// Usage: node scripts/mark-dead.mjs [count=50]
// stdout: "Project|submit_url" pairs for the next batch
// stderr: summary

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse, stringify } from 'yaml';

const DEAD = ['aidude.pro', 'findcool.tools', 'ai-hunter.io', 'saasbaba.com',
  'topapps.ai', 'toolhunter.ai', 'futureagitools.com'];
const COUNT = parseInt(process.argv[2] || '50', 10);

const t = parse(readFileSync('targets.yaml', 'utf-8'));

// 1. Mark dead/paid
let marked = 0;
for (const g of Object.values(t)) {
  if (!Array.isArray(g)) continue;
  for (const s of g) {
    const u = s.submit_url || '';
    if (DEAD.some(d => u.includes(d)) && s.status !== 'dead' && s.status !== 'paid') {
      s.status = u.includes('findcool') ? 'paid' : 'dead';
      marked++;
    }
  }
}
writeFileSync('targets.yaml', stringify(t), 'utf-8');
console.error(`marked ${marked} sites dead/paid`);

// 2. Fresh alive (auto:yes, not dead/paid, not yet submitted)
const submitted = new Set();
if (existsSync('submissions.yaml')) {
  const sub = parse(readFileSync('submissions.yaml', 'utf-8'));
  for (const x of (sub.submissions || [])) { if (x.site) submitted.add(x.site); if (x.url) submitted.add(x.url); }
}
const projects = ['Plus Looks', 'AI Character Consistency', 'Peptide Calculator', 'Cursive Font Generator', 'Image to Prompt'];
const fresh = [];
for (const g of Object.values(t)) {
  if (!Array.isArray(g)) continue;
  for (const s of g) {
    if (s.auto === 'yes' && s.status !== 'dead' && s.status !== 'paid' && !submitted.has(s.submit_url)) {
      fresh.push(s);
    }
  }
}
console.error(`fresh alive (not submitted): ${fresh.length}, outputting ${Math.min(COUNT, fresh.length)}`);
fresh.slice(0, COUNT).forEach((s, i) => console.log(`${projects[i % 5]}|${s.submit_url}`));
