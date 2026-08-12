# 多项目外链调度系统 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 backlink-pilot 从单产品改为支持 6 个项目（5 工具站 + 1 游戏站）按间隔规则批量发外链，含目录站间隔调度、博客评论调度、审核文件工作流。

**Architecture:** 纯逻辑（config 解析、tracker 查询、scheduler 候选、reviews 解析）全部抽成可单测函数；浏览器提交复用现有 adapter/batch-submit，只改"取哪个项目"和"评论从哪来"。不搞全自动调度，调度由 Claude 每天手动调用 scheduler 出候选清单。

**Tech Stack:** Node.js >=18 (ESM)、node:test + node:assert/strict、yaml、commander、bb-browser。

## Global Constraints

- **模块系统**：ESM（`"type": "module"`），用 `import/export`，不用 `require`
- **测试**：`node:test` + `node:assert/strict`；单测运行 `node --test tests/<file>.test.js`；全量 `npm test`（= `node --test tests/*.test.js`）。单测不得启动浏览器。
- **间隔常量**（来自 spec §4，写进 `scheduler.js` 顶部）：目录站同站两次提交 ≥ **5 天**；博客工具站每篇 ≤ **3 个项目**、同篇站间 ≥ **3 天**；游戏站博客每篇 **1 条**
- **邮箱隔离**（spec §4.6）：工具站共用 1 个邮箱；游戏站专用邮箱。邮箱来自各项目 config 的 `email` 字段，不再硬编码 `PERSONAS`
- **config 结构**：`projects:` 列表（见 `config.example.multi.yaml`）。所有新代码必须向后兼容旧 `product:` 单产品结构
- **tracker 记录**：每条 submission 必须含 `project` 字段；博客评论也记入 `submissions.yaml`（`type: 'blog_comment'`，`site` 存博客 URL），不再只写 `logs/`
- **Git**：本项目当前非 git 仓库。每个 Task 末尾的 commit 步骤是检查点——若本地未初始化，先在项目根运行 `git init`；若不打算版本控制，可跳过 commit 步骤，以文件状态作为检查点
- **命名**：项目内文件用 `lower-kebab-case`，函数用 `camelCase`，与现有代码一致

---

## File Structure

**修改：**
- `src/config.js` — 标准化 `projects` 列表、校验、按名取项目
- `src/tracker.js` — `recordSubmission` 透传 `project`；新增按项目/站点/博客的查询函数
- `src/cli.js` — `submit` / `awesome` 命令加 `--project` 选项
- `src/submit.js` — 按 `--project` 解析产品；`recordSubmission` 带 project
- `src/batch-submit.js` — 取项目邮箱替代硬编码；新增 `--from-review` 入口

**新建：**
- `src/scheduler.js` — 间隔调度器（目录站/博客候选清单）
- `src/reviews.js` — 审核文件解析与渲染
- `tests/config-projects.test.js`
- `tests/tracker-queries.test.js`
- `tests/scheduler.test.js`
- `tests/reviews.test.js`
- `tests/submit-project.test.js`
- `reviews/.gitkeep` — 审核文件目录占位

**依赖链**：Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6

---

### Task 1: config 多项目化

**Files:**
- Modify: `src/config.js`
- Test: `tests/config-projects.test.js`

**Interfaces:**
- Produces: `normalizeProjects(config): object[]`、`validateProjects(projects): string[]`、`getProject(config, name?): object|undefined`、`listProjects(config): string[]`、`utmUrlForProject(config, project, source): string`。`loadConfig(config)` 会挂 `config._projects` 并在校验失败时 `process.exit(1)`。

- [ ] **Step 1: 写失败测试**

创建 `tests/config-projects.test.js`：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

运行：`node --test tests/config-projects.test.js`
预期：FAIL，报 `normalizeProjects is not a function`（导出不存在）。

- [ ] **Step 3: 实现 config.js 改造**

