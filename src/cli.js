#!/usr/bin/env node
// backlink-pilot CLI entry point

import { Command } from 'commander';
import { loadConfig } from './config.js';
import { scout } from './scout/discover.js';
import { submit } from './submit.js';
import { generateAwesomeIssue } from './awesome/templates.js';
import { pingIndexNow } from './indexnow.js';
import { showStatus } from './tracker.js';
import { forceUpdate } from './bb-update.js';

const program = new Command();

program
  .name('backlink-pilot')
  .description('Automated backlink submission toolkit for indie hackers')
  .version('2.1.0');

program
  .command('scout <url>')
  .description('Discover submit pages and form fields on a site')
  .option('--deep', 'Follow links to find hidden submit pages')
  .option('--screenshot <path>', 'Save screenshot of submit page')
  .option('--engine <engine>', 'Browser engine: bb or playwright')
  .action(async (url, opts) => {
    const config = await loadConfig();
    if (opts.engine) config._engine = opts.engine;
    await scout(url, { ...opts, config });
  });

program
  .command('submit <site>')
  .description('Submit to a directory site (name or URL for generic)')
  .option('--dry-run', 'Show what would be submitted without actually doing it')
  .option('--screenshot <path>', 'Save screenshot after submission')
  .option('--engine <engine>', 'Browser engine: bb or playwright')
  .action(async (site, opts) => {
    const config = await loadConfig();
    if (opts.engine) config._engine = opts.engine;
    await submit(site, { ...opts, config });
  });

program
  .command('awesome <repo>')
  .description('Generate GitHub Issue body for an awesome-list submission')
  .option('--open', 'Open the issue creation page in browser')
  .action(async (repo, opts) => {
    const config = await loadConfig();
    await generateAwesomeIssue(repo, { ...opts, config });
  });

program
  .command('indexnow <url>')
  .description('Ping Bing/Yandex about a new or updated page')
  .option('--key <key>', 'IndexNow API key')
  .action(async (url, opts) => {
    const config = await loadConfig();
    await pingIndexNow(url, { ...opts, config });
  });

program
  .command('status')
  .description('Show submission tracking status')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await showStatus(opts);
  });

program
  .command('bb-update')
  .description('Update bb-browser community site adapters')
  .action(() => {
    forceUpdate();
  });

program.parse();
