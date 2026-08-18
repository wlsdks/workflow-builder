/**
 * packages/doc-gen/src/format/markdown.ts
 *
 * 문서 트리 → 마크다운 (§6.3).
 *
 * **§2.1의 전문이 곧 마크다운 출력이다.** 렌더러는 문장을 만들지 않는다 —
 * 트리를 그리기만 한다. 문장이 두 곳에서 만들어지는 순간 포맷마다 달라지고,
 * 달라지면 어느 쪽이 맞는지 아무도 모르게 된다.
 *
 * ASCII 안전 문자만 쓴다. 마크다운은 어디에 붙을지 모른다.
 *   사용  1. 2. 3. / **볼드** / > 인용 / | 표 | / --- 가로선
 *   금지  ◇ ⏸ ↩ ▸ 같은 기호 문자, 이모지, 전각 괄호
 *   대체  [기다림] [갈래] 라벨도 쓰지 않는다 — 소제목과 문장으로 이미 구분된다
 *
 * mermaid는 기본 꺼짐이다. 노션은 되지만 컨플루언스·그룹웨어 게시판·메일 본문은
 * 대부분 못 그리고, 실패하면 코드가 그대로 노출되어 문서가 망가진다.
 */

import type { Block, DocTree, Section } from '../types.ts';

export type MarkdownOptions = {
  /** 문서 맨 위 이미지 링크 한 줄. 노션·컨플루언스가 자동 임베드한다 */
  diagramImageUrl?: string;
};

export function toMarkdown(doc: DocTree, options: MarkdownOptions = {}): string {
  const chunks = doc.sections.map(renderSection).filter((s) => s.length > 0);
  const body = chunks.join('\n\n---\n\n');
  const head = options.diagramImageUrl
    ? `![${doc.title}](${options.diagramImageUrl})\n\n`
    : '';
  return `${head}${body}\n`;
}

function renderSection(section: Section): string {
  return section.blocks
    .map(renderBlock)
    .filter((s) => s.length > 0)
    .join('\n\n');
}

export function renderBlock(block: Block): string {
  switch (block.kind) {
    case 'heading':
      return `${'#'.repeat(block.level)} ${block.text}`;

    case 'lines':
      return block.lines.filter((l) => l.length > 0).join('\n');

    case 'quote':
      // 문단 사이는 `>` 한 줄. 빈 줄로 끊으면 인용이 두 개로 갈라진다
      return block.paragraphs
        .map((p) => p.split('\n').map((l) => `> ${l}`).join('\n'))
        .join('\n>\n');

    case 'bullets':
      return block.items.map((i) => `- ${i}`).join('\n');

    case 'table':
      return renderTable(block.head, block.rows);

    case 'rule':
      return '---';

    case 'handoff':
      // 가로선 한 줄 + 볼드 + 가로선 한 줄. 웹·PDF에서는 실제 블록으로 렌더된다
      return ['---', '', block.lines.join('\n'), '', '---'].join('\n');
  }
}

function renderTable(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [renderRow(head), `|${head.map(() => '---').join('|')}|`];
  for (const row of rows) lines.push(renderRow(row));
  return lines.join('\n');
}

/**
 * 빈 칸은 **공백 한 칸**이다. `—`나 `N/A`를 쓰지 않는다 (§2.2 #9).
 * 빈 칸에 무언가를 채우면 그 자리에 "없음"이라는 정보가 생기는데,
 * 실제로는 "아직 안 적었다"라서 거짓말이 된다.
 */
function renderRow(cells: readonly string[]): string {
  return `|${cells.map((c) => (c ? ` ${c} ` : ' ')).join('|')}|`;
}