在 `src/config.js` 顶部 import 之后、`loadConfig` 之前，加入以下函数。保留现有 `utmUrl` 不动（向后兼容旧测试）。

```js
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
```

改造 `loadConfig`：在 `const config = parse(raw);` 之后、`return config;` 之前，替换原 `product.*` 校验块为：

```js
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
```

- [ ] **Step 4: 跑测试确认通过**

运行：`node --test tests/config-projects.test.js`
预期：PASS（全部用例）。再跑 `node --test tests/config.test.js` 确认旧 `utmUrl` 测试仍通过。

- [ ] **Step 5: Commit**

```bash
git add src/config.js tests/config-projects.test.js
git commit -m "feat(config): support multi-project list with per-project validation"
```
（未 git init 则先 `git init`，或跳过本步。）

---

### Task 2: tracker 加 project 维度与查询函数

**Files:**
- Modify: `src/tracker.js`
- Test: `tests/tracker-queries.test.js`

**Interfaces:**
- Consumes: 无（自含）
- Produces: `getSiteLastSubmitDate(site, tracker?): Date|null`、`isProjectSubmitted(project, site, tracker?): boolean`、`getBlogCommentStats(blogUrl, tracker?): {count, projects, lastDate}`。查询函数都接受可选 `tracker` 参数（默认调 `loadTracker()`），便于单测注入。`recordSubmission` 签名不变，但调用方须在 `details` 里传 `project`。

- [ ] **Step 1: 写失败测试**

创建 `tests/tracker-queries.test.js`：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

运行：`node --test tests/tracker-queries.test.js`
预期：FAIL，`getSiteLastSubmitDate is not a function`。

- [ ] **Step 3: 实现 tracker.js 查询函数**

在 `src/tracker.js` 末尾（`showStatus` 之后）追加：

```js
// --- Multi-project queries (interval scheduling) ---

const ts = s => new Date(s.timestamp).getTime();

export function getSiteLastSubmitDate(site, tracker = loadTracker()) {
  const subs = (tracker.submissions || []).filter(s => s.site === site);
  if (subs.length === 0) return null;
  return new Date(Math.max(...subs.map(ts)));
}

export function isProjectSubmitted(project, site, tracker = loadTracker()) {
  return (tracker.submissions || []).some(
    s => s.project === project && s.site === site && s.status === 'submitted'
  );
}

export function getBlogCommentStats(blogUrl, tracker = loadTracker()) {
  const subs = (tracker.submissions || []).filter(
    s => s.site === blogUrl && s.type === 'blog_comment'
  );
  return {
    count: subs.length,
    projects: subs.map(s => s.project),
    lastDate: subs.length ? new Date(Math.max(...subs.map(ts))) : null,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

运行：`node --test tests/tracker-queries.test.js`
预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/tracker.js tests/tracker-queries.test.js
git commit -m "feat(tracker): add project-aware queries for interval scheduling"
```

---

### Task 3: 间隔调度器 scheduler.js

**Files:**
- Create: `src/scheduler.js`
- Test: `tests/scheduler.test.js`

**Interfaces:**
- Consumes: `isProjectSubmitted`、`getSiteLastSubmitDate`、`getBlogCommentStats` from `./tracker.js`
- Produces: `DIRECTORY_INTERVAL_DAYS = 5`、`BLOG_INTERVAL_DAYS = 3`、`BLOG_MAX_PROJECTS = 3`、`getDirectoryCandidates(project, sites, tracker, opts?): string[]`、`getBlogCandidates(project, blogs, tracker, opts?): object[]`。`sites` 是目录站标识数组（字符串或 `{name}` 对象，取 `s.name || s`）；`blogs` 是 `[{url}]` 数组。

- [ ] **Step 1: 写失败测试**

创建 `tests/scheduler.test.js`：

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECTORY_INTERVAL_DAYS,
  BLOG_INTERVAL_DAYS,
  BLOG_MAX_PROJECTS,
  getDirectoryCandidates,
  getBlogCandidates,
} from '../src/scheduler.js';

