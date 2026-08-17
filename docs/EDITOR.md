# 아웃라인 에디터 구현 명세

> 최종 갱신: 2026-08-17 · 상태: v0.1 · 대상: `@blocknote/react` **0.52.x 핀 고정**
>
> 상위 결정은 [DECISIONS.md](./DECISIONS.md) D-003·D-004·D-005·D-006·D-024·D-030·D-031·D-032·D-033·D-034·D-053·D-056에,
> 화면 치수는 [SCREENS.md §3](./SCREENS.md), 컴포넌트는 [COMPONENTS.md §5·§6](./COMPONENTS.md),
> 상태 전이는 [STATES.md §3·§5](./STATES.md), 접근성은 [ACCESSIBILITY.md §1·§3](./ACCESSIBILITY.md)에 있다.
> **이 문서는 그 위에 얹는 구현 명세다. 확정된 것은 다시 쓰지 않고 참조만 한다.**

---

## 0. 이 문서가 결정하는 것

M1에서 에디터는 기능 하나가 아니라 **제품의 얼굴**이다. 사용자가 이 제품과 보내는 시간의
90%가 이 컴포넌트 안에서 흐르고, 한국어 조합 입력이 한 번이라도 깨지면 그 사용자는 돌아오지
않는다. 그래서 이 문서의 판단 기준은 일관되게 하나다 — **조합 중에 아무 일도 일어나지 않게
만드는 설계가, 코드가 짧아지는 설계보다 항상 우선한다.**

| # | 결정 | 요약 |
|---|---|---|
| **E-01** | 블록 타입 3종 | `step`(task·hold 공용) / `branch` / `case`. 인라인 2종 `toolChip` / `personChip` |
| **E-02** | **중첩은 BlockNote `children`을 그대로 쓴다** | 평평한 배열 + `parentId`를 쓰지 않는다. 근거 §1.2 |
| **E-03** | 조건 입력은 `<input>`이 아니라 **ProseMirror 인라인 콘텐츠** | COMPONENTS §6의 `<input>` JSX는 폐기. 근거 §1.5 |
| **E-04** | 컨테이너 상자·레일은 **CSS `:has()`**, 하단 버튼줄은 **위젯 데코레이션** | 근거 §1.6 |
| **E-05** | 도구 배지·인라인 제안 칩은 **문서에 들어가지 않는다** (데코레이션) | 확정된 것만 노드가 된다. 근거 §6·§7 |
| **E-06** | `styleSpecs: {}` — 굵게·기울임이 **존재하지 않는다** | 서식이 없으면 서식 손실도 없다. 근거 §2.4 |
| **E-07** | 어댑터는 2단 (`BlockNote Block ↔ EditorNode ↔ Item`) | `@blocknote/*` import는 한 디렉터리에만. 근거 §11 |
| **E-08** | 어댑터는 **구조·제목·kind만 소유**한다. 나머지 필드는 이전 `Item`에서 머지 | 최대 손실 지점. 근거 §2.5 |
| **E-09** | 분기 중첩 **최대 2단**, 갈래 5개째부터 인라인 안내 | PARSING `MAX_DEPTH=2` / `MAX_BRANCH_CHILDREN=4`와 정렬 |
| **E-10** | 조합 판정은 `view.composing ‖ 자체 ref ‖ 60ms 유예` 3중 OR | 근거 §3.2 |

### 0.1 상위 문서와의 충돌 — 이 문서에서 정리한 것

SCREENS.md와 COMPONENTS.md가 서로 다른 값을 갖고 있는 지점이 8곳 있었다. 에디터 구현이
막히므로 여기서 정리하고, 원 문서에 역반영을 요청한다.

| # | 충돌 | 확정 | 근거 |
|---|---|---|---|
| 1 | 분기 컨테이너 배경/보더 — SCREENS `bg #FFF / border-left 3px` vs COMPONENTS §6 `bg #FCF8F1 / 컬러바 4px` | **SCREENS 채택** (`bg #FFFFFF`, `1px #E4E1DB`, `r12`, `border-left 3px`) | 캔버스 배경이 `#F7F6F3`, 아웃라인 패널이 `#FCFBF9`다. 컨테이너까지 틴트를 깔면 3중 베이지가 되어 경계가 사라진다. 흰 바탕이 "여기부터 다른 구조"를 가장 싸게 말한다 |
| 2 | 분기 액센트 `#9E6511` vs `#A56A12` | **`#9E6511`** | ACCESSIBILITY §5 확정. `#A56A12`는 4.50:1로 임계에 정확히 걸린다. `tailwind.config.ts`의 `branch.DEFAULT`를 정정해야 한다 |
| 3 | 포커스 링 — 이중 링 vs 소프트 링 | 에디터 내부는 **이중 링**(`--ring-focus-strong`) | ACCESSIBILITY §5. 아웃라인 패널 배경(`#FCFBF9`)과 활성 행 배경(`n-25`)이 같은 색이라 소프트 링이 사라진다 |
| 4 | 😤 이모지 vs COMPONENTS §19 이모지 금지 | **`frown` 라인 아이콘 16px** + `aria-label="짜증나는 단계로 표시"` | COMPONENTS §19가 시스템 전역 규칙이고 흑백 내보내기·폰트 편차 근거가 있다. 이모지는 문구(렌즈 라벨)에만 남는다 |
| 5 | 도구 배지 `r4 / 1px bd` vs 도구 칩 `r6 / 보더 없음` | **둘 다 맞다** — 미확정 배지(`r4`+보더+`?`)와 확정 칩(`r6`+무보더)은 **서로 다른 물건**이다 | "입력이 아니라 확인"이라는 원칙이 시각적으로 보이려면 확정 전후가 달라야 한다 |
| 6 | `bd-2 #948F87`가 Tailwind 팔레트에 없음 | `paper.450 #948F87`를 **추가**한다 | ACCESSIBILITY §5가 요구하는 컨트롤 경계선 3.11:1 토큰. `paper-300`(1.26:1)으로 대체하면 1.4.11 미달 |
| 7 | 하단 3버튼 `14px/500`이 정의된 fontSize 토큰이 아님 | **`label`(13/1.5/500)** 로 통일 | 새 토큰을 만들 이유가 없다. 44px 히트 영역은 `::after`로 확장 |
| 8 | 좌측 거터 — SCREENS(핸들 -24px) vs COMPONENTS §5(40px 거터: 핸들 16 + `[+]` 20) | **COMPONENTS §5 거터 모델 채택**, 😤(frown) 토글은 **우측 거터를 28→52px로 넓혀** `⋯`와 나란히 | 좌측에 넣으면 드래그 시작 오조작이 난다. 우측은 시선 종착점이라 상시 노출에 적합 |

### 0.2 COMPONENTS §5 `OutlineBlock`의 지위 변경 — 반드시 읽을 것

COMPONENTS.md §5의 `OutlineBlock`은 `<textarea rows=1 field-sizing:content>` 기반이다.
**이 구현은 BlockNote와 양립하지 않는다.** textarea가 블록마다 하나면 (a) 블록 간 캐럿 이동이
브라우저 기본이 아니라 수동 구현이 되고 (b) 여러 블록에 걸친 드래그 선택·복사가 불가능하며
(c) 조합 입력 표면이 블록 수만큼 늘어나 ACCESSIBILITY §10의 IME CI 테스트가 커버하지 못한다.

**확정**: COMPONENTS §5는 **블록의 크롬(거터·핸들·`[+]`·`⋯`·짜증 토글) 명세로만 유효**하고,
텍스트 영역과 `onChange / onEnter / onIndent / onMove / onDelete / onInsertAfter`
콜백은 폐기한다. 그 자리를 §4의 ProseMirror 커맨드가 대신한다. 치수·클래스·상태표는 그대로 산다.

```ts
// 폐기: OutlineBlockProps 중 텍스트·키보드 관련 전부
// 유효: id, depth, active, dragging, readOnly, onOpenMenu, onSlashCommand(=슬래시 메뉴 위임)
export interface BlockChromeProps {
  blockId: string;
  depth: 0 | 1 | 2;
  active: boolean;                 // 커서 보유 — BlockNote SideMenu가 계산해 준다
  kind: 'task' | 'hold';
  pain: boolean;
  readOnly?: boolean;
  onTogglePain: (blockId: string, next: boolean) => void;
  onOpenMenu: (blockId: string, anchor: HTMLElement) => void;
}
```

---

## 1. BlockNote 커스텀 스키마

### 1.1 도메인 구조 복습 (이 절의 전제)

`packages/graph-core`가 이미 확정한 것 — **역할은 `kind`가 아니라 위치다** (D-053, GRAPH-CORE §1.3).

```
isCase(x) ⟺ parent(x) ≠ null ∧ parent(x).kind = 'branch' ∧ ¬isCase(parent(x))
```

- 분기의 자식 = **갈래(case)**. 갈래는 **노드가 되지 않는다**. 조건 라벨은 엣지 라벨로 나간다
- 갈래의 자식 = **본문 단계**
- 갈래 항목의 `attrs.caseLabel`이 라벨이고, 비어 있으면 `title`로 폴백한다 (`caseLabelOf`)
- 픽스처 빌더(`kase()`)는 갈래 항목을 `kind: 'branch'` + `attrs.caseLabel`로 만든다

즉 **에디터의 `case` 블록 → `Item { kind: 'branch', attrs.caseLabel, title }`** 로 내려간다.
`kind`를 `task`로 내려도 `derive()` 결과가 같다는 것이 D-053의 보증이지만, 어댑터는
픽스처와 동일하게 `'branch'`를 쓴다 — **골든 픽스처를 그대로 어댑터 테스트에 재사용하기 위해서다** (§12.3).

### 1.2 ★ 가장 중요한 선택 — 중첩을 무엇으로 표현하는가

세 가지 선택지가 있었다.

| | (A) 평평한 블록 + `parentId` prop | (B) BlockNote `children` | (C) 분기만 단일 블록에 JSON으로 |
|---|---|---|---|
| 어댑터 | 거의 항등 함수 | 트리 워크 (30줄) | 분기 내부는 어댑터 밖 |
| 블록 간 캐럿 ↑↓ | **직접 구현** | ProseMirror 기본 | 컨테이너 진입이 특수 케이스 |
| 여러 블록 드래그 선택 | **불가능** (시각 중첩과 문서 순서가 어긋남) | 기본 | 컨테이너가 원자 노드가 됨 |
| Backspace 병합 | **직접 구현** | ProseMirror 기본 (`joinBackward`) | 내부는 별도 에디터 필요 |
| 드래그 앤 드롭 | 드롭 후 `parentId` 수동 갱신 | BlockNote SideMenu 기본 | 갈래 간 이동 불가 |
| 붙여넣기 | 모든 스텝에서 `parentId` 재계산 | `children` 그대로 | 파싱 결과를 두 형식으로 |
| **IME 위험** | 구조 유지용 `appendTransaction`이 **모든 입력마다** 돈다 | 구조가 문서 자체라 유지 트랜잭션이 없다 | 컨테이너 내부가 두 번째 조합 표면 |

**(B) BlockNote `children`을 쓴다.**

결정적인 이유는 어댑터의 편의가 아니라 **IME다.**

(A)는 겉보기에 매력적이다. `blockToItem`이 항등 함수에 가까워지고 `sortKey`도 순서대로
읽으면 끝난다. 그런데 평평한 문서에 `parentId` prop을 얹는 순간, **ProseMirror가 모르는 불변식이
생긴다.** ProseMirror의 모든 기본 트랜스폼 — Backspace 병합, 드래그 앤 드롭, 붙여넣기, undo —
은 문서 구조만 보고 동작하므로 `parentId`를 갱신해 주지 않는다. 이걸 맞추려면 `appendTransaction`
으로 매 트랜잭션마다 전체 문서를 훑어 `parentId`를 재계산해야 하고, **그 재계산이 조합 중에도
돈다.** 조합 중 `appendTransaction`이 노드 attrs를 하나라도 건드리면 React가 텍스트 노드를
교체하고, Chrome은 composition을 abort하고, `"한"`이 `"ㅎ"`으로 무너진다. 이건 ARCHITECTURE §3이
이미 경고한 바로 그 실패다.

(B)는 구조가 곧 문서라서 유지 트랜잭션이 **원리적으로 필요 없다.** 조합 중에 도는 우리 코드가
0줄이 된다. 어댑터가 30줄 늘어나는 대가로 IME 위험 표면이 사라지는 거래이고, 이 제품에서는
비교 자체가 성립하지 않는다.

부수 이득 3가지:
1. `block.id = items.id` (D-031)와 `children` 순서가 함께 있으면 **`parentId`와 `sortKey`가 전부 유도된다.** 두 개의 진실을 관리하지 않는다
2. 갈래 안에서 밖으로 이어지는 드래그 선택·복사가 공짜다 — 붙여넣기 무손실(D-052)의 반대 방향 보증
3. Yjs 전환 시 `Y.XmlFragment` 중첩이 그대로 매핑된다. (A)였다면 `parentId` 갱신이 CRDT 병합에서 충돌한다

**(B)의 비용과 그 값**: BlockNote는 "어떤 블록이 어떤 블록의 자식이 될 수 있는가"를 스키마로
표현하지 못한다(0.52 기준). 그래서 `case`가 `branch` 밖에 놓이거나 `step`이 `branch`의 직계 자식이
되는 상태가 만들어질 수 있다. 이건 **금지가 아니라 정규화로** 푼다 (§5.6 `structureNormalizer`).
금지하려면 모든 입력 경로를 가로채야 하고, 그건 다시 IME 위험이다. **허용하고 한 트랜잭션 뒤에
고치는 쪽이 항상 싸다.**

### 1.3 스키마 정의

```ts
// app/(app)/workflows/[id]/_components/editor/blocknote/schema.ts
// ★ @blocknote/* 를 import 할 수 있는 유일한 디렉터리다 (§11.2 ESLint 규칙)
import {
  BlockNoteSchema,
  defaultInlineContentSpecs,
  type BlockNoteEditor,
} from '@blocknote/core';
import { createReactBlockSpec, createReactInlineContentSpec } from '@blocknote/react';

import { StepRow } from './blocks/StepRow';
import { BranchHead } from './blocks/BranchHead';
import { CaseRow } from './blocks/CaseRow';
import { ToolChipView } from './inline/ToolChipView';
import { PersonChipView } from './inline/PersonChipView';

/* ───────────────────────────────────────────────────────────────────────────
 * propSchema 제약 — 0.52는 원시값(string | number | boolean)만 허용한다.
 * 배열·객체를 넣고 싶어지면 그건 props에 들어갈 데이터가 아니다.
 * toolIds / assigneeId / durationBand / freqLast7d 는 items 스토어에 산다.
 * props에는 "이 블록을 그리는 데 필요한 것"만 둔다. (E-08)
 * ─────────────────────────────────────────────────────────────────────────── */

export const stepBlock = createReactBlockSpec(
  {
    type: 'step',
    content: 'inline',
    propSchema: {
      // ★ defaultProps(textColor / backgroundColor / textAlignment)를 상속하지 않는다.
      //   색과 정렬은 이 제품에 존재하지 않는 개념이고, 상속하면 붙여넣기로 들어온다.
      kind:    { default: 'task' as const, values: ['task', 'hold'] as const },
      pain:    { default: false },
      // hold 전용. 'none'은 "아직 안 물어봄"이지 "없음"이 아니다 (D-055와 같은 규율)
      waitFor: { default: 'none' as const, values: ['none','approval','reply','time','resource'] as const },
      // 붙여넣기 검토 상태 (§8.4). items로 내려가지 않는다
      review:   { default: false },
      boundary: { default: 1 },   // 0..1, 경계 신뢰도. review=true 일 때만 의미 있다
    },
  },
  {
    render: (props) => <StepRow {...props} />,

    // 외부에서 들어온 HTML을 step으로 받아들이는 규칙.
    // ★ 관대하게 받는다 — 못 알아들으면 텍스트가 사라지는 게 아니라 텍스트만 남는다
    parse: (el) => {
      if (el.tagName === 'LI' || el.tagName === 'P' || el.tagName === 'DIV') {
        const kind = el.getAttribute('data-kind');
        return {
          kind: kind === 'hold' ? 'hold' : 'task',
          pain: el.getAttribute('data-pain') === 'true',
          waitFor: (el.getAttribute('data-wait-for') ?? 'none') as 'none',
        };
      }
      return undefined;
    },

    // 클립보드·내보내기용. 우리 앱 밖에서도 읽히는 문장이어야 한다
    toExternalHTML: ({ block, contentRef }) => (
      <p data-kind={block.props.kind}
         data-wait-for={block.props.waitFor !== 'none' ? block.props.waitFor : undefined}>
        {block.props.kind === 'hold' ? <span>⏸ </span> : null}
        <span ref={contentRef} />
      </p>
    ),
  },
);

export const branchBlock = createReactBlockSpec(
  {
    type: 'branch',
    content: 'inline',            // ← 분기 기준("내용 분류"). h36 인풋처럼 보이지만 인라인 콘텐츠다
    propSchema: {
      mode: { default: 'xor' as const, values: ['xor', 'and', 'skip'] as const },
      // 2택 칩. 데이터는 갈래마다 있지만 UI는 컨테이너 1개다 (§5.5)
      joinBehavior: { default: 'continue' as const, values: ['continue','end','mixed'] as const },
      collapsed: { default: false },
      review:    { default: false },
      boundary:  { default: 1 },
    },
  },
  {
    render: (props) => <BranchHead {...props} />,
    parse: (el) =>
      el.getAttribute('data-branch') !== null
        ? { mode: (el.getAttribute('data-mode') ?? 'xor') as 'xor' }
        : undefined,
    toExternalHTML: ({ block, contentRef }) => (
      <p data-branch="" data-mode={block.props.mode}>
        ◇ <span ref={contentRef} />
      </p>
    ),
  },
);

export const caseBlock = createReactBlockSpec(
  {
    type: 'case',
    content: 'inline',            // ← 갈래 조건("단순 문의"). h32 인풋처럼 보이지만 인라인 콘텐츠다
    propSchema: {
      // 컨테이너 하단 2택 칩이 일괄 기록한다. 갈래별로 다를 수 있다 (붙여넣기·AI 경로)
      joinBehavior: { default: 'continue' as const, values: ['continue', 'end'] as const },
      // 렌더 전용. "만약" / "아니면" 중 무엇을 인쇄할지. 어댑터는 읽지 않는다
      ordinal:  { default: 0 },
      review:   { default: false },
      boundary: { default: 1 },
    },
  },
  {
    render: (props) => <CaseRow {...props} />,
    parse: (el) =>
      el.getAttribute('data-case') !== null
        ? { joinBehavior: (el.getAttribute('data-join') ?? 'continue') as 'continue' }
        : undefined,
    toExternalHTML: ({ block, contentRef }) => (
      <p data-case="" data-join={block.props.joinBehavior}>
        {block.props.ordinal === 0 ? '만약 ' : '아니면 '}
        <strong ref={contentRef} />
        {'라면'}
      </p>
    ),
  },
);
```

**`toExternalHTML`에 "만약 … 라면"을 인쇄하는 이유** — 사용자가 아웃라인을 복사해 메일이나
카톡에 붙이는 일이 실제로 자주 일어난다(HANDOVER.md의 주 배포 경로). 껍데기 문구가 화면에만
있고 클립보드에 없으면, 붙여넣은 쪽에서는 `단순 문의`라는 정체불명의 한 줄이 된다.
**화면에 인쇄된 자연어는 UI 장식이 아니라 문서의 일부다.**

### 1.4 인라인 콘텐츠 — 도구 칩 / 담당자 칩

```ts
// inline/ToolChipView.tsx 와 짝
export const toolChip = createReactInlineContentSpec(
  {
    type: 'toolChip',
    content: 'none',              // ★ 편집 불가. 안쪽에 캐럿이 들어가지 않는다
    propSchema: {
      toolId:  { default: '' },   // tools.id (카탈로그 FK)
      display: { default: '' },   // '엑셀'
      // ★★ 원문 그대로. title 직렬화가 이 값을 쓴다 — 무손실의 유일한 근거 (§7.5)
      text:    { default: '' },   // '액셀'
    },
  },
  {
    render: ({ inlineContent }) => <ToolChipView {...inlineContent.props} />,
  },
);

export const personChip = createReactInlineContentSpec(
  {
    type: 'personChip',
    content: 'none',
    propSchema: {
      personId: { default: '' },  // users.id — ★ 자유 텍스트 금지 (ARCHITECTURE §2)
      display:  { default: '' },  // '김지수'
      text:     { default: '' },  // '@김지수' 원문
    },
  },
  { render: ({ inlineContent }) => <PersonChipView {...inlineContent.props} /> },
);
```

**도구 "확인 배지"(`Excel?`)는 여기 없다.** 배지는 인라인 콘텐츠가 아니라 **위젯 데코레이션**이다.
근거는 §7.2에서 상술하지만 한 줄로 요약하면 — **확정되지 않은 것은 문서에 들어가지 않는다.**
문서에 들어가면 undo 히스토리에 쌓이고, `items.title`에 섞이고, 복사에 딸려 가고,
무엇보다 매 타이핑마다 doc 변경 트랜잭션을 만들어 조합을 위협한다.

### 1.5 ★ 조건 입력을 `<input>`으로 만들지 않는 이유

COMPONENTS.md §6은 갈래 조건을 이렇게 그렸다.

```tsx
<input className="h-8 min-w-[120px] …" value={c.condition} aria-label={`${i+1}번째 경우의 조건`} />
```

**이 JSX는 폐기한다.** contenteditable 안에 React controlled `<input>`을 넣는 것은
DECISIONS D-034가 명시적으로 금지한 패턴의 정확한 인스턴스다. 이유 5가지:

1. **IME 표면이 둘로 늘어난다.** ProseMirror가 10년 걸려 잡은 조합 처리는 자기 contenteditable 안에서만 유효하다. 중첩 `<input>`의 조합은 우리가 처음부터 다시 잡아야 하고, ACCESSIBILITY §10의 CDP 회귀 테스트는 ProseMirror 표면만 친다
2. **controlled `value`는 조합을 끊는다.** 조합 중 상위 리렌더가 `value`를 되돌리면 조합 중이던 자모가 사라진다. COMPONENTS §2가 `onValueCommit`으로 이 문제를 인지하고 있지만, 그건 완화이지 해결이 아니다
3. **undo 스택이 갈라진다.** `<input>` 안의 `⌘Z`는 브라우저 네이티브 undo다. 우리 op 로그(D-032)와 무관하게 텍스트가 되돌아가고, 그 순간 `items`와 화면이 어긋난다
4. **선택이 끊긴다.** `⌘A`나 컨테이너를 가로지르는 드래그 선택이 `<input>`의 텍스트를 건너뛴다 → 복사하면 조건이 빠진다 → 무손실 위반
5. **캐럿 이동이 갇힌다.** 갈래 본문에서 `↑`를 눌러 조건으로, 다시 `↑`로 기준으로 올라가는 흐름이 자연스러워야 하는데, `<input>`은 `↑↓`를 자기가 먹는다

**대체 구현**: 시각 명세(`h32 / r6 / 1px #948F87 / min-w 96 / max-w 200` — 기준 인풋은 `h36`)는
그대로 유지하되, 안쪽은 BlockNote가 넘겨주는 `contentRef`다.

```tsx
// blocks/CaseRow.tsx
export function CaseRow({ block, contentRef, editor }: ReactCustomBlockRenderProps<typeof caseBlock, any, any>) {
  const ordinal = block.props.ordinal;
  return (
    <div className="flex min-h-8 items-center gap-1.5 text-body text-paper-700">
      {/* 인쇄된 자연어 껍데기. 편집 대상이 아니다 */}
      <span contentEditable={false} aria-hidden className="shrink-0 select-none">
        {ordinal === 0 ? '만약' : '아니면'}
      </span>

      {/* ★ 인풋처럼 보이는 인라인 콘텐츠. React가 value를 소유하지 않는다 */}
      <span
        ref={contentRef}
        data-ph="예: 금액이 500만 원을 넘으면"
        className="inline-flex h-8 min-w-[96px] max-w-[200px] items-center rounded-sm
                   border border-paper-450 bg-paper-0 px-2 text-body outline-none
                   focus-within:border-brand-500 focus-within:shadow-focus-strong
                   [&:has(:empty)]:border-dashed"
      />

      <span contentEditable={false} aria-hidden className="shrink-0 select-none">라면</span>
    </div>
  );
}
```

