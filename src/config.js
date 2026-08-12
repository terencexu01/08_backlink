// config.js — Load and validate YAML config

import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const CONFIG_FILES = ['config.yaml', 'config.yml', 'backlink-pilot.yaml'];

// --- Multi-project support ---

const REQUIRED_PROJECT_FIELDS = ['name', 'url', 'description', 'email'];

export function normalizeProjects(config) {
  if (Array.isArray(config.projects)) return config.projects;
  if (config.product) return [config.product];
  return [];
}

export function validateProjects(projects) {
  const errors = [];
  for (const p of projects) {
    for (const f of REQUIRED_PROJECT_FIELDS) {
      if (!p[f]) errors.push(`Missing ${f} on project "${p.name || '(unnamed)'}"`);
    }
  }
  return errors;
}

export function getProject(config, name) {
  const projects = config._projects || normalizeProjects(config);
  if (!name) return projects[0];
  return projects.find(p => p.name === name);
}

export function listProjects(config) {
  const projects = config._projects || normalizeProjects(config);
  return projects.map(p => p.name).filter(Boolean);
}

export function utmUrlForProject(config, project, source) {
  const base = config.utm?.base_url || project.url;
  if (config.utm?.enabled === false) return base;
  const medium = config.utm?.medium || 'directory';
  const campaign = config.utm?.campaign || 'backlink';
  return `${base}?utm_source=${source}&utm_medium=${medium}&utm_campaign=${campaign}`;
}

export async function loadConfig(customPath) {
  let configPath = customPath;
  
  if (!configPath) {
    for (const f of CONFIG_FILES) {
      if (existsSync(f)) {
        configPath = f;
        break;
      }
    }
  }

  if (!configPath || !existsSync(configPath)) {
    console.error('❌ No config file found. Create config.yaml (see config.example.yaml)');
    process.exit(1);
  }

  const raw = readFileSync(configPath, 'utf-8');
  const config = parse(raw);

  const projects = normalizeProjects(config);
  if (projects.length === 0) {
    console.error('❌ No projects found. Define projects: (or product:) in config.yaml');
    process.exit(1);
  }
  const errors = validateProjects(projects);
  if (errors.length) {
    for (const e of errors) console.error(`❌ ${e}`);
    process.exit(1);
  }
  config._projects = projects;

  return config;
}

export function utmUrl(config, source) {
  const base = config.utm?.base_url || config.product.url;

  // Allow disabling UTM parameters entirely
  if (config.utm?.enabled === false) return base;

  const medium = config.utm?.medium || 'directory';
  const campaign = config.utm?.campaign || 'backlink';
  return `${base}?utm_source=${source}&utm_medium=${medium}&utm_campaign=${campaign}`;
}
