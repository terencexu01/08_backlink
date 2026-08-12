import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProjects,
  validateProjects,
  getProject,
  listProjects,
  utmUrlForProject,
} from '../src/config.js';

describe('normalizeProjects', () => {
  it('returns projects list when projects: defined', () => {
    const config = { projects: [{ name: 'A' }, { name: 'B' }] };
    assert.deepEqual(normalizeProjects(config).map(p => p.name), ['A', 'B']);
  });

  it('wraps legacy product: into single-item list', () => {
    const config = { product: { name: 'Solo' } };
    assert.deepEqual(normalizeProjects(config).map(p => p.name), ['Solo']);
  });

  it('returns empty array when neither defined', () => {
    assert.deepEqual(normalizeProjects({}), []);
  });
});

describe('validateProjects', () => {
  const valid = [{ name: 'A', url: 'u', description: 'd', email: 'e' }];
  it('returns no errors for a fully valid project', () => {
    assert.deepEqual(validateProjects(valid), []);
  });

  it('reports each missing required field', () => {
    const errors = validateProjects([{ name: 'X' }]);
    assert.ok(errors.some(e => e.includes('url')), 'missing url flagged');
    assert.ok(errors.some(e => e.includes('description')), 'missing description flagged');
    assert.ok(errors.some(e => e.includes('email')), 'missing email flagged');
  });
});

describe('getProject', () => {
  const config = { _projects: [{ name: 'Tool1' }, { name: 'Game' }] };
  it('finds project by name', () => {
    assert.equal(getProject(config, 'Game').name, 'Game');
  });
  it('returns first project when no name given', () => {
    assert.equal(getProject(config).name, 'Tool1');
  });
  it('returns undefined for unknown name', () => {
    assert.equal(getProject(config, 'Nope'), undefined);
  });
});

describe('listProjects', () => {
  it('lists project names', () => {
    const config = { _projects: [{ name: 'A' }, { name: 'B' }] };
    assert.deepEqual(listProjects(config), ['A', 'B']);
  });
});

describe('utmUrlForProject', () => {
  it('uses project.url as base', () => {
    const config = { utm: { medium: 'directory', campaign: 'backlink' } };
    const project = { url: 'https://tool.io' };
    const out = utmUrlForProject(config, project, 'futuretools');
    assert.equal(out, 'https://tool.io?utm_source=futuretools&utm_medium=directory&utm_campaign=backlink');
  });

  it('returns clean url when utm disabled', () => {
    const config = { utm: { enabled: false } };
    const project = { url: 'https://tool.io' };
    assert.equal(utmUrlForProject(config, project, 'x'), 'https://tool.io');
  });
});