- placeholder는 React가 아니라 CSS로 — `[data-ph]:empty::before { content: attr(data-ph); color: var(--text-placeholder) }`. **조합 중 placeholder를 React가 지우면 그것만으로 리렌더가 발생한다**
- 미완성 상태(빈 조건)는 `border-dashed`. COMPONENTS §6이 확정한 대로 **에러가 아니다**
- `aria-label`은 껍데기가 아니라 갈래 그룹에 붙는다 (§10.3)

### 1.6 ★ 컨테이너 상자와 하단 버튼줄을 어떻게 그리는가

BlockNote/ProseMirror의 DOM은 이렇게 나온다.

```
.bn-block                       ← 블록 하나
  .bn-block-content[data-content-type="branch"]   ← render()가 그리는 곳 (첫 줄만)
  .bn-block-group                                  ← 자식들 (갈래들)
    .bn-block …
```

즉 **`render()`는 첫 줄만 그린다.** 자식은 `render()`의 출력 바깥, 형제로 붙는다.
그런데 우리가 원하는 건 (a) 첫 줄과 자식 전체를 감싸는 흰 상자 + 좌측 3px 바, (b) 자식들
**뒤에** 오는 `[+ 경우 추가] [갈래 끝내기 ↵] ○이어짐 ●여기서 끝` 버튼줄이다.
`render()`로는 둘 다 불가능하다.

**(a) 상자·레일 → CSS `:has()`**

```css
/* editor.css — 브라우저 하한선이 :has()를 요구한다 (STATES §9) */
.bn-block:has(> .bn-block-content[data-content-type="branch"]) {
  margin: 24px 0;
  padding: 16px 16px 12px 16px;
  background: var(--n-0);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--branch);        /* #9E6511 */
  border-radius: var(--radius-md);
}
/* 갈래 세로 레일 2px — 갈래 블록 전체 높이 */
.bn-block:has(> .bn-block-content[data-content-type="case"]) {
  position: relative;
  padding-left: 8px;
  margin-top: 12px;
}
.bn-block:has(> .bn-block-content[data-content-type="case"])::before {
  content: ''; position: absolute; inset-block: 0; left: 0;
  width: 2px; background: var(--border-strong);   /* #948F87 */
}
/* 갈래 내부 블록은 레일에서 24px */
.bn-block:has(> .bn-block-content[data-content-type="case"]) > .bn-block-group { padding-left: 24px; }
/* 모바일 (<768): 레일 8→6, 내부 24→16. 구조는 유지 (SCREENS §10) */
@media (max-width: 767px) {
  .bn-block:has(> .bn-block-content[data-content-type="case"]) { padding-left: 6px; }
  .bn-block:has(> .bn-block-content[data-content-type="case"]) > .bn-block-group { padding-left: 16px; }
}
```

**`:has()`를 쓰는 것이 핵심이다.** 대안은 `render()`에서 `createPortal`로 부모 DOM을 조작하는
것인데, ProseMirror가 소유한 DOM에 React가 노드를 꽂으면 트랜잭션마다 경합이 나고 조합 중에는
그 경합이 그대로 조합 취소가 된다. **ProseMirror의 DOM은 읽기만 하고 쓰지 않는다** — 이게
이 에디터의 전역 규칙이다.

**(b) 하단 버튼줄 → 위젯 데코레이션**

푸터를 문서 안의 진짜 블록으로 만들면 그건 `Item`이 되고, `derive()`가 노드로 그리고,
사용자가 그 줄에 캐럿을 놓고 타이핑할 수 있게 된다. 전부 틀렸다.
푸터는 **문서가 아니라 UI**이므로 데코레이션이 맞다.

```ts
// plugins/branchChrome.ts
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const branchChromeKey = new PluginKey<DecorationSet>('branchChrome');

/** 컨테이너 하단 버튼줄 / 갈래별 [+ 단계] / 빈 갈래 placeholder를 위젯으로 붙인다 */
export function branchChrome(mount: ChromeMounts): Plugin<DecorationSet> {
  const build = (doc: ProsemirrorNode): DecorationSet => {
    const decos: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name !== 'blockContainer') return true;
      const content = node.firstChild;
      if (!content) return true;

      if (content.type.name === 'branch') {
        // 컨테이너의 마지막 자식 뒤 = blockGroup 안 끝. side:1 로 자식들 뒤에 놓는다
        decos.push(Decoration.widget(pos + node.nodeSize - 1, mount.branchFooter(node), {
          side: 1, key: `bf:${node.attrs.id}:${node.childCount}`, ignoreSelection: true,
        }));
      }

      if (content.type.name === 'case') {
        const hasBody = node.childCount > 1;   // blockContent + blockGroup
        decos.push(Decoration.widget(pos + node.nodeSize - 1,
          hasBody ? mount.addStep(node) : mount.emptyCase(node),
          { side: 1, key: `cf:${node.attrs.id}:${hasBody}`, ignoreSelection: true }));
      }
      return true;
    });
    return DecorationSet.create(doc, decos);
  };

  return new Plugin<DecorationSet>({
    key: branchChromeKey,
    state: {
      init: (_, s) => build(s.doc),
      // ★ 문서가 안 바뀌면 다시 만들지 않는다. 조합 중에는 doc이 바뀌어도 위젯 key가 같아 DOM이 유지된다
      apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
    },
    props: { decorations: (s) => branchChromeKey.getState(s) },
  });
}
```

**`key`를 명시하는 것이 IME 안전의 핵심이다.** `Decoration.widget`은 `key`가 같으면 ProseMirror가
DOM 노드를 재사용하고 교체하지 않는다. `key` 없이 만들면 매 트랜잭션마다 위젯 DOM이 새로 붙고,
조합 중에 컨테이너 DOM이 흔들리면 브라우저가 조합을 끊는다. `key`에 `childCount`를 넣은 것은
**갈래 개수가 바뀔 때만** 푸터를 다시 그리기 위해서다.

`ignoreSelection: true`는 위젯이 선택 계산에 참여하지 않게 한다 — 없으면 `⌘A` 후 복사에
버튼 텍스트("경우 추가")가 딸려 나온다.

### 1.7 스키마 조립

```ts
export const schema = BlockNoteSchema.create({
  blockSpecs: {
    step:   stepBlock,
    branch: branchBlock,
    case:   caseBlock,
    // ★ paragraph / heading / bulletListItem / numberedListItem / table / image 를 전부 뺀다.
    //    "없는 블록은 만들어질 수 없다" — 붙여넣기 정규화(§8.2)의 절반이 스키마에서 해결된다
  },
  inlineContentSpecs: {
    text: defaultInlineContentSpecs.text,
    // link 를 뺀다. title 은 평문이고, href 를 담을 자리가 도메인 모델에 없다.
    // 링크 텍스트는 남고 href 만 사라진다 = 텍스트 무손실은 유지된다
    toolChip,
    personChip,
  },
  // ★★ 스타일이 존재하지 않는다. 굵게·기울임·색·형광펜 전부 없음.
  //    "서식 손실"이라는 변환 손실 지점이 원리적으로 제거된다 (E-06)
  styleSpecs: {},
});

export type AppSchema  = typeof schema;
export type AppEditor  = BlockNoteEditor<AppSchema['blockSchema'], AppSchema['inlineContentSchema'], AppSchema['styleSchema']>;
export type AppBlock   = AppSchema['Block'];
```

`paragraph`를 빼는 것에는 대가가 있다 — BlockNote 내부가 기본 블록 타입을 가정하는 코드 경로가
있으면 터진다. 0.52에서는 `defaultBlockSpecs.paragraph`를 빼도 동작하지만, **핀 고정된 버전에서
검증했다는 사실 자체가 스모크 테스트 항목이다** (§12.2 `schema.smoke.test.ts`).
동작하지 않는 버전이 오면 `paragraph`를 남기되 `structureNormalizer`가 즉시 `step`으로 변환한다.

---

## 2. 어댑터 레이어 — `blockToItem` / `itemToBlock`

### 2.1 2단 구조와 그 이유

```
@blocknote/react Block   ←─ bridge.ts ─→   EditorNode   ←─ adapter.ts ─→   Item
   (버전에 흔들림)          150줄, 유일한             (우리 타입,            (도메인 SoT)
                            BlockNote 의존             순수, 안정)
```

한 단계로 붙이면 `blockToItem`이 BlockNote 타입에 직접 의존하게 되고, 0.52 → 0.53에서
`Block`의 모양이 바뀌면 **어댑터·테스트·픽스처가 전부 따라 움직인다.** 두 단으로 끊으면
움직이는 것은 `bridge.ts` 150줄뿐이다. 이것이 D-034가 말한 "어댑터 레이어가 비용을 줄인다"의
구체적인 형태다 (§11).

```ts
// packages/editor-core/src/types.ts
// ★ 이 패키지는 react / @blocknote/* / prosemirror-* / DOM 을 import 하지 않는다.
//   graph-core 와 동일하게 tsconfig.lib 에서 "DOM"을 빼 컴파일 에러로 강제한다 (D-033 규율)
import type { NodeKind, ItemAttrs, Item } from '@workflow/graph-core';

export type EditorNodeType = 'step' | 'branch' | 'case';

export type EditorInline =
  | { t: 'text'; text: string }
  | { t: 'tool';   toolId: string; display: string; text: string }
  | { t: 'person'; personId: string; display: string; text: string };

export type EditorNode = {
  id: string;                       // = items.id = BlockNote block.id (D-031)
  type: EditorNodeType;
  content: readonly EditorInline[];
  props: {
    kind?: 'task' | 'hold';
    pain?: boolean;
    waitFor?: 'none' | 'approval' | 'reply' | 'time' | 'resource';
    mode?: 'xor' | 'and' | 'skip';
    joinBehavior?: 'continue' | 'end' | 'mixed';
    collapsed?: boolean;
    ordinal?: number;
    review?: boolean;
    boundary?: number;
  };
  children: readonly EditorNode[];
};
```

### 2.2 `EditorNode[] → Item[]`

```ts
// packages/editor-core/src/adapter.ts
import type { Item, ItemAttrs, NodeKind } from '@workflow/graph-core';
import type { EditorInline, EditorNode } from './types.ts';
import { keysBetween } from './sortkey.ts';

/** 인라인 배열 → 평문. ★ 칩은 원문(props.text)으로 되돌린다 = 무손실의 근거 */
export function inlineToText(content: readonly EditorInline[]): string {
  let out = '';
  for (const c of content) out += c.t === 'text' ? c.text : c.text;
  return out;
}

export type AdapterCtx = {
  /** 이전 Item 맵. ★ 어댑터가 소유하지 않는 필드를 여기서 머지한다 (§2.5) */
  prevById: ReadonlyMap<string, Item>;
  /** 결정적 sortKey 생성기. 테스트에서 대체 가능해야 하므로 주입한다 */
  keygen?: (before: string | null, after: string | null, n: number) => string[];
};

/** 단일 노드 → Item. 자식은 다루지 않는다 (그래서 순수하고 테스트가 쉽다) */
export function blockToItem(
  node: EditorNode,
  parentId: string | null,
  sortKey: string,
  isCase: boolean,
  ctx: AdapterCtx,
): Item {
  const prev = ctx.prevById.get(node.id);
  const title = inlineToText(node.content);

  // ── kind ────────────────────────────────────────────────────────────────
  // 갈래는 픽스처 빌더(kase())와 동일하게 'branch'로 내린다. D-053에 의해
  // 'task'로 내려도 derive() 결과는 같지만, 픽스처 재사용을 위해 맞춘다
  const kind: NodeKind =
    node.type === 'branch' ? 'branch'
    : node.type === 'case' ? 'branch'
    : node.props.kind === 'hold' ? 'hold'
    : 'task';

  // ── attrs ───────────────────────────────────────────────────────────────
  // ★ 이전 attrs 위에 얹는다. 메타 카드 스택이 넣은 avgWaitH·reworkRate·
  //   returnToItemId 는 에디터가 모르는 값이고, 덮어쓰면 조용히 사라진다
  const attrs: ItemAttrs = { ...(prev?.attrs ?? {}) };

  if (node.type === 'branch') {
    attrs.mode = node.props.mode ?? 'xor';
    delete attrs.caseLabel;
    delete attrs.joinBehavior;
  } else if (node.type === 'case') {
    attrs.caseLabel = title;                     // caseLabelOf 는 caseLabel 우선, title 폴백
    attrs.joinBehavior = node.props.joinBehavior === 'end' ? 'end' : 'continue';
    delete attrs.mode;
  } else {
    delete attrs.mode; delete attrs.caseLabel; delete attrs.joinBehavior;
    if (node.props.kind === 'hold') {
      if (node.props.waitFor && node.props.waitFor !== 'none') attrs.waitFor = node.props.waitFor;
    } else {
      delete attrs.waitFor; delete attrs.avgWaitH; delete attrs.timeoutH;
    }
  }

  return {
    // ★★ 스프레드가 먼저. 어댑터가 모르는 필드(assigneeId · durationBand · toolIds ·
    //    freqLast7d · automationLevel · lastConfirmedAt · deletedAt)는 전부 살아남는다
    ...(prev ?? EMPTY_ITEM),
    id: node.id,
    parentId,
    sortKey,
    kind,
    title,
    attrs,
    painFlag: node.props.pain ?? prev?.painFlag ?? false,
  };
}

const EMPTY_ITEM = {
  id: '', parentId: null, sortKey: '', kind: 'task', title: '', attrs: {},
  assigneeId: null, durationBand: null, toolIds: [], freqLast7d: null,
  automationLevel: null, painFlag: false, lastConfirmedAt: null, deletedAt: null,
} as const satisfies Item;

/** 트리 전체 → Item[]. pre-order. 순수 함수 */
export function blocksToItems(roots: readonly EditorNode[], ctx: AdapterCtx): Item[] {
  const out: Item[] = [];
  const gen = ctx.keygen ?? keysBetween;

  const walk = (siblings: readonly EditorNode[], parentId: string | null, parentIsCase: boolean) => {
    const keys = assignSortKeys(siblings, parentId, ctx, gen);
    siblings.forEach((n, i) => {
      // isCase 는 위치로 판정한다 — GRAPH-CORE §1.3 의 교대 규칙 그대로
      const isCase = n.type === 'case';
      out.push(blockToItem(n, parentId, keys[i]!, isCase, ctx));
      if (n.children.length) walk(n.children, n.id, isCase);
    });
  };
  walk(roots, null, false);
  return out;
}
```

### 2.3 `Item[] → EditorNode[]`

역방향은 **에디터를 마운트하거나 복구할 때만** 호출된다 (STATES §9 "에디터 상태 손상" 경로).
편집 중에는 절대 부르지 않는다 — 부르는 순간 contenteditable에 값을 되돌려 넣는 것이고,
그게 D-034가 금지한 controlled value다.

```ts
export type ItemToNodeCtx = {
  /** 확정된 도구 바인딩. title 안의 어느 구간이 어떤 도구인가 */
  toolSpans?: ReadonlyMap<string, readonly { start: number; end: number; toolId: string; display: string }[]>;
  people?: ReadonlyMap<string, { id: string; name: string }>;
};

export function itemToBlock(item: Item, children: readonly EditorNode[], ctx: ItemToNodeCtx = {}): EditorNode {
  const isCaseNode = children === CASE_MARK ? true : undefined;  // 실제 판정은 itemsToBlocks 가 한다
  const type: EditorNodeType = /* 아래 itemsToBlocks 가 주입 */ 'step';
  return { id: item.id, type, content: textToInline(item, ctx), props: {}, children };
}

/**
 * 전체 변환. ★ 여기서만 역할(case 여부)을 위치로 계산한다.
 * derive() 의 isCase 와 같은 규칙이어야 하며, 이 동치성이 §12.3 테스트의 핵심이다
 */
export function itemsToBlocks(items: readonly Item[], ctx: ItemToNodeCtx = {}): EditorNode[] {
  const live = items.filter((i) => !i.deletedAt);                 // tombstone 은 화면에 없다
  const byParent = new Map<string | null, Item[]>();
  for (const it of live) {
    const k = it.parentId;
    (byParent.get(k) ?? (byParent.set(k, []), byParent.get(k)!)).push(it);
  }
  for (const list of byParent.values()) list.sort(cmpSibling);    // (sortKey, id) — graph-core 와 동일

  const build = (parentId: string | null, parentIsCase: boolean): EditorNode[] =>
    (byParent.get(parentId) ?? []).map((it, idx) => {
      const isCase = parentId !== null && isBranchParent(byParent, parentId) && !parentIsCase;
      const type: EditorNodeType = isCase ? 'case' : it.kind === 'branch' ? 'branch' : 'step';
      return {
        id: it.id,
        type,
        content: textToInline(it, ctx),
        props:
          type === 'case'
            ? { joinBehavior: it.attrs.joinBehavior ?? 'continue', ordinal: idx, review: false, boundary: 1 }
            : type === 'branch'
              ? { mode: it.attrs.mode ?? 'xor',
                  joinBehavior: summarizeJoin(byParent.get(it.id) ?? []),
                  collapsed: false, review: false, boundary: 1 }
              : { kind: it.kind === 'hold' ? 'hold' : 'task',
                  pain: it.painFlag ?? false,
                  waitFor: it.attrs.waitFor ?? 'none',
                  review: false, boundary: 1 },
        children: build(it.id, isCase),
      };
    });

  return build(null, false);
}

/** 갈래별 joinBehavior 가 갈리면 'mixed'. 2택 칩이 어느 쪽도 선택하지 않는다 (§5.5) */
function summarizeJoin(cases: readonly Item[]): 'continue' | 'end' | 'mixed' {
  if (cases.length === 0) return 'continue';
  const first = cases[0]!.attrs.joinBehavior ?? 'continue';
  return cases.every((c) => (c.attrs.joinBehavior ?? 'continue') === first) ? first : 'mixed';
}

/** title(평문) + toolSpans → 인라인 배열. 겹치지 않는 span 만 칩으로 승격 */
function textToInline(item: Item, ctx: ItemToNodeCtx): EditorInline[] {
  const spans = (ctx.toolSpans?.get(item.id) ?? []).slice().sort((a, b) => a.start - b.start);
  const out: EditorInline[] = [];
  let cur = 0;
  for (const s of spans) {
    if (s.start < cur || s.end > item.title.length) continue;     // 방어: 어긋난 span 은 버린다
    if (s.start > cur) out.push({ t: 'text', text: item.title.slice(cur, s.start) });
    out.push({ t: 'tool', toolId: s.toolId, display: s.display, text: item.title.slice(s.start, s.end) });
    cur = s.end;
  }
  if (cur < item.title.length) out.push({ t: 'text', text: item.title.slice(cur) });
  return out.length ? out : [{ t: 'text', text: '' }];
}
```

**불변식**: `inlineToText(textToInline(item, ctx)) === item.title` — 어떤 `toolSpans`를 주더라도
참이어야 한다. 이게 §12.3의 속성 테스트 1번이다.

### 2.4 `bridge.ts` — BlockNote와 닿는 유일한 150줄

```ts
// editor/blocknote/bridge.ts   ★ @blocknote/* import 허용 구역
import type { AppBlock, AppEditor } from './schema';
import type { EditorInline, EditorNode } from '@workflow/editor-core';

export function fromBlockNote(blocks: readonly AppBlock[]): EditorNode[] {
  return blocks.map((b) => ({
    id: b.id,
    type: b.type as EditorNode['type'],
    content: (b.content as any[] ?? []).map(fromInline),
    props: b.props as EditorNode['props'],
    children: fromBlockNote(b.children ?? []),
  }));
}

function fromInline(c: any): EditorInline {
  if (c.type === 'text')       return { t: 'text', text: c.text };
  if (c.type === 'toolChip')   return { t: 'tool',   toolId: c.props.toolId,   display: c.props.display, text: c.props.text };
  if (c.type === 'personChip') return { t: 'person', personId: c.props.personId, display: c.props.display, text: c.props.text };
  // ★ 모르는 인라인 타입은 텍스트로 강등한다. 버린다는 선택지는 없다
  return { t: 'text', text: typeof c.text === 'string' ? c.text : '' };
}

export function toBlockNote(nodes: readonly EditorNode[]): PartialBlock[] { /* 대칭 */ }
```

`fromInline`의 마지막 줄이 **버전 업그레이드 방어선**이다. 0.53이 새 인라인 타입을 도입해도
텍스트는 살아남는다. "모르면 버린다"가 아니라 "모르면 평문으로 남긴다"가 이 코드베이스 전역 규칙이다.

### 2.5 ★ 변환 손실이 발생할 수 있는 지점 6곳과 방어

| # | 손실 지점 | 왜 생기나 | 방어 | 검증 |
|---|---|---|---|---|
| **L1** | **어댑터가 모르는 도메인 필드** — `assigneeId` `durationBand` `toolIds` `freqLast7d` `automationLevel` `lastConfirmedAt` `attrs.avgWaitH` `attrs.reworkRate` `attrs.returnToItemId` | `blockToItem`이 `Item`을 **처음부터 만들면** 메타 카드 스택이 채운 값이 전부 날아간다. **가장 크고 가장 조용한 손실** | `...(prev ?? EMPTY_ITEM)` 스프레드를 맨 앞에. 어댑터는 `id/parentId/sortKey/kind/title/attrs.{mode,caseLabel,joinBehavior,waitFor}/painFlag` **7개만 소유**한다 | 속성 테스트: 랜덤 `Item[]`에 `blocksToItems(itemsToBlocks(x))` → 소유하지 않는 필드가 **비트 단위로 동일** |
| **L2** | **서식** (굵게·기울임·링크) | `title`이 평문이라 담을 곳이 없다 | `styleSpecs: {}` + `link` 스펙 제외 → **서식이 존재할 수 없다.** 붙여넣은 HTML의 `<b>`는 파싱 단계에서 사라지고 텍스트만 남는다 | `schema.smoke.test.ts` — `editor.getSelectedStyles()`가 항상 `{}` |
| **L3** | **모르는 블록 타입** (`paragraph` `heading` `table` `image`) | 붙여넣기·이전 버전 문서·BlockNote 업그레이드 | ① 스키마에서 제거 ② `structureNormalizer`가 잔존분을 `step`으로 변환하며 **텍스트를 그대로 옮긴다** ③ `image`는 `alt` 텍스트를 `step`으로 | §8 붙여넣기 픽스처 |
| **L4** | **불법 중첩** — `case`가 `branch` 밖에, `step`이 `branch`의 직계 자식 | 드래그 앤 드롭, Tab, 붙여넣기 | `structureNormalizer`가 **ID를 보존한 채** 타입만 바꾼다. `case` → `step`(조건 텍스트가 제목이 됨), `branch`의 직계 `step` → 새 `case`로 감싼다 | §5.6 픽스처 12건 |
| **L5** | **도구 칩과 원문의 어긋남** | 칩이 `display`만 갖고 있으면 `엑셀`로 확정한 `액셀`이 `엑셀`로 바뀐다 = 사용자가 쓴 글자가 변형됨 | `props.text`에 **원문 부분문자열**을 그대로 담고, `inlineToText`가 `display`가 아니라 `text`를 쓴다 | 속성 테스트 1 (`inlineToText ∘ textToInline = title`) |
| **L6** | **`sortKey` 재발급 폭풍** | 매 변환마다 키를 새로 만들면 문서 전체가 매 키 입력마다 `reorder_item` op이 된다 | `assignSortKeys`는 **이전 키가 여전히 형제 순서와 모순 없으면 재사용**한다 (§2.6) | 불변식 테스트: 텍스트만 바꾼 트리에서 emit되는 op 중 `reorder_item`/`move_item`이 **0개** |

