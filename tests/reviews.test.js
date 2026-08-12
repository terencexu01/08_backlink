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