const NOW = new Date('2026-08-12T10:00:00Z');
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
```

- [ ] **Step 2: 跑测试确认失败**

运行：`node --test tests/scheduler.test.js`
预期：FAIL，找不到 `src/scheduler.js`。

- [ ] **Step 3: 实现 scheduler.js**

创建 `src/scheduler.js`：

```js
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
```

- [ ] **Step 4: 跑测试确认通过**

运行：`node --test tests/scheduler.test.js`
预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.js tests/scheduler.test.js
git commit -m "feat(scheduler): interval-aware candidate selection for directories and blogs"
```

---

### Task 4: 审核文件解析器 reviews.js

**Files:**
- Create: `src/reviews.js`
- Create: `reviews/.gitkeep`
- Test: `tests/reviews.test.js`

**Interfaces:**
- Produces: `parseReviewFile(content): {project, blogUrl, comment, reason, status}[]`（status ∈ `pending|approved|rejected`）、`renderReviewFile(date, entries): string`、`filterApproved(entries): entry[]`。审核文件格式见 spec §8。

- [ ] **Step 1: 写失败测试**

创建 `tests/reviews.test.js`：

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewFile, renderReviewFile, filterApproved } from '../src/reviews.js';

const SAMPLE = `# 工具站博客评论 — 2026-08-12 待审

## ① Metric Converter  →  https://blog.io/a
评论草稿：
> 换算表很实用。
> 建议加一列分数英寸。
为什么这么写：引用文中表格并补空白。
状态：☑ 通过

## ② PDF Merge  →  https://blog.io/b
评论草稿：
> 合并功能省时间。
为什么这么写：肯定核心卖点。
状态：☒ 打回

## ③ PNG Crush  →  https://blog.io/c
评论草稿：
> 压缩比不错。
状态：☐ 待审
`;

describe('parseReviewFile', () => {
  it('parses project, url, comment, reason, status', () => {
    const entries = parseReviewFile(SAMPLE);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].project, 'Metric Converter');
    assert.equal(entries[0].blogUrl, 'https://blog.io/a');
    assert.ok(entries[0].comment.includes('换算表'));
    assert.ok(entries[0].comment.includes('分数英寸'));
    assert.equal(entries[0].status, 'approved');
    assert.equal(entries[1].status, 'rejected');
    assert.equal(entries[2].status, 'pending');
  });

  it('strips the "> " prefix from each comment line', () => {
    const entries = parseReviewFile(SAMPLE);
    assert.ok(!entries[0].comment.startsWith('> '));
  });
});

describe('filterApproved', () => {
  it('keeps only approved entries', () => {
    const entries = parseReviewFile(SAMPLE);
    const approved = filterApproved(entries);
    assert.equal(approved.length, 1);
    assert.equal(approved[0].project, 'Metric Converter');
  });
});