**L1을 다시 강조한다.** 이 6개 중 실제로 제품을 망가뜨리는 것은 L1 하나다. 나머지는 QA에서
눈에 보이지만, L1은 "메타데이터를 다 채웠는데 며칠 뒤 보니 담당자가 비어 있다"로 나타나고
사용자는 원인을 말하지 못한다. **어댑터가 `Item`을 만드는 게 아니라 `Item`을 갱신한다**는
문장이 이 문서에서 가장 실무적으로 중요한 한 줄이다.

### 2.6 `sortKey` — 재계산 시점과 규칙

`fractional-indexing-jittered`(ARCHITECTURE §1) 기반. base62이고 비교는 **바이트 순서**다
(`compareSortKey`를 graph-core에서 그대로 import 해서 쓴다 — 두 벌 만들면 조용히 어긋난다).

```ts
// packages/editor-core/src/sortkey.ts
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing-jittered';
import { compareSortKey } from '@workflow/graph-core';

/**
 * 형제 목록에 sortKey 를 배정한다.
 *
 * 규칙 (순서대로 적용):
 *  R1. 이전 키가 있고, 그 키가 앞/뒤 확정 키 사이에 놓이면 → 그대로 쓴다   ← 대부분
 *  R2. 아니면 → 앞뒤 사이에 새로 만든다
 *  R3. 연속된 미확정 구간은 generateNKeysBetween 으로 한 번에               ← 붙여넣기 경로
 *
 * ★ 이 함수가 "재계산 시점"의 전부다. 다른 어디에서도 sortKey 를 만들지 않는다.
 */
export function assignSortKeys(
  siblings: readonly { id: string }[],
  parentId: string | null,
  ctx: { prevById: ReadonlyMap<string, { parentId: string | null; sortKey: string }> },
  gen = keysBetween,
): string[] {
  const n = siblings.length;
  const out: (string | null)[] = new Array(n).fill(null);

  // 1차: 부모가 그대로이고 키가 있는 것만 후보로 채택
  for (let i = 0; i < n; i++) {
    const prev = ctx.prevById.get(siblings[i]!.id);
    if (prev && prev.parentId === parentId && prev.sortKey) out[i] = prev.sortKey;
  }
  // 2차: 단조 증가를 깨는 후보를 떨어뜨린다 (LIS 를 쓰지 않는다 — 왼쪽 우선 그리디로 충분하고 결정적이다)
  let last: string | null = null;
  for (let i = 0; i < n; i++) {
    if (out[i] === null) continue;
    if (last !== null && compareSortKey(out[i]!, last) <= 0) out[i] = null;
    else last = out[i];
  }
  // 3차: 빈 구간을 한 번에 채운다
  for (let i = 0; i < n; ) {
    if (out[i] !== null) { i++; continue; }
    let j = i; while (j < n && out[j] === null) j++;
    const before = i > 0 ? out[i - 1] : null;
    const after  = j < n ? out[j]     : null;
    const keys = gen(before, after, j - i);
    for (let k = i; k < j; k++) out[k] = keys[k - i]!;
    i = j;
  }
  return out as string[];
}

export const keysBetween = (a: string | null, b: string | null, n: number): string[] =>
  n === 1 ? [generateKeyBetween(a, b)] : generateNKeysBetween(a, b, n);
```

**언제 재계산되는가 — 실제로는 4번뿐이다.**

| 상황 | 재발급되는 키 |
|---|---|
| 타이핑 (텍스트만 변경) | **0개** — R1이 전부 통과 |
| Enter로 형제 삽입 | 새 블록 1개 |
| Tab/Shift+Tab (부모 변경) | 이동한 블록 1개 (부모가 달라져 R1이 탈락) |
| 드래그로 순서 변경 | 이동한 블록 1개 (단조성이 깨져 2차에서 탈락) |
| 붙여넣기 N줄 | N개 (R3이 한 번에) |

`jittered` 변형을 쓰는 이유는 동시 삽입 충돌 확률(~1/47,000)이지만, 부작용으로 **같은 입력에
같은 키가 나오지 않는다.** 그래서 어댑터 테스트는 `keygen`을 주입 가능하게 만들어
결정적 스텁(`(a,b,n) => [...]`)을 쓴다. 프로덕션 코드에 랜덤이 남아 있고 테스트가
결정적인 것 — 이게 `keygen`을 인자로 뺀 유일한 이유다.

**DB 제약과의 정합**: `uniqueIndex('items_sibling_order').on(docId, parentId, sortKey)`가 걸려 있다.
2차 그리디가 중복 키를 절대 남기지 않는지가 불변식 테스트 항목이다 (`sortkey.invariant.test.ts`).

### 2.7 op 생성 — 어댑터는 op을 만들지 않는다

D-032가 "모든 변경을 op으로"라고 못박았으므로, 에디터의 출력은 `Item[]`이 아니라 `Op[]`여야 한다.
그런데 **어댑터가 op을 만들면 어댑터가 순수하지 않게 된다** (이전 상태를 알아야 하고, 순서에
의존하고, 테스트가 폭발한다). 그래서 한 겹을 더 나눈다.

```
BlockNote onChange
  → fromBlockNote(editor.document)            (bridge, BlockNote 의존)
  → blocksToItems(nodes, { prevById })        (adapter, 순수)
  → diffToOps(prevItems, nextItems)           (순수, 별도 모듈)
  → zustand 적용 + 아웃바운드 큐 (800ms 디바운스, ARCHITECTURE §6)
```

```ts
// packages/editor-core/src/diff.ts
import type { Item } from '@workflow/graph-core';
import type { Op } from '@workflow/graph-core';

/** 순수. 같은 입력이면 같은 op 배열이 같은 순서로 나온다 */
export function diffToOps(prev: readonly Item[], next: readonly Item[]): Op[] {
  const p = new Map(prev.map((i) => [i.id, i]));
  const ops: Op[] = [];

  for (const n of next) {
    const o = p.get(n.id);
    if (!o) {
      ops.push({ type: 'insert_item', id: n.id, parentId: n.parentId, sortKey: n.sortKey, kind: n.kind, title: n.title });
      if (Object.keys(n.attrs).length) ops.push({ type: 'set_attr', id: n.id, patch: n.attrs });
      if (n.painFlag) ops.push({ type: 'toggle_pain', id: n.id, painFlag: true });
      continue;
    }
    // ★ 순서가 중요하다: 구조 → 타입 → 내용. 서버 리듀서가 같은 순서로 적용한다
    if (o.parentId !== n.parentId)      ops.push({ type: 'move_item', id: n.id, parentId: n.parentId, sortKey: n.sortKey });
    else if (o.sortKey !== n.sortKey)   ops.push({ type: 'reorder_item', id: n.id, sortKey: n.sortKey });
    if (o.kind !== n.kind)              ops.push({ type: 'set_kind', id: n.id, kind: n.kind });
    if (o.title !== n.title)            ops.push({ type: 'set_title', id: n.id, title: n.title });
    if (!shallowEqAttrs(o.attrs, n.attrs)) ops.push({ type: 'set_attr', id: n.id, patch: diffAttrs(o.attrs, n.attrs) });
    if ((o.painFlag ?? false) !== (n.painFlag ?? false))
      ops.push({ type: 'toggle_pain', id: n.id, painFlag: n.painFlag ?? false });
    p.delete(n.id);
  }
  // 남은 것 = 사라진 것 → tombstone (D-032). 하드 삭제하지 않는다
  for (const id of p.keys()) ops.push({ type: 'delete_item', id });
  return ops;
}
```

`set_title`이 **매 키 입력마다** 발생하는 것은 의도된 설계다. 아웃바운드 큐가 800ms 디바운스
구간에서 같은 `(type, id)`를 접어 마지막 하나만 보낸다(`coalesce`). 큐에서 접는 이유는,
op 로그가 undo 단위이기도 하므로 **접기를 어댑터가 하면 undo가 글자 단위로 쪼개진다.**

### 2.8 어댑터가 순수 함수여야 하는 이유

1. **`items`가 SoT이고 ProseMirror JSON이 아니기 때문**(D-034). 어댑터가 상태를 가지면 그 상태가 세 번째 진실이 되고, 두 진실 사이 변환기가 자기 진실을 갖는 순간 split brain은 시간 문제다
2. **에디터 상태 손상 복구가 어댑터에 걸려 있다**(STATES §9). 복구 경로는 `items` 스냅샷 → `itemsToBlocks` → 재마운트다. 이 경로가 부작용을 가지면 **복구가 손상을 재현한다**
3. **워커와 RSC에서 같은 코드를 돌린다.** 공유 페이지 `/s/[id]`는 서버에서 `itemsToBlocks`로 아웃라인 HTML을 만든다. DOM·React 의존이 있으면 여기서 못 쓴다
4. **테스트 비용.** ProseMirror를 띄우지 않고 `node --test`로 어댑터 전체를 검증할 수 있다 — graph-core가 이미 증명한 규율이다

### 2.9 테스트 전략

`packages/editor-core/test/` — `node --test`, 외부 러너 없음 (graph-core와 동일).

| 종류 | 내용 | 개수 |
|---|---|---|
| **왕복 속성** | 랜덤 `Item[]` 1,000건 → `blocksToItems(itemsToBlocks(x))` → `x`와 **소유하지 않는 필드가 동일**, 구조·제목 동일 | 1,000 |
| **인라인 무손실** | 랜덤 `title` + 랜덤 `toolSpans` → `inlineToText(textToInline(...)) === title` | 1,000 |
| **★ 골든 픽스처 재사용** | `graph-core/src/__fixtures__/golden.ts`의 36건에 대해 `derive(items).topologyHash === derive(blocksToItems(itemsToBlocks(items))).topologyHash` | 36 |
| **sortKey 불변식** | 형제 내 중복 없음 / 단조 증가 / 텍스트만 변경 시 `reorder_item` 0개 / 1,000회 랜덤 삽입 후에도 키 길이 < 40 | 12 |
| **정규화** | §5.6 불법 구조 12종 → 정규화 후 ID 보존 + 텍스트 보존 | 12 |
| **diff** | op 순서 결정성 / tombstone / attrs 부분 패치 | 15 |

**골든 픽스처 재사용이 이 표의 핵심이다.** 어댑터의 정확성 기준은 "예쁜 트리를 만드는가"가
아니라 **"`derive()`가 같은 그림을 그리는가"**다. graph-core가 36건의 아웃라인 → 기대 그래프를
이미 갖고 있으므로, 어댑터는 그 36건을 통과시키기만 하면 된다.
`isCase` 판정을 어댑터에서 잘못 구현하면 이 테스트가 정확히 거기서 깨진다.

---

## 3. 한국어 IME — 구현 수준 명세

STATES §3이 원칙을 확정했다: *조합 중 파생·리렌더·자동저장 큐 플러시·슬래시 메뉴 전부 정지,
시각적 표시는 하지 않는다, `aria-live`도 침묵.* 여기서는 그 원칙의 **코드**를 쓴다.

### 3.1 조합 중에 도는 우리 코드를 0에 가깝게 만드는 것이 설계 목표다

가장 흔한 실패 원인은 "조합 중에 무언가를 하지 말자"고 결심한 뒤 **그 결심을 지키는 코드가
조합 중에 도는 것**이다. `if (composing) return`을 매 트랜잭션마다 실행하는 플러그인이 10개면
조합 중에 10개의 플러그인이 돈다. 각각은 무해하지만, 그중 하나가 `DecorationSet`을 새로 만들면
DOM이 교체되고 조합이 죽는다.

그래서 규칙을 두 층으로 둔다.

- **층 1 (구조적)**: 조합 중에 상태가 바뀔 수 있는 플러그인은 `apply`에서 `tr.docChanged`가
  거짓이면 **이전 객체를 그대로 반환**한다. 데코레이션은 `key`를 명시해 DOM 재사용을 보장한다
- **층 2 (게이트)**: 그 위에 `isComposing()` 게이트를 얹는다. 층 1이 없으면 층 2는 늦다 —
  게이트는 리렌더를 막지만 이미 만들어진 새 `DecorationSet`은 막지 못한다

### 3.2 무엇을 신뢰하는가 — `view.composing` vs 자체 ref

**결론: 어느 하나도 단독으로 신뢰하지 않는다. 3중 OR를 쓴다.**

| 소스 | 참인 구간 | 못 잡는 것 |
|---|---|---|
| `view.composing` | ProseMirror가 조합으로 판단하는 구간 | ProseMirror는 `compositionend` 후 `endComposition`을 **타이머로** 마무리한다. 그 사이 창이 있다 |
| 자체 `compositionstart/end` ref | DOM 이벤트 그대로 | macOS 2벌식은 **음절마다** `compositionend`를 쏜다. 음절 사이 수 ms 동안 `false`가 된다 |
| `event.isComposing` | 그 이벤트 시점 | 이벤트가 없는 경로(타이머·`onChange`)에서 못 쓴다 |

```ts
// editor/blocknote/ime.ts
export type ImeState = {
  /** compositionstart ~ compositionend */
  raw: boolean;
  /** 마지막 compositionend 시각 */
  endedAt: number;
};

const GRACE_MS = 60;   // ★ 음절 경계 유예. 아래 근거 참조

export function createImeTracker(view: EditorView) {
  const state: ImeState = { raw: false, endedAt: 0 };
  const listeners = new Set<(composing: boolean) => void>();
  let resumeTimer: number | undefined;

  const dom = view.dom;

  const onStart = () => {
    state.raw = true;
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = undefined; }
    emit(true);
  };

  // compositionupdate 는 상태를 바꾸지 않는다. 걸어두는 이유는 단 하나 —
  // 일부 안드로이드 IME 가 compositionstart 없이 update 만 쏘는 경우의 보정
  const onUpdate = () => { if (!state.raw) { state.raw = true; emit(true); } };

  const onEnd = () => {
    state.raw = false;
    state.endedAt = Date.now();
    // ★ 여기서 바로 재개하지 않는다.
    //   Chrome/Safari 는 compositionend 다음에 확정 문자를 넣는 input 이벤트를 쏜다.
    //   그 전에 derive/리렌더를 돌리면 "마지막 글자 유실"이 정확히 여기서 난다.
    //   rAF 한 번 + GRACE_MS 를 기다려 다음 compositionstart 가 오지 않는 것을 확인한 뒤 재개한다.
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(() => {
      requestAnimationFrame(() => {
        resumeTimer = undefined;
        if (!isComposing()) emit(false);
      });
    }, GRACE_MS);
  };

  const isComposing = (): boolean =>
    state.raw || view.composing || Date.now() - state.endedAt < GRACE_MS;

  dom.addEventListener('compositionstart', onStart);
  dom.addEventListener('compositionupdate', onUpdate);
  dom.addEventListener('compositionend', onEnd);

  return {
    isComposing,
    subscribe: (fn: (c: boolean) => void) => (listeners.add(fn), () => listeners.delete(fn)),
    destroy: () => {
      dom.removeEventListener('compositionstart', onStart);
      dom.removeEventListener('compositionupdate', onUpdate);
      dom.removeEventListener('compositionend', onEnd);
      if (resumeTimer) clearTimeout(resumeTimer);
    },
  };
  function emit(c: boolean) { for (const fn of listeners) fn(c); }
}
```

**`GRACE_MS = 60`의 근거.** macOS 2벌식으로 `한국`을 치면 이벤트가 이렇게 나온다.

```
compositionstart  ㅎ
compositionupdate 하
compositionupdate 한
compositionend    한        ← 여기서 raw=false
compositionstart  ㄱ        ← 보통 1~15ms 뒤. 사용자가 멈춘 게 아니다
...
```

`compositionend`에서 즉시 재개하면 **어절마다 파생·리렌더가 돌고**, 그 리렌더가 다음
`compositionstart`와 경합한다. 사용자에게는 "빠르게 치면 글자가 가끔 씹힌다"로 나타난다.
60ms는 (a) 인접 음절 사이 간격(측정 중앙값 8ms, p95 35ms)보다 넉넉히 크고 (b) `derive()` 재개가
사람이 인지하는 지연(100ms, STATES §10)에 들어가는 범위다.
**이 상수는 임의값이 아니므로 바꿀 때 근거를 남긴다.**

### 3.3 조합 게이트를 실제로 거는 지점 4곳

```tsx
// EditorClient.tsx (요지)
const ime = useRef<ReturnType<typeof createImeTracker>>();
const dirty = useRef(false);

useEffect(() => {
  const view = editor.prosemirrorView;
  if (!view) return;
  ime.current = createImeTracker(view);
  const off = ime.current.subscribe((composing) => {
    if (!composing && dirty.current) { dirty.current = false; flush(); }   // ★ 재개는 여기서만
  });
  return () => { off(); ime.current?.destroy(); };
}, [editor]);

editor.onChange(() => {
  if (ime.current?.isComposing()) { dirty.current = true; return; }        // (1) 파생
  flush();
});
```

| # | 게이트 지점 | 조합 중 동작 | 재개 |
|---|---|---|---|
| 1 | **`derive()` + 캔버스 갱신** | `dirty=true`만 세우고 반환 | `compositionend` + 60ms + rAF |
| 2 | **자동저장 큐 적재** | op을 만들지 않는다. **큐에 넣지도 않는다** (SCREENS §3: `compositionend` 전에는 큐에도 안 넣는다) | 동일 |
| 3 | **슬래시 메뉴 / 인라인 제안 / 도구 배지 스캔** | 스캔 자체를 건너뛴다 | `compositionend` 후 1회 전체 재스캔 (해당 블록만) |
| 4 | **`aria-live` 방출** | 큐에 쌓기만 (ACCESSIBILITY §3) | `compositionend` + 100ms, 1회로 합쳐 방출 |

**2번이 흔히 빠진다.** 큐에 넣지 않는 이유는 저장 자체가 위험해서가 아니라, 큐 적재가
zustand 상태 변경 → React 리렌더 → 상단바 `저장 중` 텍스트 교체를 유발하고, 그 리렌더가
에디터를 리렌더하는 경로가 하나라도 있으면 조합이 끊기기 때문이다. **"저장 표시가 조합을 죽인다"**는
문장이 비현실적으로 들리지만 실제로 가장 자주 나는 회귀다.

### 3.4 `inputRules`로 슬래시 메뉴·인라인 제안을 처리하는 방법

**`keydown.key`를 쓰지 않는다** (D-034). 조합 중 `keyCode === 229`가 들어오면 `/` 팔레트와 Enter
분기가 동시에 오작동한다. 그런데 **`inputRules`만으로도 부족하다.** 정직하게 쓴다.

`inputRules`는 `handleTextInput`에 걸린다. 그런데 한국어 조합 중에는 브라우저가
`handleTextInput`을 쏘지 않거나(Chrome), 조합 중간 문자열로 쏜다(일부 Android). 즉:

| 트리거 | 조합을 타는가 | 경로 |
|---|---|---|
| `/` 슬래시 메뉴 | **아니오** — `/`는 2벌식에서 한글 키가 아니라 조합을 즉시 확정시키고 통과한다 | `inputRules` 로 충분 |
| `만약` / `아니면` / `승인되면` | **예** — 한글이므로 반드시 조합을 거친다 | `inputRules` 로 **잡히지 않는다** → `compositionend` 스캔 |

그래서 **한 개의 순수 감지 함수를 두 경로가 공유**한다.

```ts
// packages/editor-core/src/suggest.ts — 순수. DOM·PM 의존 0
export type SuggestKind = 'branch' | 'else' | 'hold';
export type SuggestHit = { kind: SuggestKind; at: number; len: number; label: string };

const TRIGGERS: { kind: SuggestKind; re: RegExp; label: string }[] = [
  { kind: 'branch', re: /(^|[\s(“"'])(만약|만일)(?=[\s가-힣])/,                      label: '갈래로 바꿀까요?' },
  { kind: 'branch', re: /([가-힣]{2,})(인\s?경우|일\s?경우|이면|하면)(?=[\s,]|$)/,   label: '갈래로 바꿀까요?' },
  { kind: 'else',   re: /(^|[\s(])(아니면|그렇지\s?않으면|그 외에는)(?=[\s가-힣])/,  label: '다른 경우로 넣을까요?' },
  { kind: 'hold',   re: /(승인되면|결재\s?나면|답(?:장|변)?\s?오면|회신\s?오면|입금\s?되면)/, label: '기다리는 시간으로 바꿀까요?' },
];

/** 블록의 평문 전체 + 캐럿 오프셋 → 제안 1건 또는 null. 순수·결정적 */
export function detectSuggestion(text: string, caret: number, ctx: SuggestCtx): SuggestHit | null { … }
```

```ts
// plugins/suggestion.ts — ASCII 경로(inputRules)와 한글 경로(compositionend)를 붙인다
import { inputRules, InputRule } from 'prosemirror-inputrules';

/** ASCII·기호 경로만 담당. 한글은 여기 오지 않는다 */
export const slashRule = new InputRule(/(?:^|\s)\/$/, (state, _m, start, end) => {
  if (imeTracker.isComposing()) return null;            // ★ 안전망. 조합 중이면 아무것도 안 한다
  if (!atLineStartOrAfterSpace(state, start)) return null;
  openSlashMenu(state, end);
  return null;                                          // ★ 문서를 바꾸지 않는다. '/' 는 그대로 남는다
});
```

**`InputRule` 핸들러가 `null`을 반환하는 것이 포인트다.** `inputRules`를 텍스트 치환에 쓰지
않고 **감지 훅**으로만 쓴다. 치환을 하면 조합 확정 직후 문서가 바뀌고, 그 순간이 IME가 가장
취약한 시점이다. 슬래시 메뉴는 `/`를 지우지 않고 메뉴만 띄우며, 명령 실행 시점에 `/`부터
쿼리까지를 한 트랜잭션으로 지운다.

한글 경로:

```ts
// 같은 플러그인의 DOM 핸들러
props: {
  handleDOMEvents: {
    compositionend: (view) => {
      // ★ 여기서 즉시 스캔하지 않는다. 확정 문자가 아직 doc 에 안 들어왔을 수 있다
      queueMicrotask(() => requestAnimationFrame(() => scanCurrentBlock(view)));
      return false;                                     // ★ 반드시 false. 이벤트를 소비하면 IME 가 깨진다
    },
  },
}
```

### 3.5 Enter 처리 — 조합 중 Enter와 블록 분리 Enter

한국어에서 조합 중 Enter는 **한자 변환 후보 확정**이거나(macOS·Windows 공통 한자 입력),
**MS-IME의 후보 확정**이다. 이걸 블록 분리로 처리하면 사용자는 한자를 넣으려다 줄이 갈라진다.

**해법: 커맨드가 `false`를 반환한다. `preventDefault`를 하지 않는다.**

```ts
// commands/enter.ts
export const enterCommand: Command = (state, dispatch, view) => {
  // ★★ 이 한 줄이 전부다.
  //    true 를 반환하면 ProseMirror 가 preventDefault 를 부르고 IME 가 Enter 를 못 받는다.
  //    false 를 반환하면 이벤트가 브라우저/IME 로 그대로 흘러가 후보가 확정된다.
  if (imeTracker.isComposing()) return false;
  return splitOrCreate(state, dispatch, view);
};
```

세 겹의 방어가 겹친다.

1. **prosemirror-view 자체 방어** — `keydown` 핸들러가 `keyCode === 229`와 `view.composing`에서 조기 반환한다. macOS Chrome 한글은 대부분 여기서 걸러진다
2. **우리 게이트** — `imeTracker.isComposing()`. 1번이 놓치는 `compositionend` 직후 60ms 창을 막는다
3. **BlockNote 기본 keymap 순서** — 우리 커맨드를 `Enter` 체인 **맨 앞**에 넣어, `false`를 반환하면 뒤 커맨드도 안 돌게 `chainCommands` 대신 명시적 조기 반환을 쓴다

