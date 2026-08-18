/**
 * packages/doc-gen/src/format/text.ts
 *
 * 문서 트리 → plain text.
 *
 * 카톡·문자·슬랙 붙여넣기용. 표는 어차피 깨지므로 **표를 표로 그리지 않고**
 * 줄 목록으로 편다. 마크다운 장식(`**`, `` ` ``)도 벗긴다 — plain text에서
 * 별표가 남으면 그건 장식이 아니라 잡음이다.
 */

import type { Block, DocTree, Section } from '../types.ts';

export function toPlainText(doc: DocTree): string {
  return (
    doc.sections
      .map(renderSection)
      .filter((s) => s.length > 0)
      .join('\n\n----\n\n') + '\n'
  );
}

function renderSection(section: Section): string {
  return section.blocks
    .map(renderBlock)
    .filter((s) => s.length > 0)
    .join('\n\n');
}

function strip(s: string): string {
  return s.replace(/\*\*/g, '').replace(/`/g, '');
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case 'heading':
      return strip(block.text);
    case 'lines':
      return block.lines.filter((l) => l.length > 0).map(strip).join('\n');
    case 'quote':
      return block.paragraphs.map((p) => strip(p)).join('\n\n');
    case 'bullets':
      return block.items.map((i) => `- ${strip(i)}`).join('\n');
    case 'table':
      return block.rows
        .map((row) =>
          row
            .map((cell, i) => (cell ? `${block.head[i] ?? ''}: ${strip(cell)}` : ''))
            .filter((s) => s.length > 0)
            .join(' / '),
        )
        .join('\n');
    case 'rule':
      return '----';
    case 'handoff':
      return block.lines.map(strip).join('\n');
  }
}
