// reviews.js — Parse and render the daily blog-comment review file.
// File format (spec §8):
//   ## ① Project Name  →  https://blog.url
//   评论草稿：
//   > comment line 1
//   > comment line 2
//   为什么这么写：reason
//   状态：☑ 通过  |  ☒ 打回  |  ☐ 待审

const INDEX_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

// Inspect only the first non-whitespace token after "状态：". This keeps the
// round-trip honest: renderReviewFile emits a trailing hint like
// "[☑ 通过 / ☒ 打回]" that contains every status word, which would otherwise
// dominate a naive whole-block search and always resolve to "approved".
function parseStatus(block) {
  const m = block.match(/状态：\s*(\S+)/);
  const first = m ? m[1] : '';
  if (/☑/.test(first) || first.includes('通过')) return 'approved';
  if (/☒/.test(first) || first.includes('打回') || first.includes('驳回')) return 'rejected';
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