**하면 안 되는 것**: `e.key === 'Process'` 검사, `e.keyCode === 229` 검사를 우리 코드에서 직접
하는 것. 229는 Windows에서만 나오고 macOS Safari에서는 안 나온다. **키코드로 조합을 판정하지
않는다** — 조합은 composition 이벤트로만 판정한다 (D-034).

### 3.6 Backspace로 블록 병합 — 조합 상태

```ts
// commands/backspace.ts
export const backspaceCommand: Command = (state, dispatch, view) => {
  if (imeTracker.isComposing()) return false;    // ← 조합 중 Backspace 는 자모 삭제다. 절대 가로채지 않는다
  const { empty, $from } = state.selection;
  if (!empty || $from.parentOffset !== 0) return false;   // 줄 시작이 아니면 기본 동작
  return mergeWithPrevious(state, dispatch, view);
};
```

조합 중 Backspace의 의미는 IME마다 다르다.

| 환경 | 조합 중 Backspace |
|---|---|
| macOS 2벌식 | **자모 1개** 삭제 (`한` → `하` → `ㅎ` → 없음) |
| Windows MS-IME 한글 | 자모 1개 삭제 (동일) |
| Android Gboard 한국어 | **음절 전체** 삭제하는 기기가 있다 |
| iOS 한국어 | 자모 1개 |

우리가 이 차이를 흉내 낼 필요는 전혀 없다 — **가로채지 않으면 IME가 알아서 한다.**
문제는 "블록 병합"만 우리가 하고 싶다는 것인데, 병합이 필요한 상황(빈 블록/줄 맨 앞)은
정의상 조합 중일 수 없다. 조합 중이면 조합 문자열이 커서 앞에 있기 때문이다.
따라서 **`isComposing()`이면 무조건 `false`**가 완전한 규칙이다.

한 가지 예외 상황: **조합 문자열이 있는 상태에서 블록이 통째로 지워지는 경로**(⌘A → Backspace,
드래그 선택 후 입력). 이때 ProseMirror가 노드를 지우면 조합 중이던 DOM 텍스트 노드가 사라져
브라우저가 `compositionend`를 늦게 쏘거나 아예 안 쏜다. 방어:

```ts
// 선택이 비어 있지 않은 모든 파괴적 커맨드 앞에
if (imeTracker.isComposing()) {
  view.dom.blur(); view.dom.focus();      // 조합을 안전하게 확정시킨다
  return false;                            // 이번 이벤트는 흘려보내고, 다음 입력에서 정상 동작
}
```

`blur()/focus()`가 조합을 확정시키는 것은 모든 주요 브라우저에서 보장된다. **취소가 아니라
확정**이므로 사용자가 친 글자는 남는다. 탭 전환·창 전환 시 조합 상태 복원 요구
(ACCESSIBILITY §10 체크리스트)도 같은 메커니즘으로 처리한다 — `visibilitychange(hidden)`에서
조합 중이면 `blur()`로 **안전 확정**하고, `sendBeacon` 플러시는 그 뒤에 한다.

### 3.7 플랫폼 차이 정리

| | macOS 2벌식 (Chrome/Safari) | Windows MS-IME 한글 (Chrome/Edge) | Android Gboard | iOS |
|---|---|---|---|---|
| `keydown.keyCode` (조합 중) | 실제 키코드 또는 229 (Safari는 안 옴) | **항상 229** | 항상 229 | 229 |
| `compositionend` 빈도 | **음절마다** | 음절마다 | **어절/단어마다** | 음절마다 |
| Enter의 의미 (조합 중) | 한자 후보 확정 | **후보 창 확정** | 대개 없음 | 후보 확정 |
| `beforeinput.inputType` | `insertCompositionText` | `insertCompositionText` | 종종 `insertText`로 옴 | `insertCompositionText` |
| 조합 취소 (Esc) | 조합 취소 | 조합 취소 | 없음 | 없음 |
| 함정 | `compositionend`가 잦아 재개 타이밍이 핵심 → `GRACE_MS` | 229 때문에 `keydown` 기반 로직이 전부 오작동 | `compositionstart` 없이 `compositionupdate`만 오는 기기 | 확대/스크롤과 겹칠 때 조합 유실 |

**우선순위**: macOS 2벌식 > Windows MS-IME > iOS > Android.
사내 전 직원 대상이고 데스크톱 편집이 주 사용이므로 CI는 앞의 둘만 자동화하고, 모바일은
ACCESSIBILITY §10 수동 체크리스트로 남긴다. **자동화하지 않는다는 결정을 명시해 둔다** —
안 하는 것보다 나쁜 건 한다고 믿는 것이다.

한 가지 더: `Esc`. ACCESSIBILITY §1이 *"조합 중이면 IME가 먼저 소비, 가로채지 않음"*으로
확정했다. 구현은 Enter와 동일하다.

```ts
export const escapeCommand: Command = (_s, _d, view) => {
  if (imeTracker.isComposing()) return false;   // ← macOS/Windows 모두 조합 취소가 IME 몫이다
  return closeTopmostOverlayOrBlur(view);
};
```

### 3.8 ★ Playwright + CDP `Input.imeSetComposition` 회귀 테스트 (CI 필수)

ARCHITECTURE §3과 ACCESSIBILITY §10이 CI 필수로 지정한 항목이다. 전문을 싣는다.

```ts
// e2e/ime.spec.ts
// 실행: npx playwright test e2e/ime.spec.ts --project=chromium
// ★ Chromium 전용. CDP Input.imeSetComposition 은 WebKit/Firefox 에 없다.
//   그래서 이 파일은 "Chromium 에서 회귀하지 않음"만 보증한다. Safari 는 수동 QA 몫이다.
import { test, expect, type Page, type CDPSession } from '@playwright/test';

/* ────────────────────────────────────────────────────────────────────────────
 * 헬퍼
 * ──────────────────────────────────────────────────────────────────────────── */

/** 한 음절을 조합 과정 그대로 재현한다. 예: ['ㅎ','하','한'] → 확정 '한' */
async function composeSyllable(cdp: CDPSession, steps: string[]) {
  for (const s of steps) {
    await cdp.send('Input.imeSetComposition', {
      text: s,
      selectionStart: s.length,
      selectionEnd: s.length,
    });
  }
  // 확정. insertText 는 compositionend + textInput 을 발생시킨다
  await cdp.send('Input.insertText', { text: steps[steps.length - 1]! });
}

/** '한글' 처럼 여러 음절을 이어서 친다. macOS 2벌식과 동일하게 음절마다 조합이 끊긴다 */
async function typeHangul(cdp: CDPSession, plan: string[][]) {
  for (const syllable of plan) await composeSyllable(cdp, syllable);
}

/** 조합을 확정하지 않은 채로 남긴다 — 조합 중 상태를 만드는 유일한 방법 */
async function startComposition(cdp: CDPSession, steps: string[]) {
  for (const s of steps) {
    await cdp.send('Input.imeSetComposition', { text: s, selectionStart: s.length, selectionEnd: s.length });
  }
}

const HANGUL = '한글';
const PLAN_HANGUL = [['ㅎ', '하', '한'], ['ㄱ', '그', '글']];

async function openDoc(page: Page) {
  await page.goto('/workflows/e2e-ime-fixture');
  const editor = page.locator('[data-testid="outline-editor"] [contenteditable="true"]');
  await editor.click();
  await expect(editor).toBeFocused();
  return editor;
}

const firstBlockText = (page: Page) =>
  page.locator('[data-testid="outline-editor"] .bn-block-content').first().innerText();

/* ────────────────────────────────────────────────────────────────────────────
 * 1. 마지막 글자 유실 — 이 파일의 존재 이유
 * ──────────────────────────────────────────────────────────────────────────── */

test('한글 입력 후 Enter — 마지막 글자가 유실되지 않는다', async ({ page }) => {
  const editor = await openDoc(page);
  const cdp = await page.context().newCDPSession(page);

  await typeHangul(cdp, PLAN_HANGUL);
  expect(await firstBlockText(page)).toBe(HANGUL);

  await page.keyboard.press('Enter');

  // 블록이 2개가 되고, 첫 블록 텍스트가 온전해야 한다
  const blocks = page.locator('[data-testid="outline-editor"] .bn-block-content');
  await expect(blocks).toHaveCount(2);
  expect((await blocks.nth(0).innerText()).trim()).toBe(HANGUL);   // ★ '한' 이 아니라 '한글'
});

test('조합 중 Enter 는 블록을 분리하지 않는다 (후보 확정용 Enter)', async ({ page }) => {
  await openDoc(page);
  const cdp = await page.context().newCDPSession(page);

  await startComposition(cdp, ['ㅎ', '하', '한']);   // ← 확정하지 않음
  const before = await page.locator('.bn-block-content').count();

  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);

  expect(await page.locator('.bn-block-content').count()).toBe(before);  // 블록 수 불변
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. 조합 중 우리 코드가 돌지 않는다
 * ──────────────────────────────────────────────────────────────────────────── */

test('조합 중 자동저장 타이머가 발화해도 조합이 끊기지 않는다', async ({ page }) => {
  await openDoc(page);
  const cdp = await page.context().newCDPSession(page);

  await typeHangul(cdp, PLAN_HANGUL);          // 더티 상태를 만든다
  await startComposition(cdp, ['ㅇ', '이', '입']);

  await page.waitForTimeout(1200);             // 자동저장 디바운스(800ms)를 확실히 넘긴다

  // 큐에 들어가지도 않아야 한다 — 상태 표시가 '저장 중' 으로 바뀌지 않는다
  await expect(page.getByTestId('save-state')).not.toHaveText(/저장 중/);

  await cdp.send('Input.insertText', { text: '입' });
  expect(await firstBlockText(page)).toBe('한글입');   // ★ 조합이 살아남았다
});

test('조합 중 캔버스 재레이아웃이 트리거되지 않는다', async ({ page }) => {
  await openDoc(page);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => { (window as any).__elkRuns = 0; });   // 테스트 빌드에서 계측 훅 노출

  await startComposition(cdp, ['ㄱ', '가', '간']);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as any).__elkRuns)).toBe(0);

  await cdp.send('Input.insertText', { text: '간' });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).__elkRuns)).toBeGreaterThan(0);
});

test('조합 중 / 입력이 슬래시 메뉴를 오작동시키지 않는다 (keyCode 229)', async ({ page }) => {
  await openDoc(page);
  const cdp = await page.context().newCDPSession(page);

  await startComposition(cdp, ['ㅅ', '슬']);
  await page.keyboard.press('Slash');
  await page.waitForTimeout(120);

  // 조합 중에는 열리지 않는다
  await expect(page.getByRole('listbox', { name: /명령/ })).toHaveCount(0);
});

test('조합 중 Esc 는 IME 가 먼저 소비하고 다이얼로그가 닫히지 않는다', async ({ page }) => {
  await openDoc(page);
  const cdp = await page.context().newCDPSession(page);
  await page.getByRole('button', { name: '공유' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.locator('[contenteditable="true"]').click();
  await startComposition(cdp, ['ㅎ', '하']);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);

  await expect(page.getByRole('dialog')).toBeVisible();     // ★ 안 닫힌다
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. 인라인 제안 · 도구 배지는 조합이 끝난 뒤에만
 * ──────────────────────────────────────────────────────────────────────────── */

test('"만약" 은 조합이 끝난 뒤 제안 칩을 띄운다', async ({ page }) => {
  await openDoc(page);
  const cdp = await page.context().newCDPSession(page);

  await startComposition(cdp, ['ㅁ', '마', '만']);
  await expect(page.getByTestId('suggest-chip')).toHaveCount(0);   // 조합 중엔 없다

  await composeSyllable(cdp, ['ㅁ', '마', '만']);
  await composeSyllable(cdp, ['ㅇ', '야', '약']);
  await cdp.send('Input.insertText', { text: ' ' });

  await expect(page.getByTestId('suggest-chip')).toBeVisible();
  await expect(page.getByTestId('suggest-chip')).toContainText('갈래로 바꿀까요?');
});

test('도구 배지는 조합 중 나타나지 않는다', async ({ page }) => {
  await openDoc(page);
  const cdp = await page.context().newCDPSession(page);

  await startComposition(cdp, ['ㅇ', '어', '엑']);
  await expect(page.getByTestId('tool-badge')).toHaveCount(0);

  await composeSyllable(cdp, ['ㅇ', '어', '엑']);
  await composeSyllable(cdp, ['ㅅ', '세', '셀']);
  await cdp.send('Input.insertText', { text: '에 정리' });

  await expect(page.getByTestId('tool-badge')).toHaveText('Excel?');
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. 조합과 구조 편집이 겹치는 경계
 * ──────────────────────────────────────────────────────────────────────────── */

test('조합 중 Backspace 는 자모를 지우지 블록을 병합하지 않는다', async ({ page }) => {
  const editor = await openDoc(page);
  const cdp = await page.context().newCDPSession(page);

  await typeHangul(cdp, [['ㅊ', '처', '첫']]);
  await page.keyboard.press('Enter');
  await startComposition(cdp, ['ㄷ', '두']);

  await page.keyboard.press('Backspace');
  await page.waitForTimeout(60);

  await expect(page.locator('.bn-block-content')).toHaveCount(2);   // 병합되지 않았다
});

test('탭 전환 시 조합이 안전 확정된다 (글자가 사라지지 않는다)', async ({ page, context }) => {
  await openDoc(page);
  const cdp = await page.context().newCDPSession(page);
  await startComposition(cdp, ['ㅇ', '아', '안']);

  const other = await context.newPage();
  await other.goto('about:blank');
  await page.bringToFront();

  expect(await firstBlockText(page)).toContain('안');   // ★ 취소가 아니라 확정
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5. 스모크 — 실사용 시나리오 1건
 * ──────────────────────────────────────────────────────────────────────────── */

test('실사용: 3단계 작성 → 갈래 만들기 → 저장 표시가 저장됨으로 끝난다', async ({ page }) => {
  await openDoc(page);
  const cdp = await page.context().newCDPSession(page);

  const say = async (s: string) => { await cdp.send('Input.insertText', { text: s }); };

  await typeHangul(cdp, [['ㄱ', '겨', '견'], ['ㅈ', '저', '적']]);
  await say(' 요청을 받는다');
  await page.keyboard.press('Enter');
  await say('내용을 확인한다');
  await page.keyboard.press('Enter');

  await page.getByRole('button', { name: '◇ 갈래 만들기' }).click();
  await say('금액이 500만 원을 넘으면');

  await expect(page.getByTestId('save-state')).toHaveText(/저장됨/, { timeout: 5_000 });
  // 원문 무손실: 12자 이상 입력했는데 items 에 12자 이상 남아 있다
  const titles = await page.evaluate(() => (window as any).__debugItems().map((i: any) => i.title));
  expect(titles.join('')).toContain('견적 요청을 받는다');
});
```

**CI 배치**: `playwright.config.ts`에 `projects: [{ name: 'chromium' }]`만 두고, 이 스펙 파일은
**PR 필수 체크**로 건다. 실행 시간은 로컬 기준 ~14초다. ARCHITECTURE §8의 리스크 3번
("한국어 IME 회귀")에 대한 유일한 자동 방어선이므로 **flaky 하다고 skip 하지 않는다** —
flaky 하면 그건 대개 진짜 회귀다.

**테스트 빌드에만 노출하는 훅 2개**: `window.__elkRuns`(레이아웃 실행 횟수),
`window.__debugItems()`(현재 `items` 스냅샷). `process.env.NEXT_PUBLIC_E2E === '1'`에서만
정의하고, 프로덕션 번들에 남으면 빌드 실패시킨다(D-062와 같은 규율).

---

## 4. 키보드 인터랙션 전체 구현

### 4.1 커맨드 계약

```ts
// commands/types.ts
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export type Cmd = (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean;

/** 모든 커맨드는 이 래퍼를 통과한다. 예외 없음 */
export const guarded = (name: string, cmd: Cmd): Cmd => (state, dispatch, view) => {
  if (imeTracker.isComposing()) return false;      // ★ 규칙 1: 조합 중이면 아무것도 하지 않는다
  const ok = cmd(state, dispatch, view);
  if (ok && dispatch) markStructural(name);        // ★ 규칙 2: 구조 변경만 레이아웃을 트리거한다 (D-024)
  return ok;
};
```

`markStructural`은 D-024의 *"재계산 트리거는 구조 변경뿐(Enter로 줄 생성/삭제, 분기 생성/삭제,
순서 이동, blur)"* 을 코드로 만든 것이다. 텍스트만 바꾸는 경로는 이 함수를 부르지 않고,
따라서 ELK가 돌지 않는다.

### 4.2 커서 위치 분류

```ts
export type CaretCtx = {
  block: 'step' | 'branch' | 'case';
  /** step 기준: 부모가 case 면 'inCase', branch 면 'illegal', 그 외 'root' */
  scope: 'root' | 'inCase' | 'illegal';
  at: 'start' | 'middle' | 'end';
  empty: boolean;                 // 블록 텍스트가 ''
  firstOfParent: boolean;
  lastOfParent: boolean;
  /** case 기준: 본문(children)이 비어 있는가 */
  caseEmpty?: boolean;
  depth: 0 | 1 | 2;               // 분기 중첩 깊이
};
```

### 4.3 ★ 전체 분기표

**Enter**

| # | 블록 | 위치 | 조건 | 동작 | op |
|---|---|---|---|---|---|
| E1 | step | 끝 | root | 아래 형제 `step` 생성, 캐럿 이동 | `insert_item` |
| E2 | step | 중간 | any | **분할** — 뒤 텍스트를 새 블록으로. `id`는 **앞이 유지**(캔버스 노드가 안 사라진다) | `insert_item` + `set_title`×2 |
| E3 | step | 시작 (텍스트 있음) | any | **위에** 빈 형제 삽입, 캐럿은 원래 블록에 유지 | `insert_item` |
| E4 | step | — | `empty` + `inCase` + `lastOfParent` | **① 새 갈래(`case`) 생성** + 빈 step 제거. 캐럿은 새 갈래 조건 칸 | `delete_item` + `insert_item` |
| E5 | case | — | `empty`(조건 빈칸) + `lastOfParent` | **② 컨테이너 탈출** — 갈래 제거 + 분기 다음 형제로 빈 `step` 생성 | `delete_item` + `insert_item` |
| E6 | step | 끝 | `inCase`, `!lastOfParent` | 갈래 안에서 다음 형제 생성 | `insert_item` |
| E7 | case | 끝 | 본문 있음 | 갈래 본문 **첫 줄**로 캐럿 이동 (새로 만들지 않는다) | 없음 |
| E8 | case | 끝 | `caseEmpty` | 갈래 본문 첫 `step` 생성 | `insert_item` |
| E9 | branch | 끝 | 갈래 있음 | 첫 갈래 조건 칸으로 캐럿 이동 | 없음 |
| E10 | branch | 끝 | 갈래 없음 | 첫 갈래 생성 + 조건 칸으로 | `insert_item` |
| E11 | any | any | `imeTracker.isComposing()` | **`false` 반환** — IME에 넘긴다 | 없음 |
| E12 | step | 끝 | `empty` + `root` + `lastOfParent` + 문서 마지막 | 아무것도 하지 않는다 (`true` 반환, 빈 줄 무한 생성 방지) | 없음 |

**E4 + E5가 "갈래 안 마지막 빈 줄에서 Enter 두 번 → 컨테이너 탈출"이다.** 두 단계로 나눈 이유:
화면에 인쇄된 두 버튼 `[+ 경우 추가]`와 `[갈래 끝내기 ↵]`가 정확히 이 두 동작이고,
`↵` 기호가 두 번째 Enter를 가리킨다. **키보드가 화면을 그대로 따라간다** — 리스트에서 Enter 두 번으로
빠져나오는 관습과도 일치하므로 학습 비용이 0이다.

**Shift+Enter**

| 블록 | 동작 |
|---|---|
| any | **줄바꿈을 만들지 않는다.** `true`를 반환해 삼켜버린다 |

한 단계 = 한 줄이 이 제품의 유일한 문법이다(D-004가 Tab을 문법에서 뺀 것과 같은 이유).
블록 안에 개행이 들어가면 `items.title`이 여러 줄이 되고 캔버스 노드가 260×76에서 깨진다(D-023).
대신 **긴 문장은 자동 줄바꿈된다** — `word-break: keep-all; overflow-wrap: anywhere`.

**Tab / Shift+Tab** — *가속기로만* 동작한다 (D-004). 유일 통로가 아니다.

| # | 블록 | 조건 | Tab | Shift+Tab |
|---|---|---|---|---|
| T1 | step | `root`, 직전 형제가 `branch` | 그 분기의 **마지막 갈래 안 마지막**으로 이동 | — |
| T2 | step | `root`, 직전 형제가 `step` | **아무 일도 없다** (`false`) — 작업 아래 작업을 넣는 문법이 없다 | — |
| T3 | step | `inCase`, `firstOfParent` | 아무 일도 없다 | 갈래 **밖**으로 = 분기 다음 형제로 승격 |
| T4 | step | `inCase`, `!firstOfParent` | 직전 형제가 `branch`면 그 안으로, 아니면 없음 | 갈래 밖으로 승격 |
| T5 | case | any | 갈래 본문 첫 줄로 캐럿 (구조 변경 아님) | 분기 기준 칸으로 캐럿 |
| T6 | branch | any | 첫 갈래 조건 칸으로 캐럿 | 분기 **밖**으로 캐럿 (구조 변경 없음) |
| T7 | any | 문서 **마지막 블록**, 텍스트 있음 | **`false`** → 포커스가 다음 랜드마크(리사이저)로 나간다 | — |
| T8 | any | `depth >= 2` | 안으로 들어가는 Tab은 `false` + 인라인 안내 1회 | — |

**T7이 키보드 트랩 회피(WCAG 2.1.2)의 핵심이다.** ACCESSIBILITY §1이 *"에디터 안에서는
Tab=들여쓰기 유지하되 `Esc`로 먼저 패널 탈출 모드"* 로 정했는데, 그것만으로는 부족하다 —
**마지막 블록에서의 Tab은 반드시 나가야 한다.** 첫 진입 시 `aria-describedby`로
`"Tab은 갈래 안팎으로 이동해요. 나가려면 Esc를 누르세요."` 를 1회 안내한다.

**T2는 의도적 무동작이다.** BlockNote 기본은 여기서 들여쓰기를 만들지만, 우리 도메인에는
"작업의 하위 작업"이 없다(graph-core는 `task-with-children` 진단으로 복구하긴 한다).
아무 일도 안 일어나는 대신 **13px 인라인 안내를 200ms 뒤 1회**: `여기서는 들여쓰기가 없어요.
경우가 갈리면 [◇ 갈래 만들기]를 눌러 보세요.` — D-004가 기각한 "조용한 실패"를 피한다.

**Backspace / Delete**

| # | 블록 | 위치 | 조건 | 동작 |
|---|---|---|---|---|
| B1 | any | — | 조합 중 | `false` (자모 삭제) |
| B2 | step | 시작 | 직전 형제가 `step` | **병합** — 직전 블록 끝에 텍스트 붙이고 현재 블록 tombstone. 캐럿은 이음매 |
| B3 | step | 시작 | 직전 형제가 `branch` | **병합하지 않는다.** 캐럿만 분기의 마지막 갈래 마지막 줄 끝으로 |
| B4 | step | 시작 | `firstOfParent` + `inCase` | 갈래 조건 칸 끝으로 캐럿 이동 (구조 변경 없음) |
| B5 | step | 시작, `empty` | `inCase`, 갈래의 유일한 자식 | 블록 삭제 → 갈래가 **빈 갈래**가 된다 (허용. derive가 `empty-case`로 복구) |
| B6 | case | 시작 | 조건 `empty`, 본문 `empty` | **갈래 삭제**, 확인 없음 + 4초 토스트 `[되돌리기]` |
| B7 | case | 시작 | 조건 `empty`, 본문 있음 | **인라인 확인**: `이 갈래 안 3단계도 같이 지워져요` `[지우기]` `[그냥 두기]` (ACCESSIBILITY §9) |
| B8 | branch | 시작 | 기준 `empty`, 갈래 전부 비어 있음 | 컨테이너 삭제, 확인 없음 + 토스트 |
| B9 | branch | 시작 | 기준 `empty`, 내용 있음 | 인라인 확인 (B7과 동일 문안, 개수만 다름) |
| B10 | any | — | 선택 범위 있음 | 조합 중이면 §3.6의 `blur/focus` 안전 확정 후 `false` |
| B11 | step | 끝 (`Delete`) | 다음 형제가 `step` | 다음 블록을 현재로 병합 (B2의 대칭) |
| B12 | step | 끝 (`Delete`) | 다음 형제가 `branch` | **아무 일도 없다** — 분기를 텍스트 병합으로 삼키는 건 파괴적이고 되돌리기 어렵다 |

