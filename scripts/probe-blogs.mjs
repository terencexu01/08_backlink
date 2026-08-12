#!/usr/bin/env node
// probe-blogs.mjs — Verify candidate blogs have a submittable comment form.
// Reusable for ongoing backfill: checks textarea + website field + captcha.
//
// Usage:
//   node scripts/probe-blogs.mjs                         # probes the built-in list
//   node scripts/probe-blogs.mjs URL1 URL2 ...           # probe given URLs

import { execFileSync } from 'child_process';
import { getBbCliPath } from '../src/bb.js';

const cli = getBbCliPath();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DEFAULT_URLS = [
  'https://inspirationtopublication.wordpress.com/2011/06/05/step-29-the-big-wait-for-board-game-publishers-to-respond/',
  'https://stonemaiergames.com/an-open-letter-to-new-reviewers-of-board-games-from-a-tiny-publishing-company/comment-page-3/',
  'https://theboardgameshow.com/2016/10/12/a-review-of-the-agamemnon-board-game/',
  'https://usergeneratededucation.wordpress.com/2022/01/31/benefits-of-using-board-games-in-the-classroom/',
  'https://cliosboardgames.wordpress.com/',
  'https://cardboardgamereview.wordpress.com/',
];

const urls = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_URLS;

// Probe: textarea count, comment textarea, website/url field, captcha
const PROBE_JS = `JSON.stringify({
  ta: document.querySelectorAll('textarea').length,
  c: !!document.querySelector('textarea#comment, textarea[name=comment], textarea[name*=comment i]'),
  u: !!document.querySelector('input#url, input[name=url], input[name*=website i], input[type=url]'),
  cap: !!document.querySelector('.g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*=captcha i]')
})`;

const usable = [];

for (const url of urls) {
  try {
    const open = execFileSync(process.execPath, [cli, 'open', url, '--tab'], { encoding: 'utf-8', timeout: 30000 });
    const tab = (open.match(/tab:\s*(\S+)/) || [])[1];
    if (!tab) { console.log(`NO TAB      ${url}`); continue; }
    await sleep(3500); // let the page render the comment form
    const res = execFileSync(process.execPath, [cli, 'eval', PROBE_JS, '--tab', tab], { encoding: 'utf-8', timeout: 15000 }).trim();
    let info;
    try { info = JSON.parse(res); } catch { info = { raw: res }; }
    const ok = info.c && info.u && !info.cap;
    console.log(`${ok ? '✅ USABLE' : '❌ skip  '}  ta=${info.ta} c=${info.c} u=${info.u} cap=${info.cap}  ${url}`);
    if (ok) usable.push(url);
    try { execFileSync(process.execPath, [cli, 'close', '--tab', tab], { encoding: 'utf-8', timeout: 10000 }); } catch {}
  } catch (e) {
    console.log(`ERR         ${url}  | ${(e.message || '').split('\n')[0]}`);
  }
}

console.log(`\n${usable.length}/${urls.length} usable:`);
usable.forEach(u => console.log('  ' + u));