describe('renderReviewFile', () => {
  it('round-trips: render then parse yields same projects/urls', () => {
    const entries = [
      { project: 'A', blogUrl: 'https://x.io/1', comment: 'Line1\nLine2', reason: 'r1' },
      { project: 'B', blogUrl: 'https://x.io/2', comment: 'Only', reason: 'r2' },
    ];
    const rendered = renderReviewFile('2026-08-12', entries);
    const reparsed = parseReviewFile(rendered);
    assert.equal(reparsed.length, 2);
    assert.equal(reparsed[0].project, 'A');
    assert.equal(reparsed[0].blogUrl, 'https://x.io/1');
    assert.equal(reparsed[0].status, 'pending');
    assert.ok(reparsed[0].comment.includes('Line1'));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

运行：`node --test tests/reviews.test.js`
预期：FAIL，找不到 `src/reviews.js`。

- [ ] **Step 3: 实现 reviews.js**

创建 `src/reviews.js`：

```js
// reviews.js — Parse and render the daily blog-comment review file.
// File format (spec §8):
//   ## ① Project Name  →  https://blog.url
//   评论草稿：
//   > comment line 1
//   > comment line 2
//   为什么这么写：reason
//   状态：☑ 通过  |  ☒ 打回  |  ☐ 待审

const INDEX_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

function parseStatus(block) {
  if (/☑|通过/.test(block)) return 'approved';
  if (/☒|打回|驳回/.test(block)) return 'rejected';
  return 'pending';
}

export function parseReviewFile(content) {
  const blocks = content.split(/^## /m).slice(1);
  return blocks
    .map(block => {
      const head = block.match(/^(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.)])\s*(.+?)\s*→\s*(\S+)/);
      if (!head) return null;
      const project = head[1].trim();
      const blogUrl = head[2].trim();

      const commentMatch = block.match(/评论草稿：\s*\n((?:>.*\n?)+)/);
      let comment = '';
      if (commentMatch) {
        comment = commentMatch[1]
          .split('\n')
          .map(l => l.replace(/^>\s?/, '').trimEnd())
          .join('\n')
          .trim();
      }

      const reasonMatch = block.match(/为什么这么写：\s*(.+)/);
      const reason = reasonMatch ? reasonMatch[1].trim() : '';

      return { project, blogUrl, comment, reason, status: parseStatus(block) };
    })
    .filter(Boolean);
}

export function filterApproved(entries) {
  return entries.filter(e => e.status === 'approved');
}

export function renderReviewFile(date, entries) {
  const header = `# 工具站博客评论 — ${date} 待审\n\n`;
  const body = entries
    .map((e, i) => {
      const mark = INDEX_MARKS[i] || `${i + 1}.`;
      const comment = e.comment.split('\n').map(l => `> ${l}`).join('\n');
      const reason = e.reason ? `\n为什么这么写：${e.reason}` : '';
      return `## ${mark} ${e.project}  →  ${e.blogUrl}\n评论草稿：\n${comment}${reason}\n状态：☐ 待审   [☑ 通过 / ☒ 打回]\n`;
    })
    .join('\n');
  return header + body;
}
```

创建 `reviews/.gitkeep`（空文件）。

- [ ] **Step 4: 跑测试确认通过**

运行：`node --test tests/reviews.test.js`
预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/reviews.js tests/reviews.test.js reviews/.gitkeep
git commit -m "feat(reviews): parse and render daily blog-comment review file"
```

---

### Task 5: cli + submit 支持 --project

**Files:**
- Modify: `src/cli.js`
- Modify: `src/submit.js`
- Test: `tests/submit-project.test.js`

**Interfaces:**
- Consumes: `getProject`、`utmUrlForProject` from `./config.js`（Task 1）
- Produces: `resolveProduct(config, projectName, site): object`（返回带 `utm_url` 的 product，供 adapter 用）。`cli.js` 的 `submit`/`awesome` 命令新增 `--project <name>` 选项，写入 `config._activeProject`。`submit.js` 调 `resolveProduct` 并在 `recordSubmission` 里带 `project`。

- [ ] **Step 1: 写失败测试**

创建 `tests/submit-project.test.js`：

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProduct } from '../src/submit.js';

const config = {
  _projects: [
    { name: 'Tool1', url: 'https://t1.io', email: 't1@x.io', description: 'd1' },
    { name: 'Game', url: 'https://g.io', email: 'g@x.io', description: 'd2' },
  ],
  utm: { medium: 'directory', campaign: 'backlink' },
};

describe('resolveProduct', () => {
  it('returns the named project with utm_url attached', () => {
    const p = resolveProduct(config, 'Game', 'futuretools');
    assert.equal(p.name, 'Game');
    assert.equal(p.email, 'g@x.io');
    assert.match(p.utm_url, /utm_source=futuretools/);
    assert.match(p.utm_url, /^https:\/\/g\.io\?/);
  });

  it('falls back to first project when no name given', () => {
    const p = resolveProduct(config, undefined, 's');
    assert.equal(p.name, 'Tool1');
  });

  it('throws on unknown project name', () => {
    assert.throws(() => resolveProduct(config, 'Nope', 's'), /not found/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

运行：`node --test tests/submit-project.test.js`
预期：FAIL，`resolveProduct is not a function`（或 not exported）。

- [ ] **Step 3: 实现 submit.js 改造**

在 `src/submit.js` 顶部 import 块，把 `import { utmUrl } from './config.js';` 改为：

```js
import { utmUrl, getProject, utmUrlForProject } from './config.js';
```
（`utmUrl` 保留，旧代码路径仍引用。）

在 `export async function submit` 之前新增导出函数：

```js
export function resolveProduct(config, projectName, site) {
  const base = getProject(config, projectName);
  if (!base) throw new Error(`Project "${projectName}" not found in config`);
  return { ...base, utm_url: utmUrlForProject(config, base, site) };
}
```

在 `submit` 函数内，把原来的 `const product = { ...config.product, utm_url: utmUrl(config, site) };` 替换为：

```js
  const product = resolveProduct(config, config._activeProject, site);
```

把成功提交后的 `recordSubmission(site, 'submitted', { url: result?.url, confirmation: result?.confirmation });` 改为带 project：

```js
  recordSubmission(site, 'submitted', {
    project: product.name,
    url: result?.url,
    confirmation: result?.confirmation,
  });
```

- [ ] **Step 4: 改 cli.js 加 --project 选项**

在 `src/cli.js` 顶部 import 块加入：

```js
import { getProject } from './config.js';
```

把 `submit` 命令块改为（加 `--project` 选项 + 解析）：

```js
program
  .command('submit <site>')
  .description('Submit to a directory site (name or URL for generic)')
  .option('--dry-run', 'Show what would be submitted without actually doing it')
  .option('--screenshot <path>', 'Save screenshot after submission')
  .option('--engine <engine>', 'Browser engine: bb or playwright')
  .option('--project <name>', 'Which project to submit (default: first)')
  .action(async (site, opts) => {
    const config = await loadConfig();
    if (opts.project) {
      if (!getProject(config, opts.project)) {
        console.error(`❌ Project "${opts.project}" not found. Available: ${listProjects(config).join(', ')}`);
        process.exit(1);
      }
      config._activeProject = opts.project;
    }
    if (opts.engine) config._engine = opts.engine;
    await submit(site, { ...opts, config });
  });
```

把 `listProjects` 也加入顶部 import：

```js
import { getProject, listProjects } from './config.js';
```

对 `awesome` 命令做同样改造：加 `.option('--project <name>', ...)`，action 里 `if (opts.project) config._activeProject = opts.project;`。（`awesome/templates.js` 的 `generateAwesomeIssue` 内部用 `config.product`，需改为 `getProject(config, config._activeProject)` —— 见本步末尾。）

在 `src/awesome/templates.js` 顶部加 `import { getProject } from '../config.js';`，把 `generateAwesomeIssue` 内的 `const product = { ...config.product, utm_url: utmUrl(config, 'github') };` 改为：

```js
  const base = getProject(config, config._activeProject);
  const product = { ...base, utm_url: utmUrlForProject(config, base, 'github') };
```
并把该文件顶部 `import { utmUrl } from '../config.js';` 改为 `import { utmUrl, utmUrlForProject, getProject } from '../config.js';`。

- [ ] **Step 5: 跑测试确认通过**

运行：`node --test tests/submit-project.test.js`
预期：PASS。再跑 `npm test` 确认未破坏其他测试（`submit-preflight.test.js` 等可能引用 `config.product`，若失败需同步更新——见 Self-Review）。

- [ ] **Step 6: Commit**

```bash
git add src/cli.js src/submit.js src/awesome/templates.js tests/submit-project.test.js
git commit -m "feat(cli,submit): add --project option; route submission through resolveProduct"
```

---

### Task 6: batch-submit 多项目化 + 按审核文件提交

**Files:**
- Modify: `src/batch-submit.js`
- Test: `tests/batch-submit.test.js`（扩展）

**Interfaces:**
- Consumes: `loadConfig`、`getProject` from `./config.js`；`parseReviewFile`、`filterApproved` from `./reviews.js`；`recordSubmission` from `./tracker.js`（带 project + type）
- Produces: `pickProjectEmail(project, config): string`（取项目邮箱，替代硬编码 `PERSONAS` 的邮箱）；batch-submit 新增 `--project <name>` 与 `--from-review <path>` 两个 CLI 选项。`--from-review` 模式：解析审核文件 → 过滤 approved → 对每条用项目邮箱 + 评论内容填表提交（评论来自文件，不走 `COMMENT_TEMPLATES`）。

- [ ] **Step 1: 写失败测试**

在 `tests/batch-submit.test.js` 末尾追加（保留现有用例）：

```js
import { pickProjectEmail } from '../src/batch-submit.js';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';

describe('pickProjectEmail', () => {
  it('returns the project email from config', () => {
    const config = { _projects: [{ name: 'Game', email: 'game-special@x.io' }] };
    assert.equal(pickProjectEmail('Game', config), 'game-special@x.io');
  });

  it('throws when project missing', () => {
    assert.throws(() => pickProjectEmail('Nope', { _projects: [] }), /not found/);
  });
});

describe('--from-review approved extraction', () => {
  it('only approved review entries get submitted', () => {
    const { parseReviewFile, filterApproved } = require('../src/reviews.js');
    const file = `## ① A  →  https://b.io/1
评论草稿：
> good
状态：☑ 通过

## ② B  →  https://b.io/2
评论草稿：
> bad
状态：☒ 打回
`;
    const approved = filterApproved(parseReviewFile(file));
    // Note: ESM — re-import instead of require; see correction below
    assert.equal(approved.length, 1);
    assert.equal(approved[0].project, 'A');
  });
});
```

> ⚠️ ESM 修正：上面第二个 `describe` 里用了 `require`，但项目是 ESM。把它改为顶部 `import { parseReviewFile, filterApproved } from '../src/reviews.js';`（与文件顶部现有 import 合并）。修正后的用例主体不变，只是 import 提到顶部。

- [ ] **Step 2: 跑测试确认失败**

运行：`node --test tests/batch-submit.test.js`
预期：FAIL，`pickProjectEmail is not a function`。

- [ ] **Step 3: 实现 pickProjectEmail 与 --from-review 入口**

在 `src/batch-submit.js` 顶部 import 块加入：

```js
import { loadConfig, getProject } from './config.js';
import { parseReviewFile, filterApproved } from './reviews.js';
import { recordSubmission } from './tracker.js';
```

在 `PERSONAS` 常量之后新增导出函数：

```js
export function pickProjectEmail(projectName, config) {
  const project = getProject(config, projectName);
  if (!project) throw new Error(`Project "${projectName}" not found`);
  return project.email;
}
```

新增从审核文件提交的函数（放在 `submitBlogComment` 之后）：

```js
// Submit blog comments read from an approved review file (tool-site workflow).
// Each approved entry: { project, blogUrl, comment }.
async function submitFromReview(page, entry, config) {
  const email = pickProjectEmail(entry.project, config);
  await page.goto(entry.blogUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await delay(2000);

  const commentSelectors = [
    'textarea[name="comment"]', 'textarea#comment',
    'textarea[name*="comment" i]', 'textarea[placeholder*="comment" i]',
  ];
  let commentSelector = null;
  for (const sel of commentSelectors) {
    try { const el = await page.$(sel); if (el && await el.isVisible()) { commentSelector = sel; break; } }
    catch { continue; }
  }
  if (!commentSelector) throw new Error('No comment field found');

  await humanType(page, commentSelector, entry.comment);
  await delay(300);

  // Name + email (use project name as commenter display, project email)
  for (const sel of ['input[name="author"]', 'input#author', 'input[name*="name" i]']) {
    try { const el = await page.$(sel); if (el && await el.isVisible()) { await humanType(page, sel, entry.project); break; } }
    catch { continue; }
  }
  await delay(200);
  for (const sel of ['input[name="email"]', 'input#email', 'input[type="email"]']) {
    try { const el = await page.$(sel); if (el && await el.isVisible()) { await humanType(page, sel, email); break; } }
    catch { continue; }
  }
  await delay(200);

  // Website field = the project's own URL (the backlink)
  const project = getProject(config, entry.project);
  for (const sel of ['input[name="url"]', 'input#url', 'input[name*="website" i]', 'input[type="url"]']) {
    try { const el = await page.$(sel); if (el && await el.isVisible()) { await humanType(page, sel, project.url); break; } }
    catch { continue; }
  }
  await delay(500);

  for (const sel of ['input#submit', 'button[type="submit"]', 'button:has-text("Post Comment")', 'button:has-text("Submit")']) {
    try { const btn = await page.$(sel); if (btn && await btn.isVisible()) { await btn.click(); await delay(3000); break; } }
    catch { continue; }
  }
}
```

在 CLI 参数解析块（文件底部 `if (import.meta.url ...)` 内）加入新选项：

```js
    else if (args[i] === '--project') { opts.project = args[++i]; }
    else if (args[i] === '--from-review') { opts.reviewFile = args[++i]; }
```

在 `batchSubmit` 函数开头（`console.log('🚀 ...')` 之后）加入审核文件分支：

```js
  if (opts.reviewFile) {
    const config = await loadConfig();
    const raw = readFileSync(opts.reviewFile, 'utf-8');
    const approved = filterApproved(parseReviewFile(raw));
    console.log(`📝 Loaded ${approved.length} approved comments from ${opts.reviewFile}\n`);
    if (approved.length === 0) { console.log('Nothing to submit.'); return; }

    const { page, close } = await createSession({ browser: { headless: true }, _engine: opts.engine });
    try {
      for (let i = 0; i < approved.length; i++) {
        const entry = approved[i];
        console.log(`[${i + 1}/${approved.length}] ${entry.project} → ${entry.blogUrl}`);
        try {
          await submitFromReview(page, entry, config);
          recordSubmission(entry.blogUrl, 'submitted', {
            type: 'blog_comment', project: entry.project, url: entry.blogUrl,
          });
          console.log('  ✅ Submitted');
        } catch (e) {
          recordSubmission(entry.blogUrl, 'failed', {
            type: 'blog_comment', project: entry.project, error: e.message,
          });
          console.log(`  ❌ ${e.message}`);
        }
        if (i < approved.length - 1) await delay(MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY));
      }
    } finally { await close(); }
    return;
  }
```

`readFileSync` 已在文件顶部 import，无需重复。

- [ ] **Step 4: 跑测试确认通过**

运行：`node --test tests/batch-submit.test.js`
预期：PASS（含新用例）。

- [ ] **Step 5: Commit**

```bash
git add src/batch-submit.js tests/batch-submit.test.js
git commit -m "feat(batch-submit): per-project email and --from-review submission path"
```

---

## Self-Review

**1. Spec coverage**（对照 spec §6.1 五个改造点）：
- ✅ config 多项目化 → Task 1
- ✅ 提交脚本带项目参数 → Task 5（cli/submit）+ Task 6（batch-submit `--project`）
- ✅ 间隔查询小工具 → Task 3（`scheduler.js`）
- ✅ 审核文件工作流 → Task 4（`reviews.js`）+ Task 6（`--from-review` 入口）
- ✅ batch-submit 多项目化（游戏站专用邮箱、评论从审核文件读取）→ Task 6
- 间隔常量、邮箱隔离、tracker project 字段 → Task 2/3 + Global Constraints

**2. 占位符扫描**：无 TBD/TODO/"add error handling" 等；所有代码步骤含完整可运行代码。

**3. 类型/命名一致性**：
- `getProject(config, name)` 在 Task 1 定义，Task 5/6 消费 — 一致
- `resolveProduct(config, projectName, site)` Task 5 定义并导出 — 一致
- `pickProjectEmail(projectName, config)` Task 6 定义 — 一致
- `parseReviewFile` / `filterApproved` Task 4 定义，Task 6 消费 — 一致
- tracker 查询函数签名（`tracker` 可选第二/第三参数）Task 2 定义，Task 3 消费 — 一致

**4. 已知集成风险（实现时验证，非阻塞）**：
- `tests/submit-preflight.test.js` 可能引用 `config.product` — Task 5 Step 5 跑全量 `npm test` 时若失败，按新接口（`_projects` / `resolveProduct`）同步更新该测试。
- `src/submit.js` 原来还引用 `utmUrl`（旧）— 本计划保留 `utmUrl` 不删，避免破坏 `tests/config.test.js`。
- ESM 项目禁止 `require` — Task 6 测试中已标注改用顶部 `import`。

---

## 实现结果（2026-08-12 SDD 执行后）

**状态：6 Task 全部通过审查 + opus 全分支 final review 裁定 Ready to merge。**

9 commits（feat×6 + fix×3）：ee33e7c config / 8506e69 tracker / 547b543 scheduler / 2a67d17 scheduler测试时间炸弹fix / 009c77f reviews / f2413dc cli+submit / 183160f batch-submit / 3b08ff4 batch-submit守卫+游戏站邮箱隔离 / ccfd4ba dedup+删死代码import。

**执行中修正的 4 处**（plan 代码的疏漏，fix loop 修掉）：
1. Task 3 测试时间炸弹（钉死日期 → 改相对今天）
2. Task 6 `submitFromReview` 缺"无提交按钮"守卫
3. Task 6 游戏站邮箱隔离（`submitBlogComment` 加 `emailOverride`，`--project` 时用 `pickProjectEmail`）——SPEC §4.6 端到端落地
4. final: `--from-review` 去重（`isBlogCommentSubmitted`）+ 删两处 unused `utmUrl` import

**opus 裁定 SHIP-DEFERRED 的技术债**（非阻塞，未来改进）：
1. `utmUrlForProject` 在 utm disabled + base_url 设置时返回 base_url 而非 project.url（config.js:58-59）——一行修
2. `utmUrlForProject` 不 URL-encode source/medium/campaign（继承自旧 utmUrl）
3. `utmUrlForProject` 不处理 project.url 已带 query string（继承）
4. `loadConfig` 的 exit(1) 路径未单测
5. `getBlogCandidates` 无 opts.limit（brief-mandated 不对称）
6. reviews 测试仅 brief-verbatim，无 edge case 覆盖
7. `commentMatch` 正则截断缺 `>` 前缀的续行
8. cli `setActiveProject` 在 submit+awesome 重复（可抽 helper）
9. 无 CLI 级 --project 集成测试（仅 resolveProduct 单测）
10. `submitFromReview` 守卫 + 邮箱传递仅 smoke-test 可验证
11. `submitFromReview` 无 captcha/评论关闭 检测
12. 通用模板路径（游戏站博客）写 `logs/` 不写 `submissions.yaml` → tracker 查询看不到游戏站博客记录
13. 6 个预存测试失败（deprecated adapter 文件缺失等）——baseline 就有，非本分支引入

**待人工 smoke test**：`node src/batch-submit.js --project <游戏站> --limit 1 --engine bb` 跑一篇可评论博客，确认填入邮箱 = 该项目 config 的专用邮箱。