**B3와 B12가 대칭으로 "분기는 Backspace/Delete로 흡수되지 않는다"를 만든다.** 분기 컨테이너를
지우려면 컨테이너 자신에서 지워야 한다. 40~50대 사용자에게 "커서 옆에서 백스페이스를 눌렀더니
갈래 3개가 사라졌다"는 복구 가능해도 신뢰를 잃는 사건이다.

**⌘↑ / ⌘↓ · Alt+↑ / Alt+↓ · ↑ / ↓**

| 키 | 동작 | 근거 |
|---|---|---|
| `↑` `↓` | 이전·다음 **시각적 줄**로 캐럿 이동. 갈래 조건 칸·분기 기준 칸도 정류장이다 | ACCESSIBILITY §1 |
| **`Alt+↑` `Alt+↓`** | **블록 이동** (형제 순서 교환). 갈래 경계를 넘지 않는다 | COMPONENTS §5 확정 |
| **`⌘↑` `⌘↓`** | **가로채지 않는다.** 문서 처음/끝으로 (브라우저·macOS 기본) | 아래 근거 |
| `⌥⌘↑` `⌥⌘↓` | `Alt+↑↓`의 별칭 (Notion 습관) | — |

**`⌘↑↓`를 블록 이동에 쓰지 않는 이유.** macOS에서 `⌘↑↓`는 시스템 전역으로 "문서 처음/끝"이고,
VoiceOver 사용자에게는 더 근본적인 이동 수단이다. 여기를 빼앗으면 (a) 200블록 문서에서 끝으로
가는 방법이 스크롤뿐이 되고 (b) ACCESSIBILITY §1의 *"`Cmd+E / Cmd+F / Cmd+P`는 가로채지 않는다"*
원칙과 모순된다. **블록 이동은 `Alt+↑↓`이고, 이건 COMPONENTS §5가 이미 확정한 값이다.**

블록 이동은 접근성 필수 대체 경로이므로(2.5.7 드래그 동작) 결과를 반드시 알린다.

```ts
export const moveBlock = (dir: 1 | -1): Cmd => guarded('move', (state, dispatch) => {
  const ctx = caretCtx(state);
  const moved = swapWithSibling(state, dir, dispatch);
  if (moved) announce(`${ctx.indexInParent + dir + 1}번째로 이동했습니다`);   // SCREENS §5 문안
  return moved;
});
```

**Esc**

| 순서 | 조건 | 동작 |
|---|---|---|
| 1 | 조합 중 | **`false`** — IME가 소비 |
| 2 | 슬래시 메뉴 / 제안 칩 / 팝오버 열림 | 가장 위 것만 닫는다 |
| 3 | 인라인 확인 바 열림 | 취소 (`[그냥 두기]`와 동일) |
| 4 | 그 외 | 에디터 포커스 해제 → 패널 탈출. `role="status"`로 `아웃라인에서 나왔어요` |

**`/`**

| 조건 | 동작 |
|---|---|
| 조합 중 | 아무 일도 없다. `/` 문자만 들어간다 |
| 줄 시작 또는 공백 뒤 + 블록이 비었거나 `/`가 첫 글자 | 슬래시 메뉴 오픈 (문서를 바꾸지 않는다) |
| 그 외 (문장 중간의 `12/31` 같은 경우) | 열지 않는다 |

메뉴 항목은 COMPONENTS §12 `Command[]`를 그대로 쓴다 — 그룹 `단계` / `구조` / `보기` / `문서`,
초성 검색(`keywords: ["ㄷㄱㅊㄱ","단계"]`). **`/` 하나로 여는 메뉴와 `⌘K` 팔레트는 같은 목록**을
쓴다. 목록이 두 벌이면 언젠가 어긋나고, 어긋난 쪽이 접근성 경로다.

**나머지**

| 키 | 동작 |
|---|---|
| `⌘Z` / `⌘⇧Z` | op 단위 undo/redo. 파싱 1회 = op 1개 (STATES §3) |
| `⌘S` | 가로챈다 → 토스트 `이미 저장돼 있어요 · 오후 3:12` (ACCESSIBILITY §1) |
| `⌘K` | 커맨드 팔레트 |
| `⌘.` | 현재 블록 `⋯` 메뉴 (COMPONENTS §5) |
| `⌘B` `⌘I` `⌘U` | **아무 일도 없다** — 스타일이 스키마에 없다 (E-06). 삼켜서 브라우저 기본(굵게)이 contenteditable에 들어오는 것을 막는다 |
| `F6` | 패널 간 이동 (ACCESSIBILITY §1) |

### 4.4 keymap 등록

```ts
// editor/blocknote/keymap.ts
import { keymap } from 'prosemirror-keymap';

export const appKeymap = () => keymap({
  'Enter':          guarded('enter', enterCommand),
  'Shift-Enter':    () => true,                          // 삼킨다
  'Tab':            guarded('tab',  indentCommand(+1)),
  'Shift-Tab':      guarded('tab',  indentCommand(-1)),
  'Backspace':      guarded('bksp', backspaceCommand),
  'Delete':         guarded('del',  deleteForwardCommand),
  'Alt-ArrowUp':    moveBlock(-1),
  'Alt-ArrowDown':  moveBlock(+1),
  'Mod-Alt-ArrowUp':   moveBlock(-1),
  'Mod-Alt-ArrowDown': moveBlock(+1),
  'Escape':         escapeCommand,
  'Mod-s':          () => (toastAlreadySaved(), true),
  'Mod-b':          () => true,
  'Mod-i':          () => true,
  'Mod-u':          () => true,
  // ★ 'Mod-ArrowUp' / 'Mod-ArrowDown' 는 의도적으로 비워 둔다
});
```

**플러그인 우선순위**가 중요하다. BlockNote 기본 keymap보다 **앞**에 와야 Tab이
기본 들여쓰기로 새지 않는다.

```ts
const editor = useCreateBlockNote({
  schema,
  _tiptapOptions: {
    extensions: [
      Extension.create({ name: 'appKeymap', priority: 1000, addProseMirrorPlugins: () => [appKeymap()] }),
      Extension.create({ name: 'appPlugins', priority: 900,  addProseMirrorPlugins: () => [
        structureNormalizer(), branchChrome(mounts), toolBadge(scanner), suggestion(), pasteHandler(),
      ]}),
    ],
  },
});
```

`_tiptapOptions`는 BlockNote 0.x의 비공개 API다. **여기가 BlockNote breaking change에
가장 먼저 부러지는 지점**이므로 §11의 탈출 계획이 이 한 줄을 기준으로 설계돼 있다.

---

## 5. 분기 컨테이너의 편집 동작

### 5.1 갈래 안 마지막 빈 줄 → Enter 두 번 → 탈출

```ts
// commands/enter.ts (E4·E5 구현)
function enterInCase(state: EditorState, dispatch?: Dispatch): boolean {
  const c = caretCtx(state);

  // E4 — 갈래 본문 마지막 빈 줄에서 Enter → 새 갈래
  if (c.block === 'step' && c.scope === 'inCase' && c.empty && c.lastOfParent) {
    if (!dispatch) return true;
    const tr = state.tr;
    const casePos  = parentPos(state, 'case')!;
    const branchPos = parentPos(state, 'branch')!;
    const ordinal  = caseIndex(state) + 1;

    deleteBlockAt(tr, currentBlockPos(state));                   // 빈 step 제거
    const newCase = insertCaseAfter(tr, casePos, { ordinal });   // 형제 갈래 추가
    setSelectionInside(tr, newCase);                             // 캐럿 → 조건 칸
    closeHistory(tr);                                            // ★ 앞 타이핑과 묶이지 않게
    dispatch(tr.setMeta('opGroup', 'branch.addCase'));
    return true;
  }

  // E5 — 빈 갈래 조건 칸에서 Enter → 컨테이너 탈출
  if (c.block === 'case' && c.empty && c.caseEmpty && c.lastOfParent) {
    if (!dispatch) return true;
    const tr = state.tr;
    const branchPos = parentPos(state, 'branch')!;
    deleteBlockAt(tr, currentBlockPos(state));                   // 빈 갈래 제거
    const after = insertStepAfter(tr, branchPos);                // 분기 뒤 형제 step
    setSelectionInside(tr, after);
    closeHistory(tr);
    dispatch(tr.setMeta('opGroup', 'branch.close'));
    return true;
  }
  return false;
}
```

`closeHistory(tr)`가 중요하다. 없으면 앞선 타이핑과 구조 변경이 한 undo에 묶여
`⌘Z` 한 번에 "글자 몇 개 + 갈래 생성"이 함께 되돌아간다. STATES §3의 *"`⌘Z`가 op 단위로
되감긴다"* 를 지키려면 **구조 변경 앞뒤로 히스토리를 끊어야 한다.**

`[갈래 끝내기 ↵]` 버튼은 E5와 **완전히 동일한 커맨드를 호출한다.** 버튼과 키보드가 다른 코드를
부르면 언젠가 다르게 동작한다.

### 5.2 갈래 삭제 시 자식 처리

3단 차등(ACCESSIBILITY §9)을 그대로 구현한다.

```ts
export function deleteCase(view: EditorView, caseId: string): void {
  const n = countDescendantSteps(view.state, caseId);

  if (n === 0) { applyDeleteCase(view, caseId); toastUndo('갈래를 지웠어요'); return; }

  // 인라인 확인 — 모달이 아니다. 편집을 막지 않는다
  showInlineConfirm({
    anchor: caseId,
    message: `이 갈래 안 ${n}단계도 같이 지워져요`,
    confirmLabel: '지우기',
    cancelLabel: '그냥 두기',
    onConfirm: () => { applyDeleteCase(view, caseId); toastUndo(`갈래와 ${n}단계를 지웠어요`); },
  });
}

function applyDeleteCase(view: EditorView, caseId: string) {
  const tr = view.state.tr;
  closeHistory(tr);
  deleteSubtree(tr, caseId);                     // 문서에서 제거
  closeHistory(tr);
  // ★ op 는 자식까지 전부 delete_item(tombstone). 한 opGroup 이므로 undo 1회로 전부 복구
  view.dispatch(tr.setMeta('opGroup', 'branch.deleteCase'));
}
```

**자식은 승격하지 않고 함께 tombstone 한다.** 승격(부모 삭제 시 자식을 형제로 올리기)이
일반적인 아웃라인 관례지만 여기서는 틀리다 — 갈래 안 단계들은 **그 조건 하에서만 의미가 있다.**
"금액이 500만 원을 넘으면"의 자식 3단계를 최상위로 올리면, 그림에서는 모든 건이 그 3단계를
거치는 것으로 그려진다. **의미가 조용히 바뀌는 것이 데이터가 사라지는 것보다 나쁘다.**
대신 되돌리기를 두 겹으로 둔다: 4초 토스트 `[되돌리기]` + `⌘Z`.

`delete_item`은 tombstone이므로(D-032) 서버 데이터는 남는다. 30일 내 복구 경로가 존재한다.

### 5.3 분기 → 작업으로 타입 변경 시 갈래들은?

**평탄화(flatten)한다. 어떤 텍스트도 잃지 않는다.**

```
변경 전                          변경 후
branch "금액 기준"               step   "금액 기준"          ← 기준이 제목이 된다
  case "500만 넘으면"              step "500만 넘으면"        ← 조건이 제목이 된다
    step "팀장 승인"               step "팀장 승인"
    step "견적서 발송"             step "견적서 발송"
  case "그 외"                     step "그 외"
    step "바로 발송"               step "바로 발송"
```

```ts
export function branchToTask(view: EditorView, branchId: string) {
  const tr = view.state.tr;
  closeHistory(tr);
  // 1) 문서 순서(pre-order) 그대로 평탄화 — 순서가 바뀌지 않는 것이 유일한 안전 보장
  flattenSubtreeInPlace(tr, branchId);
  // 2) 타입 변환. ★ ID 는 전부 보존된다 (캔버스 노드·코멘트·레이아웃 캐시가 살아남는다)
  retypeAll(tr, branchId, 'step');
  // 3) 분기/갈래 전용 attrs 제거 — 어댑터가 mode/caseLabel/joinBehavior 를 지운다
  closeHistory(tr);
  view.dispatch(tr.setMeta('opGroup', 'branch.toTask'));
  toastUndo('갈래를 폈어요. 단계 순서는 그대로예요');
}
```

- **확인 다이얼로그를 띄우지 않는다.** 파괴적이지 않기 때문이다 — 글자 하나 안 사라진다
- 반대 방향(작업 → 분기)은 `set_kind` 하나에 빈 갈래 2개 생성. graph-core는 `branch-single-case` /
  `branch-without-case` 진단으로 이미 견딘다
- **대안으로 검토했다가 버린 것**: "갈래를 유지한 채 kind만 바꾸기". D-053에 의해 derive 결과는
  같지만, 화면에서 컨테이너가 사라지고 갈래는 남아 있는 **보이지 않는 구조**가 된다.
  사용자가 편집할 수 없는 구조를 문서에 남기지 않는다

### 5.4 갈래 사이 드래그 이동

BlockNote `SideMenuController`의 드래그를 그대로 쓰되, 드롭 규칙을 정규화가 뒤에서 받는다.

| 드래그 대상 | 드롭 지점 | 결과 |
|---|---|---|
| `step` | 다른 갈래 안 | 그 갈래의 자식으로. `move_item` 1개 |
| `step` | 분기 컨테이너의 직계(갈래 사이) | **정규화가 가장 가까운 갈래로 흡수** (§5.6 N3) |
| `step` | 루트 | 갈래 밖으로 승격 |
| `case` | 같은 분기 내 다른 위치 | 갈래 순서 변경. `ordinal` 재계산 + `reorder_item` |
| `case` | **다른 분기 안** | 허용. 조건과 본문이 통째로 이동 |
| `case` | 루트 / 갈래 밖 | **정규화가 `step`으로 변환** (조건 텍스트 = 제목, 본문은 자식) |
| `branch` | 갈래 안 | `depth < 2`면 허용(중첩 분기), `>= 2`면 드롭 커서를 그리지 않는다 |
| `branch` | 자기 자손 안 | ProseMirror가 원천 차단 |

**드롭 인디케이터**는 2px `brand-500` 라인(COMPONENTS §5). 갈래 안으로 들어가는 드롭은
라인 좌측 시작점을 레일 위치(24px)로 맞춰 **"어디에 들어가는지"를 들여쓰기로 보여준다.**

허용된 드롭만 그리는 대신 **거의 다 허용하고 정규화가 고친다**는 방침을 다시 강조한다.
드래그 중에 유효성 판정을 하려면 매 `dragover`마다 트리를 계산해야 하고, 그건 60fps를 깬다.

**모바일에는 드래그가 없다** (SCREENS §10) — 롱프레스(400ms) → 하단 시트 `위로 / 아래로 / 삭제`.
갈래 간 이동은 모바일에서 제공하지 않는다. 이건 기능 누락이 아니라 결정이다.

### 5.5 2택 칩(`이어짐` / `여기서 끝`)의 데이터 매핑

**UI는 컨테이너에 1개, 데이터는 갈래마다 있다.** (D-006 + graph-core `joinBehaviorOf(case)`)

```ts
export function setJoinBehavior(view: EditorView, branchId: string, v: 'continue' | 'end') {
  const tr = view.state.tr;
  closeHistory(tr);
  for (const c of casesOf(view.state, branchId)) setBlockProps(tr, c.id, { joinBehavior: v });
  setBlockProps(tr, branchId, { joinBehavior: v });
  closeHistory(tr);
  view.dispatch(tr.setMeta('opGroup', 'branch.setJoin'));   // 갈래 N개 = op N개, undo 1회
}
```

갈래별로 값이 갈리는 경우(붙여넣기·AI 초안·다른 탭 병합)에는 `summarizeJoin`이 `'mixed'`를
돌려주고, 칩은 **어느 쪽도 선택되지 않은 상태 + 13px `n-550` 보조문 `갈래마다 달라요`** 로
렌더한다. 이때 한쪽을 누르면 전체가 그 값으로 통일된다.
**임의로 한쪽을 선택된 것처럼 보이게 하지 않는다** — 그건 사용자가 하지 않은 결정을 화면이 거짓말하는 것이다.

### 5.6 구조 정규화기 — 불법 상태를 한 트랜잭션 뒤에 고친다

```ts
// plugins/normalizer.ts
export function structureNormalizer(): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, next) {
      // ★ 게이트 3중. 조합 중에는 절대 돌지 않는다
      if (!trs.some((t) => t.docChanged)) return null;
      if (imeTracker.isComposing()) return null;
      if (trs.some((t) => t.getMeta('normalized'))) return null;   // 자기 자신 재진입 방지

      const fixes = collectFixes(next.doc);      // 순수 함수 (editor-core)
      if (fixes.length === 0) return null;
      const tr = next.tr;
      for (const f of fixes) applyFix(tr, f);
      return tr.setMeta('normalized', true).setMeta('addToHistory', false);
    },
  });
}
```

| # | 불법 상태 | 정규화 | ID |
|---|---|---|---|
| N1 | `case`가 `branch`의 자식이 아님 | → `step`. 조건 텍스트가 제목, 본문은 자식 그대로 | 보존 |
| N2 | `case`의 부모가 `case` (갈래 안 갈래) | → `step` | 보존 |
| N3 | `step`이 `branch`의 직계 자식 | 앞의 갈래에 흡수. 앞에 갈래가 없으면 `조건 없음` 갈래를 만들어 담는다 | 보존 |
| N4 | `branch`가 갈래를 0개 가짐 | **고치지 않는다.** derive가 `branch-without-case`로 처리. 작성 중일 수 있다 | — |
| N5 | `branch`가 `case`의 유일 자식이면서 자기도 갈래 0개 | N4와 동일 | — |
| N6 | `paragraph` 등 스키마 밖 블록 잔존 | → `step`, 텍스트 보존 | 보존 |
| N7 | `case.ordinal`이 인덱스와 불일치 | 재계산 (렌더 전용 값) | — |
| N8 | 분기 중첩 depth ≥ 3 | **고치지 않는다.** 배너만 (§5.7) | — |
| N9 | 블록 id 중복 (붙여넣기) | 뒤에 오는 쪽에 **새 UUID 발급** | 앞만 보존 |
| N10 | id가 예약어(`start`/`end`/`join:`/`fork:`) | 새 UUID (graph-core `isReservedId`) | — |
| N11 | 빈 문서 | 빈 `step` 1개 삽입 (에디터에 캐럿 놓을 곳이 필요) | 신규 |
| N12 | 인라인 칩의 `text`가 빈 문자열 | 칩 제거 (`display`로 대체하지 않는다 — 없던 글자를 만들면 안 된다) | — |

**N9가 실무에서 가장 자주 터진다.** 우리 에디터에서 복사 → 같은 문서에 붙여넣기 하면
`block.id`가 그대로 오고, 그게 `items.id` PK 충돌이 된다. `addToHistory: false`로 붙이는 이유는
정규화가 undo 단계를 만들면 `⌘Z` 한 번이 "정규화만 되돌리기"가 되어 다시 정규화가 도는
무한 루프가 되기 때문이다.

`collectFixes`는 `packages/editor-core`의 순수 함수다 — ProseMirror 없이 12건의 픽스처로 테스트한다.

### 5.7 중첩 분기 — 깊이 제한

**최대 2단** (분기 안의 분기까지 허용, 그 안은 금지).

| 근거 | |
|---|---|
| 상위 문서 | COMPONENTS §6 안티패턴: *"중첩 분기 3단계 이상 허용 금지(depth 2에서 막고 '새 흐름으로 분리' 제안)"* / SCREENS §5: `들여쓰기 depth × 20px (최대 depth 2)` / PARSING `MAX_DEPTH = 2` |
| 그림 | ELK layered에서 3단 중첩 XOR은 갈래 폭이 곱으로 늘어난다. 2×3×2 = 12갈래면 캔버스 가로가 3,000px를 넘고 D-023의 260px 노드가 화면 밖으로 나간다 |
| 사람 | 이 제품의 사용자는 3겹 중첩을 읽지 못한다. 읽지 못하는 그림은 문서가 아니다 |
| graph-core | **깊이 제한이 없다** (A1: tails 집합 규칙이 재귀적으로 동일). 즉 제한은 **에디터의 UX 결정이지 엔진 제약이 아니다** — 나중에 풀 수 있다 |

**막는 방식이 중요하다.** 거부하지 않고 **방향을 제시한다.**

```ts
// depth 2 에서 [◇ 갈래 만들기] · Tab · 슬래시 메뉴 '갈래' 항목이 호출하는 지점
if (depthOf(state) >= 2) {
  showInlineNotice({
    anchor: currentBlockId(state),
    text: '여기서 또 갈리면 그림이 읽기 어려워져요.',
    action: { label: '이 갈래를 새 흐름으로 떼기', run: () => splitIntoNewDocument(caseId) },
  });
  return false;
}
```

- `[◇ 갈래 만들기]` 버튼은 **비활성화하지 않는다** — 회색 버튼은 40~50대 사용자에게 "고장난 화면"이다(STATES §2). 눌리고, 대신 안내가 나온다
- **외부에서 들어온 depth 3 이상은 받아들인다.** 붙여넣기·AI 초안·다른 탭 병합이 3단을 만들면 **거부하지 않는다** (무손실 원칙). 대신 상단 인라인 바 1회: `갈래가 세 겹으로 겹쳐 있어요. 그림이 넓어질 수 있어요.` `[가장 안쪽을 새 흐름으로 떼기]`
- 갈래 개수는 **5번째부터 안내**만 한다(PARSING `MAX_BRANCH_CHILDREN = 4`는 파서 클램프 값이지 에디터 상한이 아니다): `경우를 다 못 적어도 돼요. 자주 있는 두 가지만 적어도 충분해요.` (WRITING §6)

---

## 6. 인라인 제안 시스템

목표: 본문에 `만약` · `아니면` · `승인되면`을 타이핑하면 줄 끝에 제안 칩
`갈래로 바꿀까요? [예]` (`h24 / r4 / bg n-100 / 12px`)이 뜨고, **3초 후 자동 소멸하며,
무시가 기본**이다 (SCREENS §3).

### 6.1 `inputRules`만으로는 안 된다 — 정직하게

`inputRules`는 `handleTextInput`에 걸린다. 한국어는 조합을 거치므로:

- Chrome/macOS: 조합 중 `handleTextInput`이 **오지 않는다**. 확정 시점에도 `insertCompositionText`로 처리되어 규칙이 안 걸린다
- 일부 Android: 조합 중간 문자열로 `handleTextInput`이 온다 → `만`, `만ㅇ`, `만야`에 대해 규칙이 3번 돈다

즉 `/만약$/` 같은 `InputRule`은 **한국어에서 신뢰할 수 없다.** 그래서 구조를 이렇게 나눈다.

```
                     detectSuggestion()  ← 순수 함수 1개 (editor-core)
                        ↑            ↑
            (a) inputRules      (b) compositionend 스캔
            ASCII·기호 경로       한글 경로 (실질적으로 전부)
```

`inputRules`는 **버리지 않고 남긴다.** 이유: (a) `/` 슬래시 메뉴는 실제로 이 경로로 동작하고
(b) 영문·숫자 트리거를 나중에 추가할 여지를 남기며 (c) ProseMirror의 `undoInputRule`
(Backspace로 규칙 되돌리기)을 공짜로 얻는다. **한국어 트리거는 (b)만 쓴다는 사실을 문서에
명시**해 두는 것이 다음 사람에게 필요한 정보다.

### 6.2 플러그인 전체

```ts
// plugins/suggestion.ts
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { detectSuggestion, type SuggestHit } from '@workflow/editor-core';

type SuggestState = {
  /** 현재 살아 있는 제안 1건. 문서 전체에 동시 1건만 존재한다 */
  hit: (SuggestHit & { blockId: string; blockPos: number; shownAt: number }) | null;
  /** 사용자가 무시한 (blockId, kind). 세션 한정 — 같은 줄에서 다시 조르지 않는다 */
  dismissed: ReadonlySet<string>;
};

export const suggestKey = new PluginKey<SuggestState>('suggest');

const TTL_MS = 3_000;

export function suggestion(mount: (hit: SuggestState['hit']) => HTMLElement): Plugin<SuggestState> {
  return new Plugin<SuggestState>({
    key: suggestKey,

    state: {
      init: () => ({ hit: null, dismissed: new Set() }),
      apply(tr, prev): SuggestState {
        const set = tr.getMeta(suggestKey) as Partial<SuggestState> | undefined;
        if (set) return { ...prev, ...set };

        if (!prev.hit) return prev;

        // ★ 3초 소멸을 타이머 트랜잭션으로 하지 않는다 (§6.4).
        //   "다음 트랜잭션이 올 때 만료됐으면 치운다" — 게으른 정리
        if (Date.now() - prev.hit.shownAt > TTL_MS) return { ...prev, hit: null };

        // 문서가 바뀌면 위치를 매핑하고, 그 블록이 사라졌으면 제안도 사라진다
        if (tr.docChanged) {
          const mapped = tr.mapping.mapResult(prev.hit.blockPos);
          if (mapped.deleted) return { ...prev, hit: null };
          return { ...prev, hit: { ...prev.hit, blockPos: mapped.pos } };
        }
        return prev;
      },
    },

    props: {
      decorations(state) {
        const s = suggestKey.getState(state);
        if (!s?.hit) return DecorationSet.empty;
        return DecorationSet.create(state.doc, [
          Decoration.widget(endOfBlock(state.doc, s.hit.blockPos), () => mount(s.hit), {
            side: 1,
            // ★ key 가 안정적이면 DOM 이 재사용된다 = 조합 중 DOM 교체가 없다
            key: `sg:${s.hit.blockId}:${s.hit.kind}`,
            ignoreSelection: true,
          }),
        ]);
      },

      handleDOMEvents: {
        compositionend: (view) => {
          // 확정 문자가 doc 에 들어온 뒤에 스캔한다
          queueMicrotask(() => requestAnimationFrame(() => scan(view)));
          return false;                      // ★ 절대 true 를 반환하지 않는다
        },
      },
    },
  });
}

/** 현재 블록만 스캔한다. 문서 전체를 훑지 않는다 */
function scan(view: EditorView): void {
  if (imeTracker.isComposing()) return;
  const s = suggestKey.getState(view.state)!;
  const { blockId, blockPos, text, caret } = currentBlockPlainText(view.state);
  if (!blockId) return;

  const hit = detectSuggestion(text, caret, {
    insideCase: isInsideCase(view.state),
    blockType: currentBlockType(view.state),
    dismissed: s.dismissed,
    blockId,
  });

  if (!hit) { if (s.hit) view.dispatch(view.state.tr.setMeta(suggestKey, { hit: null })); return; }
  if (s.hit?.blockId === blockId && s.hit.kind === hit.kind) return;   // 이미 떠 있다 → 무동작

  view.dispatch(
    view.state.tr
      .setMeta(suggestKey, { hit: { ...hit, blockId, blockPos, shownAt: Date.now() } })
      .setMeta('addToHistory', false),      // ★ 제안은 undo 히스토리에 남지 않는다
  );
}
```

### 6.3 오탐 방지 — 5중 게이트

`detectSuggestion`(순수 함수)이 적용하는 규칙. **재현율보다 정밀도를 택한다** — 파서(PARSING §0.2)와
정반대인데, 이유가 있다. 파서는 붙여넣기 결과 화면에서 한 번에 확인받고, 배지 삭제가 1클릭이다.
반면 인라인 제안은 **타이핑을 방해한다.** 3초짜리 칩이 오탐으로 뜨면 그건 시각적 소음이고,
40~50대 사용자에게는 "화면이 자꾸 뭐라고 한다"는 불안이다.

| # | 게이트 | 규칙 | 잡히는 오탐 |
|---|---|---|---|
| G1 | **어절 경계** | 트리거 앞은 줄 시작 또는 `[\s(“"']`, 뒤는 `[\s가-힣]` | `일만약간` · `그러면` 안의 `면` |
| G2 | **최소 길이** | 트리거 뒤에 **한글 2자 이상**이 이미 있어야 한다 | `만약` 만 치고 멈춘 상태에서 조르지 않는다 |
| G3 | **문맥 억제** | 이미 `case` 블록 안이면 `else` 트리거를 끈다 / `branch` 블록 안에서는 전부 끈다 | 갈래 조건에 `아니면`을 쓰는 정상 문장 |
| G4 | **세션 무시 기억** | `dismissed`에 `${blockId}:${kind}`가 있으면 영원히 끈다 | 같은 줄에서 반복 노출 |
| G5 | **동시 1건** | 문서 전체에 살아 있는 제안은 1개 | 여러 줄을 빠르게 치면 칩이 우수수 뜨는 현상 |

추가로 **부정 문맥은 처리하지 않는다** — `만약을 대비하지 않아도 되면`처럼 트리거가 다른
의미로 쓰인 경우. PARSING 부록 C #1과 같은 판단이고, 근거도 같다: 규칙으로 잡으려 들면
부작용이 오탐보다 크고, **무시가 기본이라 비용이 0에 수렴한다.**

`hold` 트리거(`승인되면` `결재 나면` `답 오면`)는 별도 문안을 쓴다 —
`기다리는 시간으로 바꿀까요? [예]`. WRITING §6의 *"기다리는 시간은 아무도 잘못한 게 아니에요"*
톤과 일치시킨다.

### 6.4 ★ 3초 소멸을 ProseMirror 플러그인으로 — 타이머 트랜잭션을 쓰지 않는다

가장 순진한 구현은 이렇다.

```ts
setTimeout(() => view.dispatch(view.state.tr.setMeta(suggestKey, { hit: null })), 3000);
```

**이건 쓰면 안 된다.** 3초 뒤에 사용자가 조합 중일 확률은 매우 높고(제안이 뜬 직후 사용자는
계속 타이핑한다), 그 순간 트랜잭션이 나가면 `DecorationSet`이 갱신되고 위젯 DOM이 제거되면서
브라우저가 조합을 끊을 수 있다. **"3초 뒤에 반드시 뭔가를 한다"는 요구는 IME와 근본적으로 상극이다.**

**해법: 소멸을 CSS 애니메이션으로, 상태 정리를 게으르게.**

```css
/* editor.css */
@keyframes sg-out { 0%,80% { opacity: 1 } 100% { opacity: 0; visibility: hidden } }
.sg-chip {
  height: 24px; border-radius: var(--radius-xs);
  background: var(--n-100); color: var(--text-secondary);
  font-size: 12px; line-height: 1;
  animation: sg-out 3s linear forwards;   /* ★ 소멸은 렌더러가 한다. JS 트랜잭션 0회 */
}
.sg-chip:hover, .sg-chip:focus-within { animation-play-state: paused; }  /* 누르려는 순간 사라지지 않게 */
@media (prefers-reduced-motion: reduce) {
  .sg-chip { animation: none; }
  .sg-chip[data-expired="true"] { display: none; }   /* 페이드 대신 즉시 사라짐 */
}
```

- **시각적 소멸은 3초 뒤 CSS가 처리한다.** 트랜잭션이 나가지 않으므로 조합에 아무 영향이 없다
- **플러그인 상태 정리는 다음 트랜잭션에서** — `apply`의 `Date.now() - shownAt > TTL_MS` 검사.
  다음 트랜잭션이 3초 뒤든 30초 뒤든 상관없다. 그때까지 상태에 죽은 `hit`이 남아 있어도
  화면에는 이미 없고, `scan`은 `hit.blockId !== 현재 블록`이면 새로 띄운다
- `hover`/`focus-within`에서 애니메이션을 멈추는 것이 중요하다. 마우스를 가져가는 도중에
  사라지면 클릭할 수 없다 (ACCESSIBILITY §9의 툴팁 400ms 유지와 같은 취지)
- `prefers-reduced-motion`에서는 애니메이션을 끄고 `data-expired`를 다음 트랜잭션이 붙인다.
  **모션이 없으면 소멸도 즉시**여야 한다 — 페이드가 없는데 3초 뒤 갑자기 사라지는 것보다 낫다

**만약 "정확히 3초"가 요구사항이 된다면** — `requestAnimationFrame` 루프에서 시각만 확인하고,
`isComposing()`이면 다음 프레임으로 미루는 방식을 쓴다. 하지만 **그럴 이유가 없다.**
사용자에게 중요한 것은 "곧 사라진다"이지 "3.00초"가 아니다.

### 6.5 수락 시 블록 변환

```ts
export function acceptSuggestion(view: EditorView): void {
  const s = suggestKey.getState(view.state)!;
  if (!s.hit) return;
  const { kind, blockId, at, len } = s.hit;
  const tr = view.state.tr;
  closeHistory(tr);

  if (kind === 'branch') {
    // "만약 금액이 500만 원을 넘으면 팀장 승인을 받는다"
    //  → branch(기준: 빈칸) > case("금액이 500만 원을 넘으면") > step("팀장 승인을 받는다")
    const { condition, body } = splitAtTrigger(currentText(view.state, blockId), at, len);
    retypeBlock(tr, blockId, 'branch', { mode: 'xor' }, /* 기준 텍스트 */ '');
    const c1 = appendCase(tr, blockId, condition, 0);
    if (body.trim()) appendStep(tr, c1, body);
    appendCase(tr, blockId, '', 1);                    // 빈 두 번째 갈래 = "아니면 [ ]라면"
    focusInside(tr, condition ? c1 : blockId);
  } else if (kind === 'else') {
    // 직전 형제가 branch 면 그 분기에 갈래 추가, 아니면 branch 를 새로 만든다
  } else {
    retypeBlock(tr, blockId, 'step', { kind: 'hold', waitFor: guessWaitFor(s.hit) });
  }

  closeHistory(tr);
  view.dispatch(tr.setMeta(suggestKey, { hit: null }).setMeta('opGroup', `suggest.${kind}`));
  announce('갈래로 바꿨어요. 조건을 적어 주세요');       // aria-live (조합 중이면 큐잉)
}
```

**변환 후 캐럿은 "다음에 쓸 곳"에 놓는다.** `만약`만 치고 수락하면 조건 칸에, 조건까지 썼으면
본문 첫 줄에. 캐럿이 엉뚱한 곳에 있으면 사용자는 변환이 잘못됐다고 읽는다.

무시(`X` 또는 3초 경과)는 `dismissed`에 `${blockId}:${kind}`를 넣는다. **`⌘Z`로 되돌릴 수 있어야
하므로 수락은 반드시 `opGroup` 하나다** — 블록 1개가 4개(branch + case×2 + step)로 바뀌는
변환이 undo 4번이면 사용자는 중간 상태에서 길을 잃는다.

---

## 7. 도구 자동 추출

`엑셀에 정리` 입력 → 줄 끝에 `Excel?` 배지(`h20 / r4 / 1px bd / 11px sub`) → **클릭 = 확정, X = 무시.**
**입력이 아니라 확인이다** (SCREENS §3, TOOLS.md §정규화 규칙 1).

### 7.1 사전과 매칭 — 새로 만들지 않는다

`packages/paste-parse/src/hints/tools.ts`의 `ToolScanner`를 그대로 재사용한다.
48종 × 동의어 ≈ 200 별칭이 빌드타임에 `tools.generated.ts`로 컴파일되고, 트라이는 모듈
스코프에서 1회(<1ms) 빌드된다.

```ts
import { ToolScanner, type ToolHit } from '@workflow/paste-parse';
const scanner = new ToolScanner();      // ★ 모듈 스코프. 컴포넌트 안에서 만들면 매 렌더 트라이 재빌드
```

오탐 방어 4중(최장일치 / 조사 경계 `RE_BEFORE_OK`·`RE_AFTER_OK` / `AMBIGUOUS` 문맥 ±20자 /
확정하지 않음)은 파서와 **완전히 동일**하다. **에디터에 두 번째 매칭 로직을 만들지 않는다** —
만드는 순간 붙여넣기로 들어온 배지와 타이핑으로 뜬 배지가 다르게 동작한다.

### 7.2 배지는 왜 데코레이션인가

| | 인라인 노드로 만들면 | 데코레이션으로 만들면 |
|---|---|---|
| 문서 변경 | 타이핑마다 doc 트랜잭션 → **조합 위협** | 0회 |
| undo | 배지 등장/소멸이 `⌘Z` 단계가 된다 | 히스토리에 없다 |
| `items.title` | 배지 텍스트가 제목에 섞인다 | 영향 없음 |
| 복사 | 클립보드에 `Excel?`이 딸려간다 | 안 간다 |
| 확정 전 서버 저장 | 미확정 추측이 DB에 들어간다 | 안 들어간다 |

**확정되지 않은 것은 문서에 들어가지 않는다.** 이건 도구 배지·제안 칩·붙여넣기 검토 표시에
공통으로 적용되는 이 에디터의 규칙이다.

### 7.3 성능 — 타이핑마다 전체 스캔 금지

200블록 × 평균 30자 = 6,000자. 트라이 스캔이 6,000자에 ~0.4ms라 "그냥 전부 스캔"도 못 할 건
아니지만, 문제는 스캔이 아니라 **`DecorationSet`을 매번 새로 만드는 비용**이다. 200개 위젯
데코레이션을 재생성하면 ProseMirror가 DOM diff를 200번 하고, 그게 60fps를 깎는다.

```ts
// plugins/toolBadge.ts
export const toolBadgeKey = new PluginKey<BadgeState>('toolBadge');

type BadgeState = {
  set: DecorationSet;
  /** blockId → 마지막으로 스캔한 텍스트. 같으면 건너뛴다 */
  scanned: Map<string, string>;
  dirty: Set<string>;
};

export function toolBadge(scanner: ToolScanner, mount: BadgeMount): Plugin<BadgeState> {
  return new Plugin<BadgeState>({
    key: toolBadgeKey,
    state: {
      init: (_, s) => ({ set: buildAll(s.doc, scanner, mount), scanned: snapshot(s.doc), dirty: new Set() }),

      apply(tr, prev, _old, next): BadgeState {
        if (!tr.docChanged) return prev;

        // ① 먼저 기존 데코레이션을 매핑한다. 이것만으로 대부분의 타이핑이 처리된다
        const mapped = prev.set.map(tr.mapping, tr.doc);

        // ② tr.steps 가 실제로 건드린 블록만 골라낸다 — O(변경 범위)
        const touched = new Set<string>();
        for (let i = 0; i < tr.steps.length; i++) {
          tr.mapping.maps[i]!.forEach((_os, _oe, ns, ne) => {
            forEachBlockInRange(next.doc, ns, ne, (id) => touched.add(id));
          });
        }
        if (touched.size === 0) return { ...prev, set: mapped };

        // ③ 조합 중에는 여기서 끝. dirty 만 쌓아 두고 compositionend 후 view 가 flush 한다
        if (imeTracker.isComposing()) {
          const dirty = new Set(prev.dirty); for (const id of touched) dirty.add(id);
          return { ...prev, set: mapped, dirty };
        }

        return rescan(mapped, prev, touched, next.doc, scanner, mount);
      },
    },
    props: { decorations: (s) => toolBadgeKey.getState(s)!.set },

    view: () => ({
      update(view) {
        const s = toolBadgeKey.getState(view.state)!;
        if (s.dirty.size === 0 || imeTracker.isComposing()) return;
        // 조합이 끝났고 밀린 블록이 있다 → idle 에 몰아서 처리
        scheduleIdle(() => flushDirty(view));
      },
    }),
  });
}
```

**비용 예산**

| 상황 | 스캔 대상 | 실측 목표 |
|---|---|---|
| 한 글자 타이핑 | 블록 1개 (30자) | < 0.05ms |
| Enter (블록 분할) | 블록 2개 | < 0.1ms |
| 붙여넣기 200줄 | 200블록 → **`requestIdleCallback`으로 20블록씩 10틱** | 틱당 < 1ms |
| 문서 로드 (500블록) | 전체 1회, 워커 아님 | < 4ms |

- ③의 `dirty` 누적이 **조합 중 비용을 0으로 만든다.** 조합 중에는 `mapped`만 반환하고 스캔이 없다
- 붙여넣기 청크 처리는 `requestIdleCallback`(폴백 `setTimeout(0)`). 500블록을 한 번에 스캔하면
  2ms지만 그 뒤 500개 위젯 DOM 생성이 200ms를 먹는다. **비싼 건 스캔이 아니라 DOM이다**
- `scanned` 맵으로 텍스트가 실제로 변하지 않은 블록(예: 형제 삽입으로 위치만 밀린 블록)은 건너뛴다
- 이미 `toolChip`으로 확정된 도구는 같은 블록에서 배지를 만들지 않는다 (`toolId` 중복 제거)

### 7.4 배지 렌더

```tsx
// inline/ToolBadge.tsx — contentEditable={false} 위젯 안에서 렌더된다
export function ToolBadge({ hit, onConfirm, onDismiss }: ToolBadgeProps) {
  return (
    <span
      contentEditable={false}
      data-testid="tool-badge"
      className="ml-1.5 inline-flex h-5 items-center gap-1 rounded-xs border border-paper-200
                 px-1.5 text-[11px] leading-none text-paper-500 align-middle select-none"
    >
      <button
        type="button" tabIndex={-1}                       {/* §10.4 — 키보드 경로는 ⌘K */}
        onMouseDown={(e) => e.preventDefault()}           {/* ★ 캐럿을 뺏지 않는다 */}
        onClick={() => onConfirm(hit)}
        aria-label={`${hit.display}을(를) 이 단계의 도구로 확정`}
        className="hover:text-paper-700"
      >
        {hit.display}?
      </button>
      <button type="button" tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onDismiss(hit)}
              aria-label={`${hit.display} 제안 무시`}>
        <Icon as={X} size={12} />
      </button>
    </span>
  );
}
```

**`onMouseDown`에서 `preventDefault()`가 필수다.** 없으면 배지를 클릭하는 순간 contenteditable이
포커스를 잃고, 그때 조합 중이었다면 조합이 취소된다. 배지는 **캐럿을 절대 건드리지 않는 UI**여야 한다.

`Excel?`이 아니라 `엑셀?`로 표시할지는 `display` 값이 결정한다 — TOOLS.md의 표시명이 `엑셀`이므로
실제로는 `엑셀?`이 뜬다. SCREENS의 예시 `Excel?`은 영문 표시명 도구(`Slack?` `Notion?`)의 경우다.
**표시명을 그대로 쓰고 번역하지 않는다.**

### 7.5 확정 시 인라인 칩으로 치환 — 무손실을 지키면서

```ts
export function confirmTool(view: EditorView, hit: ToolHit & { blockId: string }): void {
  const tr = view.state.tr;
  closeHistory(tr);

  // 원문 부분문자열을 그대로 props.text 에 담는다. 화면은 칩, 데이터는 원문
  const raw = textAt(view.state, hit.blockId, hit.span);        // 예: '액셀'
  replaceWithInline(tr, hit.blockId, hit.span, {
    type: 'toolChip',
    props: { toolId: hit.id, display: hit.display, text: raw },  // ★ raw ≠ display 여도 된다
  });

  closeHistory(tr);
  view.dispatch(tr.setMeta('opGroup', 'tool.confirm'));

  // items.toolIds 는 별도 op — 어댑터가 소유하지 않는 필드다 (§2.5 L1)
  emitOp({ type: 'set_tools', id: hit.blockId, toolIds: uniq([...toolIdsOf(hit.blockId), hit.id]) });
}
```

**핵심 불변식**: 확정 전후로 `items.title`이 **바이트 단위로 동일**하다.

```
확정 전: [text "액셀에 정리"]                       → title = "액셀에 정리"
확정 후: [toolChip{text:"액셀"}] [text "에 정리"]    → title = "액셀에 정리"
```

`inlineToText`가 `display`가 아니라 `props.text`를 쓰기 때문이다(§2.2). 사용자가 `액셀`이라고
쓴 글자를 제품이 `엑셀`로 고쳐 쓰면, 그건 무손실 위반이자 WRITING §문체 통일 금지 원칙 위반이다.
**칩은 표시이지 교정이 아니다.**

칩을 지우면(칩 위에서 Backspace) 인라인 노드가 통째로 사라진다 — 그러면 `액셀`이라는 글자도
사라진다. 이건 곤란하므로 **칩 삭제는 텍스트로 되돌린다.**

```ts
// commands/backspace.ts 안, B1 다음
if (nodeBefore(state)?.type.name === 'toolChip') {
  const chip = nodeBefore(state)!;
  replaceInlineWithText(tr, chipPos, chip.attrs.text);   // 칩 → 원문 텍스트
  emitOp({ type: 'set_tools', id: blockId, toolIds: without(current, chip.attrs.toolId) });
  return true;
}
```

**미매칭 수집**: 트라이에 안 걸린 도구스러운 토큰은 `unmatchedToolCandidates`로 모아
주 1회 상위 20건을 카탈로그 확장 큐에 올린다(TOOLS §운영규칙 2). 에디터에서는 화면에 아무것도
표시하지 않고 텔레메트리로만 보낸다 — 사용자에게 "이건 도구인가요?"를 묻기 시작하면
그 순간 이 기능이 "확인"에서 "입력"으로 바뀐다.

---

## 8. 붙여넣기 처리

### 8.1 `handlePaste` 훅

```ts
// plugins/pasteHandler.ts
export function pasteHandler(deps: PasteDeps): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const dt = event.clipboardData;
        if (!dt) return false;

        // ★ 우리 에디터에서 복사한 것은 BlockNote 기본 경로로 (id 중복은 정규화 N9 가 처리)
        if (dt.types.includes('blocknote/html')) return false;

        const html  = dt.getData('text/html');
        const plain = dt.getData('text/plain');
        if (!plain && !html) return false;

        // 한 줄짜리 짧은 붙여넣기는 파이프라인을 부르지 않는다.
        // 300ms 예산 이전에, 한 줄을 "제안 화면"으로 확인받는 건 모욕적이다
        if (!html && plain.length < 40 && !plain.includes('\n')) return false;

        event.preventDefault();
        void runPastePipeline(view, { html, plain }, deps);
        return true;
      },

      // 드롭도 같은 경로로. 파일 드롭은 무시(이미지 범위 밖 — PARSING 부록 C #7)
      handleDrop(view, event) { … },
    },
  });
}
```

### 8.2 `text/html` 우선 → PARSING 파이프라인

PARSING.md 부록 C #4는 현재 *"HTML을 무시하고 `text/plain`만 읽는다"*이고, 열 조건은
"노션·구글독스 사용자 비중이 높으면"이다. **SCREENS/제품 요구가 `text/html` 우선으로 확정됐으므로
이 항목을 연다.** PARSING.md 본문이 이미 붙일 자리를 지정해 두었다 — *"HTML 경로는 `Line[]`을
만드는 대체 프론트엔드로 붙이면 된다. S3 이후 파이프라인은 그대로 재사용된다."*

```ts
// packages/paste-parse/src/frontends/html.ts   ★ 신규. PARSING.md §3 앞에 붙는 프론트엔드
/**
 * text/html → Line[]  (S3 입력 형식)
 *
 * 정규식이 복원하려는 계층 정보를 HTML 이 이미 갖고 있다:
 *   <ol>/<ul>/<li> 중첩 → indent
 *   <h1>~<h6>          → 섹션 마커
 *   <p>                → 줄
 *   <td>               → 표 행 (R2 재사용)
 *   <br>               → 줄바꿈
 *
 * ★ DOM 을 쓰지 않는다 — 이 패키지는 순수여야 하므로 브라우저에서는 호출부가
 *   DOMParser 로 미리 직렬화한 중간 표현을 넘긴다 (HtmlNode[]).
 */
export function htmlToLines(nodes: readonly HtmlNode[]): { lines: Line[]; traits: Trait[] };
```

호출부(브라우저)만 DOM을 안다.

```ts
async function runPastePipeline(view: EditorView, src: { html: string; plain: string }, deps: PasteDeps) {
  const t0 = performance.now();
  let result: ParseResult;
  let raw = src.plain;

  if (src.html && looksStructured(src.html)) {
    const doc = new DOMParser().parseFromString(src.html, 'text/html');
    const nodes = serializeForParse(doc.body);                    // sanitize 포함 (SECURITY.md)
    raw = plainFromHtmlNodes(nodes);                              // ★ 무손실 기준이 되는 원문
    result = parseFromLines(htmlToLines(nodes), raw);
  } else {
    const mode = route(src.plain);                                // 'sync' | 'worker' | 'raw'
    result =
      mode === 'raw'    ? singleBlockResult(src.plain)
    : mode === 'sync'   ? parse(src.plain)
    : await deps.worker.parse(src.plain);                         // 200줄 초과
  }

  applyParseResult(view, result, raw, performance.now() - t0);
}
```

- `looksStructured(html)` — `<li>` / `<ol>` / `<table>` / `<h1..6>`이 하나라도 있으면 참.
  없으면(Slack·카톡 웹 복사 등 `<span>` 범벅) HTML을 버리고 `text/plain` 경로. **HTML이 있다고
  항상 나은 게 아니다**
- 워커는 SCREENS/PARSING §12.4대로 **에디터에 포커스가 들어오는 순간 미리 만든다.**
  붙여넣기 시점에 만들면 부팅 비용이 300ms 예산에 들어온다
- **`raw`가 무손실 검증의 기준**이다. HTML 경로에서는 `plainFromHtmlNodes`의 출력이 원문이고,
  `assertLossless(raw, result)`가 그 위에서 돈다

### 8.3 파싱 1회 = op 1개 = undo 1회

```ts
function applyParseResult(view: EditorView, r: ParseResult, raw: string, ms: number) {
  const tr = view.state.tr;
  closeHistory(tr);                                   // ★ 앞의 타이핑과 분리

  const target = pasteRange(view.state);
  const nodes  = parsedToEditorNodes(r);              // 순수 (editor-core)
  replaceRangeWithBlocks(tr, target, toBlockNote(nodes));

  closeHistory(tr);                                   // ★ 뒤의 타이핑과도 분리
  view.dispatch(tr.setMeta('opGroup', 'paste'));

  // 서버로 나가는 op 도 한 덩어리. rawText 가 함께 실린다 (PARSING §10.4)
  emitOpGroup('paste', [
    { type: 'paste_raw', payload: { rawText: raw, ruleVersion: r.ruleVersion, pipelineId: r.pipelineId } },
    ...nodes.flatMap(toInsertOps),
  ]);

  track('paste_parsed', { parse_ms: ms, confidence_bucket: r.confidence, rule_hits: r.ruleHits, … });
  enterReviewMode(view, r);
}
```

`closeHistory`를 **양쪽에** 부르는 것이 STATES §3의 *"파싱 1회 = op 1개(12단계 생성이 12번
되감기면 안 됨)"* 를 보장한다. ProseMirror의 history 플러그인은 시간 근접한 트랜잭션을
자동으로 합치므로, 앞뒤를 끊지 않으면 "붙여넣기 + 그 직후 타이핑"이 한 undo가 되어
**`⌘Z` 한 번에 방금 친 글자까지 사라진다.**

`op.payload.rawText`에 원문 전문이 실리므로, `⌘Z` 한 번이면 **원문만 남은 상태**로 정확히
돌아간다 — 파싱이 아무리 엉망이어도 사용자가 잃는 것이 0이라는 보증이 여기서 나온다.

### 8.4 "제안" 상태 — 확정 전 표시

파싱 결과는 확정이 아니라 **제안**이다 (STATES §3, PARSING §9.2).

```ts
type ReviewState = {
  ids: ReadonlySet<string>;        // 검토 대상 블록
  confidence: 'low' | 'mid' | 'high';
  raw: string;                     // [원문 그대로 넣기] 용
};
```

**어디에 두는가**: `items`에 넣지 않는다(도메인 데이터가 아니다). 블록 `props.review` /
`props.boundary`에 넣는다 — 이유는 (a) 데코레이션으로 하면 붙여넣기 직후 200개 데코레이션을
만들어야 하고 (b) `props`는 `tr.mapping`을 타지 않아도 되며 (c) `blockToItem`이 읽지 않으므로
**서버에는 안 나간다.** 새로고침하면 사라지고, 그건 "이미 봤다 = 확정"으로 간주한다.

시각 표현은 PARSING §9.2 표를 그대로 따른다.

```css
.bn-block-content[data-review="true"]                 { border-top: 1px dashed var(--border-strong); }
.bn-block-content[data-review="true"][data-boundary-low="true"] {
  border-left: 2px solid var(--branch);               /* 왼쪽 노란 보더 = 추론 경계 */
}
```

상단에는 인라인 바 하나. **모달이 아니다** — 편집을 막지 않는다.

| confidence | 헤더 | 주 버튼 | 보조 |
|---|---|---|---|
| `high` / `mid` | `이렇게 나눠봤어요. 틀린 데는 고치면 돼요.` | `[이대로 가져오기]` | `[처음부터 직접 쓸래요]` |
| `low` | `제가 나눈 거라 어색한 데가 있을 거예요. 합치거나 지워주세요.` | **`[원문 그대로 넣기]`** | `[이대로 가져오기]` |

`mid`/`low`에서는 블록마다 인라인 버튼 `[위와 합치기]` `[여기서 나누기]`를 **상시 노출**한다.
`low`에서는 도구·담당자 배지를 **띄우지 않는다** — 경계를 못 믿는데 메타를 물으면 신뢰가 더 깎인다.

`[이대로 가져오기]`는 `review` prop을 전부 지우는 op 1개. `[원문 그대로 넣기]`는
`⌘Z`와 동일한 경로(`paste` opGroup 되돌리기) + 원문 1블록 삽입.

**확정하지 않고 나가면?** 문서를 떠나거나 새로고침하면 제안 표시만 사라지고 내용은 남는다.
`items`에는 이미 들어가 있으므로 데이터 손실이 없다. STATES §3의
*"원문은 한 글자도 잃지 않는다 — 이게 유일한 성공 기준"* 이 이 설계의 근거다.

### 8.5 실패·부분 성공

전부 PARSING §10에 있고, 에디터는 결과를 렌더하기만 한다.

| 결과 | 에디터 동작 |
|---|---|
| `failure.reason = 'single_block'` | 블록 1개 + 인라인 안내 `줄 끝에서 Enter를 치시면 단계가 나뉘어요.` |
| `unparsedTail` 있음 | 꼬리를 **회색 1블록**으로 넣고 `앞부분만 나눌 수 있었어요. 뒤쪽은 제가 못 읽었어요.` |
| `dropped[tier='demote']` | 회색 텍스트로 남기고 `[단계로 만들기]` 인라인 버튼 |
| `dropped[tier='strip']` | `숨긴 줄 12개 보기` 링크만 |
| 200줄 초과 (워커) | 붙여넣은 영역만 정적 회색 블록. **스피너 없음** (STATES §3) |
| `assertLossless` 예외 | `parse()` 내부 폴백이 이미 처리. 에디터는 알 필요가 없다 |

---

## 9. 성능

### 9.1 예산

STATES §10이 정한 값을 에디터 관점으로 쪼갠 것.

| 지점 | 목표 | 200블록 실측 목표 | 500블록 |
|---|---|---|---|
| 첫 글자 입력 지연 (INP) | < 100ms | < 20ms | < 40ms |
| Enter → 노드 등장 | 140ms 안에 애니메이션 시작, 서버 왕복 0 | — | — |
| 키 입력 1회 총 비용 | — | < 4ms | < 6ms |
| 문서 마운트 (`itemsToBlocks` + 첫 페인트) | LCP < 1.2s | < 120ms | < 350ms |
| 붙여넣기 200줄 | < 300ms | 파싱 60ms + 렌더 240ms | 워커 |

### 9.2 키 입력 1회의 비용 분해 (200블록)

| 단계 | 비용 | 대응 |
|---|---|---|
| ProseMirror 트랜잭션 적용 | ~0.2ms | — |
| `structureNormalizer.appendTransaction` | ~0.3ms | `tr.docChanged` 게이트 + `collectFixes`가 조기 반환 |
| `branchChrome` 데코 재빌드 | **~2.5ms** ← 가장 비쌈 | `tr.docChanged`일 때만 + 위젯 `key`로 DOM 재사용 |
| `toolBadge` 스캔 | ~0.05ms | 변경 블록만 (§7.3) |
| `suggestion` | 0ms (조합 중) / ~0.05ms | 현재 블록만 |
| React 리렌더 (BlockNote) | ~1ms | `React.memo` (§9.5) |
| `fromBlockNote` + `blocksToItems` + `diffToOps` | **~1.8ms** | §9.4 디바운스 |
| `derive()` | 0.64ms (205항목, 실측) | 조합 게이트 + 디바운스 |
| ELK | **건너뜀** | `topologyHash` 게이트 (D-024/D-056) |

`branchChrome`이 2.5ms인 이유는 `doc.descendants()`가 전체를 훑기 때문이다. 200블록에서는
허용되지만 500블록에서는 6ms가 되어 예산을 먹는다. **500블록 대응**: `branchChrome`도
`toolBadge`와 같은 증분 전략을 쓴다 — `tr.mapping`으로 기존 데코를 매핑하고,
`tr.steps`가 건드린 범위 안에 `branch`/`case`가 있을 때만 그 부분을 재빌드.
**200블록에서는 하지 않는다** — 조기 최적화가 버그 표면을 넓히고, 200이 M1의 현실적 상한이다.

### 9.3 200블록 · 500블록 렌더 전략

**가상화는 쓰지 않는다.** contenteditable에서 화면 밖 블록을 DOM에서 빼면
(a) 여러 블록 드래그 선택이 깨지고 (b) `⌘A` → 복사가 화면 안 내용만 담고 (c) 브라우저 찾기(`⌘F`)가
못 찾고 (d) ProseMirror의 위치 계산이 어긋난다. **무손실 원칙과 정면으로 충돌한다.**

대신 **`content-visibility`** 를 쓴다 — DOM에는 남기고 레이아웃·페인트만 건너뛴다.

```css
@supports (content-visibility: auto) {
  .bn-block-content { content-visibility: auto; contain-intrinsic-size: auto 40px; }
  /* 분기 컨테이너는 높이 편차가 커서 auto 로 두면 스크롤바가 출렁인다 → 제외 */
  .bn-block:has(> .bn-block-content[data-content-type="branch"]) .bn-block-content { content-visibility: visible; }
}
```

- `contain-intrinsic-size: auto 40px` — `auto` 키워드가 한 번 렌더된 실제 높이를 기억하므로 스크롤 점프가 없다. `40px`는 COMPONENTS §5의 행 최소 높이
- Chrome/Edge는 `content-visibility: auto` 요소도 **찾기(`⌘F`)와 스크롤 앵커링을 지원**한다. Safari는 18부터 — `@supports`로 감싸 미지원 브라우저는 그냥 전부 렌더한다(200블록에서는 문제없다)
- 200블록 마운트 시 레이아웃 시간이 **~110ms → ~35ms**로 줄어드는 것이 이 기법의 실제 값이다

**500블록에서 진짜 해법은 접기(collapse)다** (D-037, ARCHITECTURE §5). 아웃라인 쪽 접기는
분기 컨테이너 단위로 제공한다 — `branch.props.collapsed`가 참이면 갈래 전체를
`케이스 요약 1줄 + "+2 갈래"` 로 대체(COMPONENTS §6 `collapsed` 상태). 접힌 자식은
**DOM에서 제거하지 않고** `display: none`으로 둔다 — 제거하면 선택·복사가 다시 깨진다.

### 9.4 `derive()` 디바운스와 조합 인지

```ts
// hooks/useDerivePipeline.ts
export function useDerivePipeline(editor: AppEditor, ime: ImeTracker) {
  const dirty = useRef(false);
  const timer = useRef<number>();
  const lastTopo = useRef<string>('');

  const run = useCallback(() => {
    if (ime.isComposing()) { dirty.current = true; return; }     // ★ 게이트 1
    const items = blocksToItems(fromBlockNote(editor.document), { prevById: store.itemsById });
    const ops   = diffToOps(store.items, items);
    if (ops.length === 0) return;                                 // ★ 게이트 2: 실제 변경 없음
    store.applyOps(ops);
    queue.enqueue(ops);                                           // 800ms 디바운스 배치 (ARCHITECTURE §6)

    const g = derive(items, store.edges, deriveOptions);           // 0.64ms @205
    canvasStore.setGraph(g);
    if (g.topologyHash !== lastTopo.current) {                     // ★ 게이트 3: ELK
      lastTopo.current = g.topologyHash;
      if (structuralSinceLastLayout()) scheduleLayout(g);          // ★ 게이트 4: D-024 구조 변경만
    }
  }, [editor, ime]);

  useEffect(() => {
    editor.onChange(() => {
      dirty.current = true;
      clearTimeout(timer.current);
      // 250ms trailing. 조합 중이면 타이머가 발화해도 run() 이 게이트 1 에서 되돌아간다
      timer.current = window.setTimeout(run, 250);
    });
    return ime.subscribe((c) => { if (!c && dirty.current) { dirty.current = false; run(); } });
  }, [editor, ime, run]);
}
```

**게이트가 4겹인 것이 과하지 않다.** 각각이 막는 것이 다르다.

| 게이트 | 막는 것 | 없으면 |
|---|---|---|
| 1 조합 | 조합 중 모든 것 | 자모 유실 |
| 2 op 0개 | 커서 이동·선택 변경 | 커서만 움직여도 저장 큐가 돈다 |
| 3 `topologyHash` | 제목만 바뀐 경우의 ELK | 타이핑마다 레이아웃 (D-056) |
| 4 구조 변경 플래그 | 위상은 같은데 순서가 미묘하게 바뀐 경우 | D-024 위반 |

**250ms 디바운스의 근거**: `derive()`가 0.64ms라 사실 매 입력마다 돌려도 된다. 디바운스가
필요한 이유는 파생이 비싸서가 아니라 **`fromBlockNote` + `blocksToItems` + `diffToOps`가 1.8ms**
이고, 이게 zustand 상태 변경 → 요약 카드 리렌더 → 숫자 깜빡임을 만들기 때문이다.
D-056이 말한 *"요약 카드가 매 키 입력에 깜빡이면 안 된다"* 가 정확히 이 지점이다.

### 9.5 React 리렌더 최소화

```tsx
// blocks/StepRow.tsx
export const StepRow = React.memo(
  function StepRow({ block, contentRef, editor }: Props) { … },
  (a, b) =>
    a.block.id === b.block.id &&
    a.block.props.kind === b.block.props.kind &&
    a.block.props.pain === b.block.props.pain &&
    a.block.props.waitFor === b.block.props.waitFor &&
    a.block.props.review === b.block.props.review,
  // ★ block.content 는 비교하지 않는다 — 텍스트는 ProseMirror 가 contentRef 안에서 직접 갱신하고
  //   React 가 그 DOM 을 건드리면 안 된다. 이게 리렌더 최소화이자 IME 안전이다
);
```

규칙 6개:

1. **`block.content`를 React 렌더 경로에 넣지 않는다.** 텍스트는 `contentRef` 아래 ProseMirror 영역이다. 여기에 React가 개입하면 조합 중 DOM 교체가 일어난다 — 성능과 IME가 같은 규칙으로 해결된다
2. **`editor.document`를 렌더 중에 읽지 않는다.** 읽는 순간 문서 전체가 의존성이 된다. 필요하면 `useEditorContentOrSelectionChange`로 좁혀서 구독
3. **zustand는 selector + `useShallow`.** 상단바 저장 상태, 요약 카드, 캔버스가 각각 자기 슬라이스만 본다
4. **`nodeTypes`/`edgeTypes`/`schema`/`mounts`는 모듈 스코프 상수.** 렌더 안에서 만들면 매 프레임 전체 재마운트 (ARCHITECTURE §5와 같은 함정)
5. **아웃라인과 캔버스는 별도 Provider.** 캔버스 상태 변경이 에디터를 리렌더하는 경로가 존재하면 안 된다 — STATES §9의 에러 바운더리 분리와 같은 이유
6. **에디터 아일랜드를 우선 하이드레이트**, 캔버스는 `requestIdleCallback` 이후 (STATES §10 #2)

**측정 방법**: `NEXT_PUBLIC_E2E=1` 빌드에서 `StepRow`에 렌더 카운터를 붙이고,
"200블록 문서에서 한 블록에 10자를 치면 다른 199개 블록의 렌더 횟수가 0"을 E2E로 검증한다.
이건 눈으로 못 잡는다.

---

## 10. 접근성

ACCESSIBILITY.md §1·§3이 정본이다. 여기서는 **에디터 구현에서만 결정되는 것**을 쓴다.

### 10.1 루트

```tsx
<div
  id="outline"
  role="textbox"                     // ★ BlockNote 기본값을 덮어쓴다 (ACCESSIBILITY §3)
  aria-multiline="true"
  aria-label="업무 흐름 글"
  aria-describedby="outline-hint"
  data-testid="outline-editor"
/>
<p id="outline-hint" className="sr-only">
  한 줄에 한 단계씩 적으세요. Tab은 갈래 안팎으로 이동하고, 나가려면 Esc를 누르세요.
</p>
```

`role="textbox"` 유지가 필수인 이유는 NVDA 브라우즈 모드에서 **자동 포커스 모드 전환**이
이 role에 걸려 있기 때문이다. `role="group"`이나 `role="application"`으로 바꾸면
스크린리더 사용자가 화살표 키로 캐럿을 움직일 수 없게 된다.

### 10.2 조합 중 라이브리전 침묵

```ts
// a11y/announcer.ts
const pending: string[] = [];
let flushTimer: number | undefined;

export function announce(msg: string) {
  if (imeTracker.isComposing()) { pending.push(msg); return; }   // ★ 큐에만 쌓는다
  emit(msg);
}

imeTracker.subscribe((composing) => {
  if (composing || pending.length === 0) return;
  clearTimeout(flushTimer);
  // 100ms 뒤 1회로 합쳐 방출 (ACCESSIBILITY §3)
  flushTimer = window.setTimeout(() => { emit(dedupe(pending).join('. ')); pending.length = 0; }, 100);
});
```

방출 규칙 (STATES §5의 저장 상태 규칙과 동일한 정신):

| 읽는다 | 읽지 않는다 |
|---|---|
| 블록 생성·삭제 결과 (`3번째로 이동했습니다`) | 타이핑 내용 |
| 갈래 생성/변환 (`갈래로 바꿨어요`) | 캐럿 이동 |
| 저장 상태 전이 (`saved` 첫 1회 + 5분 1회, `degraded`, `offline`, `reconnected`) | `sending` |
| 붙여넣기 결과 (`18줄을 12단계로 나눠봤어요`) | 도구 배지 등장/소멸 |
| 인라인 확인 바 등장 | 제안 칩 등장/소멸 |

**제안 칩과 도구 배지를 읽지 않는 것이 중요하다.** 3초짜리 정보를 스크린리더가 읽으면
사용자가 반응하기 전에 사라진다. 대신 **키보드 경로(⌘K 팔레트)에 같은 명령이 항상 있다** (§10.4).

### 10.3 분기 컨테이너의 접근성 구조

```
<section role="group" aria-label="갈래: 내용 분류">      ← 컨테이너 (CSS :has() 로 그려진 .bn-block)
  <div role="group" aria-label="1번째 경우">
    <span aria-hidden>만약</span>
    <span contenteditable>단순 문의</span>              ← 인라인 콘텐츠
    <span aria-hidden>라면</span>
    <div role="group" aria-label="1번째 경우의 단계">…</div>
  </div>
  …
  <div role="radiogroup" aria-label="갈래가 끝난 뒤">     ← 2택 칩
    <button role="radio" aria-checked="true">이어짐</button>
    <button role="radio" aria-checked="false">여기서 끝</button>
  </div>
</section>
```

- **`<fieldset>`을 쓰지 않는다** (COMPONENTS §6 확정) — 스크린리더가 "폼"으로 읽는다
- 인쇄된 `만약` / `라면`은 `aria-hidden`. 그룹 라벨(`1번째 경우`)이 같은 정보를 더 정확히 준다. 둘 다 읽으면 `"1번째 경우 만약 단순 문의 라면"`이 되어 장황하다
- `role="group"`은 ProseMirror가 소유한 DOM에 붙여야 한다 → `createReactBlockSpec`의 `render`가 반환하는 최상위 요소가 아니라 **`.bn-block-content`에 속성을 주입**해야 한다. BlockNote 0.52는 `render` 결과를 `.bn-block-content` 안에 넣으므로, `<section>`을 render에서 반환하면 중첩 landmark가 된다 → **컨테이너 role은 `branchChrome` 플러그인이 `Decoration.node()`로 붙인다**

```ts
decos.push(Decoration.node(pos, pos + node.nodeSize, {
  role: 'group',
  'aria-label': `갈래: ${plainTextOf(node.firstChild) || '기준 미정'}`,
}));
```

`Decoration.node`로 붙인 속성은 문서에 저장되지 않고, `key`가 없어도 ProseMirror가 속성만
갱신하므로 DOM 교체가 없다. **조합 중에도 안전한 유일한 aria 주입 방법이다.**

### 10.4 contentEditable=false 컨트롤의 키보드 경로

에디터 안의 비편집 컨트롤 — 드래그 핸들, `[+]`, `⋯`, 짜증 토글, `[+ 단계]`, `[+ 경우 추가]`,
`[갈래 끝내기]`, 2택 칩, 도구 배지, 제안 칩 — 은 **전부 `tabIndex={-1}`** 이다.

이유: 에디터 안에서 `Tab`은 들여쓰기다(ACCESSIBILITY §1). 컨트롤이 탭 순서에 들어가면
한 블록에서 다음 블록으로 가는 데 Tab을 6번 눌러야 하고, 그 순간 200블록 문서는
키보드로 통과 불가능해진다.

**대신 규칙을 하나 강제한다.**

> **에디터 안의 모든 마우스 컨트롤은 커맨드 팔레트(`⌘K`)와 슬래시 메뉴에 1:1 대응하는 항목을 갖는다.**

```ts
// commands/registry.ts — 컨트롤과 팔레트 항목이 같은 배열에서 나온다
export const BLOCK_CONTROLS: ControlSpec[] = [
  { id: 'step.add',        label: '단계 추가',        keywords: ['ㄷㄱㅊㄱ','단계'], icon: Plus,     group: '단계',  run: addStep },
  { id: 'branch.create',   label: '갈래 만들기',      keywords: ['ㄱㄹㅁㄷㄱ'],       icon: GitBranch,group: '구조',  run: createBranch },
  { id: 'hold.create',     label: '기다리는 시간',    keywords: ['ㄱㄷㄹㄴ'],         icon: Clock,    group: '구조',  run: createHold },
  { id: 'branch.addCase',  label: '경우 추가',        keywords: ['ㄱㅇㅊㄱ'],         icon: Plus,     group: '구조',  run: addCase },
  { id: 'branch.close',    label: '갈래 끝내기',      keywords: ['ㄱㄹㄲㄴㄱ'],       icon: CornerDownLeft, group: '구조', run: closeBranch },
  { id: 'branch.setJoin',  label: '갈래 뒤 이어짐/여기서 끝', keywords: ['ㅇㅇㅈ'],   icon: Merge,    group: '구조',  run: toggleJoin },
  { id: 'block.moveUp',    label: '위로 옮기기',      keywords: ['ㅇㄹ'],             icon: ArrowUp,  group: '단계',  run: () => moveBlock(-1) },
  { id: 'block.moveDown',  label: '아래로 옮기기',    keywords: ['ㅇㄹㄹ'],           icon: ArrowDown,group: '단계',  run: () => moveBlock(+1) },
  { id: 'block.pain',      label: '짜증나는 단계로 표시', keywords: ['ㅉㅈ'],         icon: Frown,    group: '단계',  run: togglePain },
  { id: 'tool.confirm',    label: '찾은 도구 확정',   keywords: ['ㄷㄱ'],             icon: Wrench,   group: '단계',  run: confirmNearestTool },
  { id: 'block.delete',    label: '이 단계 지우기 (되돌릴 수 있어요)', keywords: ['ㅈㅇ'], icon: Trash2, group: '단계', danger: true, run: deleteBlock },
];
```

- 마우스 컨트롤은 `BLOCK_CONTROLS`에서 `id`로 찾아 `run`을 호출한다. **같은 함수를 부른다**
- 커맨드 팔레트는 같은 배열을 `Command[]`로 변환해 렌더한다 (COMPONENTS §12)
- **단위 테스트**: `BLOCK_CONTROLS`에 없는 `run`을 호출하는 onClick이 소스에 존재하면 실패
  (`controls.registry.test.ts` — AST 스캔). 접근성 경로가 조용히 썩는 것을 막는 유일한 방법이다
- `danger: true` 항목의 라벨에 *"(되돌릴 수 있어요)"* 를 인쇄하는 것은 ACCESSIBILITY §9 규칙

### 10.5 슬래시 메뉴 — roving tabindex

**`aria-activedescendant`를 쓰지 않는다** (ACCESSIBILITY §3): 조합 중 `activedescendant` 갱신이
Chrome에서 조합을 끊는다.

```tsx
<ul role="listbox" aria-label="명령 고르기" ref={listRef}>
  {items.map((it, i) => (
    <li key={it.id} role="option" aria-selected={i === active}
        tabIndex={i === active ? 0 : -1}                    // ★ roving
        ref={i === active ? activeRef : undefined}
        onMouseEnter={() => setActive(i)}>
      {it.label}
    </li>
  ))}
</ul>
```

문제: 실제 포커스를 `<li>`로 옮기면 **에디터의 캐럿이 사라진다.** `/` 뒤에 계속 타이핑해서
필터링해야 하는데 포커스가 리스트에 있으면 타이핑이 리스트로 간다.

**해법**: 포커스는 에디터에 두고, `↑↓`만 플러그인이 가로채 `active`를 옮긴다.
그리고 스크린리더에는 `role="listbox"`가 아니라 **`role="status"`로 현재 항목을 읽어준다.**

```tsx
{/* 시각 리스트는 aria-hidden. 대신 상태를 문장으로 읽는다 */}
<ul aria-hidden="true"> … </ul>
<div role="status" aria-live="polite" className="sr-only">
  {open ? `${items.length}개 중 ${active + 1}번째, ${items[active]?.label}` : ''}
</div>
```

이 방식은 `combobox` 패턴의 정석(`aria-activedescendant`)에서 벗어나지만,
**IME와 양립하는 유일한 형태**다. ACCESSIBILITY §3이 이미 이 방향을 지시했고,
여기서 구현을 확정한다. `Esc`로 닫고, `Enter`로 실행(조합 중이면 `false` 반환 — §3.5와 동일).

### 10.6 나머지

- 활성 블록 좌측 4px `brand-500` 세로 레일은 `Decoration.node`로 (`data-active`). React 리렌더 없음 (STATES §3)
- 모든 히트 영역 44×44 — 시각 16/20/24px 컨트롤은 `::after`로 확장 (ACCESSIBILITY §8)
- 폭 < 480px에서 `[+ 경우 추가]` / `[갈래 끝내기]` / 2택 칩 **세로 스택** (ACCESSIBILITY §8이 지목한 유일한 위험 지점)
- `scroll-padding-top: 60px` — 상단바 52px sticky에 캐럿이 가리지 않게 (2.4.11)
- 글자 크기 3단(15/17/19px)은 `html { font-size }` 조정 → 에디터가 전부 `rem`이므로 자동 (ACCESSIBILITY §9)

---

## 11. BlockNote 0.x 리스크 완화

### 11.1 어댑터 경계를 어디에 두는가

**BlockNote API에 닿는 코드의 총량을 최소화하고, 그것을 한 디렉터리에 가둔다.**

```
packages/editor-core/            ★ @blocknote/*, react, prosemirror-*, DOM 전부 금지
  src/types.ts                   EditorNode / EditorInline
  src/adapter.ts                 blocksToItems / itemsToBlocks / blockToItem / itemToBlock
  src/sortkey.ts                 assignSortKeys
  src/diff.ts                    diffToOps
  src/normalize.ts               collectFixes (§5.6 N1~N12)
  src/suggest.ts                 detectSuggestion (§6.3)
  src/caret.ts                   caretCtx 계산 (위치 분류만. PM 타입 없이 순수 트리 + 오프셋)
  src/__fixtures__/

app/(app)/workflows/[id]/_components/editor/
  EditorClient.tsx               'use client'
  blocknote/                     ★★ @blocknote/* import 허용 구역. 여기가 전부다
    schema.ts                    §1.3
    bridge.ts                    fromBlockNote / toBlockNote  (~150줄)
    mount.tsx                    useCreateBlockNote + 플러그인 조립
    blocks/{StepRow,BranchHead,CaseRow}.tsx
    inline/{ToolChipView,PersonChipView,ToolBadge,SuggestChip}.tsx
    plugins/{normalizer,branchChrome,toolBadge,suggestion,pasteHandler,keymap}.ts
    commands/{enter,tab,backspace,move,branch,tool}.ts
    ime.ts
  a11y/announcer.ts
  editor.css
```

```js
// eslint.config.js
{
  files: ['**/*.{ts,tsx}'],
  ignores: ['app/**/editor/blocknote/**'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['@blocknote/*'],  message: 'BlockNote는 editor/blocknote/ 안에서만 import 합니다 (EDITOR.md §11).' },
        { group: ['prosemirror-*'], message: '동일. 순수 로직은 @workflow/editor-core 로 올리세요.' },
      ],
    }],
  },
}
```

**경계를 이 위치에 두는 근거 — "무엇이 흔들리는가"로 역산했다.**

| 흔들리는 것 | 0.x에서 실제로 바뀐 적 있는가 | 우리 코드에서 닿는 곳 | 부러졌을 때 비용 |
|---|---|---|---|
| `Block` 타입 모양 (`content` 배열, `props` 위치) | **자주** | `bridge.ts` 만 | 150줄 |
| `createReactBlockSpec` 시그니처 | 여러 번 (2번째 인자 객체화 등) | `schema.ts` + 블록 3개 | ~250줄 |
| `propSchema` 표현 (`values` 배열 / zod 전환 논의) | 논의 중 | `schema.ts` | ~80줄 |
| `useCreateBlockNote` 옵션 | 자주 | `mount.tsx` | ~60줄 |
| **`_tiptapOptions`** (비공개) | **언제든** | `mount.tsx` 한 줄 | 플러그인 등록 경로 전체 |
| SideMenu / SuggestionMenu 컨트롤러 | 자주 | `mount.tsx` + 드래그 핸들 | ~120줄 |
| ProseMirror 자체 (`Plugin`, `Decoration`) | **거의 안 바뀜** | `plugins/*` `commands/*` | 0 |

**핵심 통찰**: 우리 코드의 대부분(플러그인·커맨드·데코레이션)은 **BlockNote가 아니라 ProseMirror**
API를 쓴다. ProseMirror는 10년째 안정적이다. 그래서 "BlockNote 위에 짓는다"가 아니라
**"ProseMirror 위에 짓고 BlockNote는 스키마·중첩 UI·사이드메뉴 껍데기로만 쓴다"** 는 자세로
설계했다. 이것이 §1.6에서 컨테이너 크롬을 `render()`가 아니라 데코레이션으로 만든 진짜 이유이기도 하다.

### 11.2 업그레이드 절차

1. `package.json`은 **정확한 버전 핀**(`"@blocknote/react": "0.52.3"`, 캐럿 없음). `overrides`로 전이 의존도 고정
2. 업그레이드는 별도 PR. `schema.smoke.test.ts` + `e2e/ime.spec.ts` + 어댑터 골든 36건이 전부 통과해야 머지
3. 변경이 `bridge.ts` 바깥으로 새면 **경계가 잘못 그어진 것**이다 → 새는 부분을 `bridge.ts`로 흡수하는 리팩터가 업그레이드 PR에 포함된다
4. `@blocknote/core`의 CSS를 import 하지 않고 **우리 CSS만 쓴다**. 그쪽 클래스명 변경에 화면이 흔들리지 않게

### 11.3 최악의 경우 — TipTap 직접 사용으로 내려가는 탈출 계획

**뒤집는 조건** (DECISIONS.md 형식):

- (a) 한 번의 마이너 업그레이드 비용이 **3일을 넘는 일이 연속 2회**
- (b) IME 회귀가 BlockNote 레이어에서 발생하고 업스트림 수정이 **2주 내 오지 않을 때**
- (c) `_tiptapOptions`가 제거되어 ProseMirror 플러그인 등록 경로가 막힐 때
- (d) `structureNormalizer`가 300줄을 넘어갈 때 (= 스키마로 표현 못 하는 것을 코드로 떠받치고 있다는 신호)

**이관 대상 — BlockNote가 실제로 주는 것 6개**

| BlockNote가 주는 것 | TipTap 직접 사용 시 | 공수 |
|---|---|---|
| 블록에 안정적 `id` | `UniqueID` 익스텐션 (TipTap Pro 아님, 오픈소스 구현 존재) 또는 자체 `blockId` attr + `appendTransaction` | 2일 |
| 중첩 블록 구조 (`blockContainer`/`blockGroup`) | 노드 스펙 2개를 직접 정의. **BlockNote 소스에서 그대로 이식 가능** | 3일 |
| 사이드 메뉴 + 드래그 앤 드롭 | `prosemirror-dropcursor` + 자체 핸들 (좌표 → 위치 계산 ~200줄) | 4일 |
| 슬래시 / suggestion 메뉴 | 우리가 이미 자체 구현 중 (§10.5). **이관 비용 0** | 0 |
| 커스텀 블록의 React 렌더 | TipTap `ReactNodeViewRenderer`. `createReactBlockSpec`이 그 위 얇은 래퍼다 | 2일 |
| HTML 직렬화/파싱 | `parseHTML`/`renderHTML`. 우리 `parse`/`toExternalHTML`이 거의 그대로 매핑 | 1일 |

**총 ~12일.** 이관되지 않는 것은 없다 — 우리가 BlockNote의 협업(Yjs) 통합·기본 블록 세트·
포매팅 툴바를 **하나도 쓰지 않기 때문**이다. `styleSpecs: {}`와 기본 블록 제거(§1.7)가
탈출 비용을 절반으로 줄여 놓은 셈이다.

**이관 후에도 그대로 사는 것**: `packages/editor-core` 전체, 모든 `plugins/*`,
모든 `commands/*`, `ime.ts`, `a11y/*`, CSS, E2E 테스트. **바뀌는 것은 `schema.ts`·`bridge.ts`·
`mount.tsx`·블록 3개뿐이다.**

**하지 않을 것**: Lexical로 가는 것. IME는 좋지만 아웃라인 트리 + 커스텀 인라인 노드를 전부
직접 짜야 하고(ARCHITECTURE §3), 그건 12일이 아니라 6주다. 그리고 우리 플러그인·커맨드가
전부 ProseMirror API라 **한 줄도 재사용되지 않는다.**

---

## 12. 파일 구조와 테스트

### 12.1 어디에 두는가

**`packages/editor-core`(신규, 순수) + `app/.../editor/`(뷰)** 로 나눈다. 구조는 §11.1에 있다.

`packages/`에 두는 것과 `app/`에 두는 것의 기준은 하나다 — **`derive()`와 함께 테스트해야 하는가.**

- `blocksToItems` → `derive()`의 골든 픽스처를 재사용해야 한다 → `packages/`
- `detectSuggestion` → 한국어 문장 픽스처 수백 건 → `packages/`
- `StepRow.tsx` → React·DOM 필요 → `app/`

`packages/editor-core/package.json`은 graph-core와 동일한 규율을 쓴다.

```jsonc
{
  "name": "@workflow/editor-core",
  "type": "module",
  "private": true,
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "node --test \"test/*.test.ts\"", "typecheck": "tsc --noEmit -p tsconfig.json" },
  "dependencies": { "fractional-indexing-jittered": "*" },
  "peerDependencies": { "@workflow/graph-core": "*", "@workflow/paste-parse": "*" }
  // ★ react / @blocknote/* / prosemirror-* 가 여기 등장하면 리뷰에서 막는다
}
```

`tsconfig.json`의 `lib`에서 `"DOM"`을 뺀다 — `document`·`window` 사용이 **컴파일 에러**가 된다.
graph-core가 증명한 방법이고, 정책보다 강하다.

### 12.2 단위 테스트 대상

| 파일 | 대상 | 건수 |
|---|---|---|
| `adapter.roundtrip.test.ts` | 왕복 속성 (§2.9) | 1,000 |
| `adapter.golden.test.ts` | **graph-core 픽스처 36건의 `topologyHash` 동치** | 36 |
| `adapter.loss.test.ts` | L1~L6 손실 지점 회귀 | 6 |
| `inline.test.ts` | `inlineToText ∘ textToInline = title` | 1,000 |
| `sortkey.invariant.test.ts` | 중복 없음 / 단조 / 재발급 0 / 키 길이 상한 | 12 |
| `diff.test.ts` | op 순서 결정성 · tombstone · attrs 부분 패치 | 15 |
| `normalize.test.ts` | N1~N12 (§5.6) | 12 |
| `suggest.test.ts` | 트리거 정탐 40 + **오탐 60** | 100 |
| `caret.test.ts` | §4.3 분기표의 `CaretCtx` 계산 | 30 |
| `schema.smoke.test.ts` | 스키마 조립 · 스타일 부재 · 기본 블록 부재 (BlockNote 필요 → `app/` 쪽) | 8 |
| `controls.registry.test.ts` | 모든 마우스 컨트롤이 `BLOCK_CONTROLS`에 존재 (§10.4) | 1 |

**`suggest.test.ts`에서 오탐 케이스가 정탐보다 많은 것이 의도다.** §6.3의 이유대로
이 기능의 실패 모드는 "못 잡음"이 아니라 "잘못 잡음"이다.

### 12.3 골든 픽스처

세 종류를 둔다.

**(a) 어댑터 골든 — graph-core 재사용 (36건)**

```ts
// packages/editor-core/test/adapter.golden.test.ts
import { fixtures } from '@workflow/graph-core/src/__fixtures__/golden.ts';
import { derive } from '@workflow/graph-core';
import { itemsToBlocks, blocksToItems } from '../src/adapter.ts';

for (const f of fixtures) {
  it(`${f.name} — 왕복 후 위상이 동일하다`, () => {
    const items = f.items;
    const round = blocksToItems(itemsToBlocks(items), {
      prevById: new Map(items.map((i) => [i.id, i])),
      keygen: deterministicKeygen,
    });
    strictEqual(derive(round, f.edges).topologyHash, derive(items, f.edges).topologyHash);
    // 제목·kind·attrs 도 동일
    deepStrictEqual(normalize(round), normalize(items));
  });
}
```

**(b) 붙여넣기 골든 — PARSING 픽스처 6건 + HTML 6건**

`ParseResult` → `EditorNode[]` 변환이 파서 출력을 잃지 않는지. 특히 `depth` → 중첩,
`branchCondition` → `case` 블록, `dropped` → 회색 블록.

**(c) 편집 시나리오 골든 — 신규 20건**

"초기 트리 + 키 시퀀스 → 기대 트리". §4.3 분기표의 각 행이 최소 1건씩.

```ts
{
  name: 'E4+E5 — 갈래 마지막 빈 줄에서 Enter 두 번이면 컨테이너를 벗어난다',
  before: b([ br('금액 기준', [ kase('500만 넘으면', [step('승인')]) ]) ]),
  caret: { blockId: 'step:승인', at: 'end' },
  keys: ['Enter', 'Enter', 'Enter'],   // ① 빈 step ② 새 case ③ 탈출
  after: b([ br('금액 기준', [ kase('500만 넘으면', [step('승인')]) ]), step('') ]),
  caretAfter: { blockId: '<last>', at: 'start' },
}
```

이 픽스처들은 ProseMirror 없이 돈다 — `caret.ts`가 순수 트리 + 오프셋만 다루므로
커맨드의 **결정 로직**을 문서 조작 없이 검증할 수 있다. 실제 문서 조작은 E2E가 맡는다.

### 12.4 E2E 시나리오 목록

`e2e/` — Playwright, Chromium 필수 / WebKit은 IME 제외 스모크만.

**IME (§3.8, CI 필수)** — 10건. 위에 전문이 있다.

**편집**

| # | 시나리오 |
|---|---|
| ED-1 | 빈 문서 → 3단계 작성 → 캔버스에 노드 3개 + 시작/종료 pill |
| ED-2 | 문장 중간 Enter → 분할, 앞 블록 `id` 유지(캔버스 노드가 깜빡이지 않음) |
| ED-3 | `[◇ 갈래 만들기]` → 갈래 2개 + 조건 입력 → 캔버스에 분기 노드 + 라벨 엣지 |
| ED-4 | 갈래 안 3단계 → 마지막 빈 줄 Enter ×2 → 컨테이너 탈출, 새 블록이 분기의 형제 |
| ED-5 | 갈래 삭제 (자식 3개) → 인라인 확인 노출 → `[지우기]` → 토스트 `[되돌리기]` → 복구 |
| ED-6 | 분기 → 작업 타입 변경 → **글자 수 총합이 변하지 않음** |
| ED-7 | 갈래 A의 단계를 갈래 B로 드래그 → `parentId` 변경, 캔버스 반영 |
| ED-8 | `Alt+↑` 5회 → `role="status"`가 `N번째로 이동했습니다` 방출 |
| ED-9 | Tab을 마지막 블록에서 → 포커스가 리사이저로 이동 (키보드 트랩 없음) |
| ED-10 | 중첩 분기 2단 생성 → 3단 시도 → 인라인 안내 + `[새 흐름으로 떼기]` |
| ED-11 | 2택 칩 `여기서 끝` 선택 → 모든 갈래 `joinBehavior='end'` → 캔버스 엣지가 end로 |
| ED-12 | 빈 갈래 → placeholder `→ 여기에 무엇을 하는지 쓰세요` 노출, derive `empty-case` 진단 |

**붙여넣기**

| # | 시나리오 |
|---|---|
| PA-1 | 노션 `text/html` 18줄 → 12단계 + 제안 상태 + `[이대로 가져오기]` |
| PA-2 | 카톡 `text/plain` 30줄 → `confidence=low` → 2단 레이아웃 + `[원문 그대로 넣기]`가 주 버튼 |
| PA-3 | 붙여넣기 후 `⌘Z` **1회** → 원문만 남은 상태 (12번 안 눌러도 됨) |
| PA-4 | 500줄 → 워커 경로 → 스피너 없음 → 회색 블록 → 결과 |
| PA-5 | 200,000자 초과 → 항목 1개 + `글이 너무 길어서 나누지 않고 그대로 넣었어요` |
| PA-6 | **무손실**: 붙여넣은 원문의 모든 비공백 문자가 `items` 어딘가에 존재 (문자 다중집합 비교) |
| PA-7 | 우리 에디터에서 복사 → 같은 문서에 붙여넣기 → id 충돌 없음 (N9) |

**도구·제안**

| # | 시나리오 |
|---|---|
| TL-1 | `엑셀에 정리` → 배지 → 클릭 확정 → 칩 + `set_tools` op |
| TL-2 | 확정 후 `items.title`이 바이트 동일 (`액셀` → `액셀`, `엑셀`로 안 바뀜) |
| TL-3 | 칩 위 Backspace → 원문 텍스트로 복원 + `toolIds`에서 제거 |
| TL-4 | `그 잔디에 물을 준다` → 배지 없음 (`AMBIGUOUS` 문맥) |
| SG-1 | `만약 금액이 크면` → 제안 칩 → 수락 → branch + case 2개, `⌘Z` 1회로 복구 |
| SG-2 | 제안 칩 무시 → 3초 후 소멸 → 같은 줄에서 다시 안 뜸 |
| SG-3 | 갈래 조건 칸에서 `아니면` 입력 → 제안 안 뜸 (G3) |

**저장·복구**

| # | 시나리오 |
|---|---|
| SV-1 | 타이핑 → 800ms → `저장됨`. 중앙값 < 400ms |
| SV-2 | 오프라인 → 계속 편집 → 온라인 → 모든 변경 반영 + `그동안 쓰신 내용까지 모두` 토스트 |
| SV-3 | 탭 2개 → 리더 선출 → 두 번째 탭 `보기 전용` |
| SV-4 | 에디터 강제 크래시(테스트 훅) → `items` 스냅샷에서 재마운트 → 내용 동일 |
| SV-5 | 강제 탭 종료 → 재진입 → IndexedDB 미러 복원 |

**성능 (CI에서 임계값 체크)**

| # | 시나리오 | 임계 |
|---|---|---|
| PF-1 | 200블록 문서 마운트 | < 350ms (`content-visibility` 포함) |
| PF-2 | 200블록에서 한 블록에 10자 타이핑 | 다른 블록 React 렌더 **0회** |
| PF-3 | 200블록 타이핑 중 ELK 호출 | **0회** (`__elkRuns`) |
| PF-4 | 500블록 마운트 | < 900ms, INP < 100ms |

**접근성**

| # | 시나리오 |
|---|---|
| A11-1 | axe-core 위반 0 (에디터 영역) |
| A11-2 | 키보드만으로 3단계 + 갈래 1개 작성 완주 |
| A11-3 | `BLOCK_CONTROLS`의 모든 항목이 `⌘K`에서 도달 가능 |
| A11-4 | 400% 확대에서 가로 스크롤 없음, 2택 칩 세로 스택 |
| A11-5 | 조합 중 `aria-live` 방출 0회 (라이브리전 스파이) |

---

## 13. 열어둔 문제

| # | 문제 | 지금의 처리 | 열 조건 |
|---|---|---|---|
| 1 | `branchChrome`의 전체 순회 비용 | 200블록 기준 허용(2.5ms) | 500블록이 실사용에서 나오면 §9.2의 증분 전략 |
| 2 | `_tiptapOptions` 의존 | 그대로 사용 | 제거되면 §11.3 (c) 발동 |
| 3 | 갈래별 `joinBehavior` 개별 편집 UI | `mixed` 표시만, 개별 편집 불가 | 사용자가 요구하면. 지금은 컨테이너 일괄이 옳다 |
| 4 | 중첩 분기 depth 3+ | 에디터가 만들지 않되 들어오면 받는다 | 접기(collapse)가 캔버스에 들어간 뒤 |
| 5 | 담당자 칩(`personChip`)의 입력 UX | 스키마만 준비. 입력은 메타 카드 스택이 담당 | 인라인 `@` 멘션 요구가 나오면 (Directory Sync 필요) |
| 6 | 모바일 IME 자동 테스트 | 하지 않는다. 수동 체크리스트 | CDP 대체 수단이 생기면 |
| 7 | 조합 중 협업(Yjs) 커서 | 범위 밖 (v1 협업 없음) | CRDT 도입 시. **조합 중 원격 트랜잭션 적용은 별도 설계가 필요하다** |
| 8 | `content-visibility`의 Safari 지원 | `@supports` 폴백 | Safari 18이 사내 표준이 되면 무조건 적용 |
