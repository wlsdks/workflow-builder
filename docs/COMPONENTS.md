# 컴포넌트 라이브러리 명세

> 상태: 초안 v0.1 · 전제 문서: [DESIGN.md](./DESIGN.md)
> 이 문서는 DESIGN.md의 토큰을 **실행 가능한 컴포넌트**로 내리는 층이다. 토큰 값을 바꾸려면 이 문서가 아니라 DESIGN.md를 먼저 고친다.

## 0. 공통 규약

- 스택: React 19 + TypeScript + Tailwind CSS v3.4 + `class-variance-authority` + `tailwind-merge`(`cn`)
- shadcn 원본을 `npx shadcn add` 후 **수정**하는 게 아니라, 아래 코드를 `components/ui/*.tsx`에 **직접 넣는다**. 원본에 남아 있는 `ring-offset-background`, `shadow-sm`, `h-9` 흔적을 지우는 것보다 새로 쓰는 게 싸다.
- 모든 인터랙티브 요소는 `:focus-visible`만 링을 그린다(§20). `outline-none`을 쓰면 **반드시** 대체 링을 같은 셀렉터에 붙인다.
- **트랜지션 대상은 `color / background-color / border-color / box-shadow / opacity`뿐이다.** `transform`은 노드 재배치(§7)와 패널 슬라이드(§11)에서만 쓴다. hover 스케일·눌림 트랜스폼은 전 컴포넌트 금지.
- 아이콘은 항상 `aria-hidden`이고 의미는 텍스트가 진다. 아이콘 단독 버튼만 `aria-label`을 갖는다.

---

## 1. Button

> **용도** — 명시적 액션 1개. 파괴적 액션과 취소를 같은 무게로 그리지 않는다.

### 치수

| size | height | padding | font | icon | radius |
|---|---|---|---|---|---|
| `sm` | 32px | 0 10px | 13 / 1.2 / 600 / -0.005em | 14px | 6px |
| `md` | 36px | 0 14px | 15 / 1.2 / 600 / -0.010em | 16px | 6px |
| `lg` | 44px | 0 18px | 16 / 1.2 / 600 / -0.010em | 18px | 6px |

아이콘 전용 버튼은 정사각(32/36/44) + padding 0. 아이콘–텍스트 gap 6px. 보더는 전 variant 1px(투명이라도 유지 — 있어야 높이가 안 흔들린다).

### 상태

| 상태 | primary(잉크) | secondary | ghost | danger |
|---|---|---|---|---|
| default | `bg #1C1B19` / `text #FFF` / `--edge-raise-ink` | `bg #FFF` / `border n-200` / `--edge-flat` | 투명 / `text n-700` | `bg #B4342B` / `text #FFF` |
| hover | `bg #302E2A` | `bg n-50` / `border n-300` | `bg n-100` | `bg #9E2C24` |
| active | `bg #111110`, 그림자 제거 | `bg n-100` | `bg n-200` | `bg #8A2620` |
| focus-visible | 소프트 링(잉크는 `.28`, 나머지 `.14`) | 동일 + `border brand-500` | 동일 | `rgb(180 52 43/.20)` |
| disabled | `bg n-100 / text paper-400 / border n-200`, 그림자 제거, `cursor: not-allowed` | 동일 | `text paper-400`, 배경 없음 | 동일 |
| loading | 라벨을 `loadingText`로 교체 | 동일 | 동일 | 동일, `aria-busy="true"`, 폭 고정, `cursor: progress`. **스피너 없음** |

`active`에서 그림자를 빼는 것이 "눌림"의 전부다. `translateY`를 쓰지 않는다.

### 코드

```tsx
// components/ui/button.tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const button = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-sm border font-semibold " +
    "whitespace-nowrap select-none transition-[background-color,border-color,box-shadow,color] " +
    "duration-fast ease-out outline-none disabled:cursor-not-allowed " +
    "disabled:bg-paper-100 disabled:text-paper-550 disabled:border-paper-450 disabled:shadow-none",
  {
    variants: {
      variant: {
        primary:
          "bg-ink text-paper-0 border-ink shadow-edge-raise-ink " +
          "hover:bg-ink-600 active:bg-ink-900 active:shadow-none " +
          "focus-visible:shadow-focus-ink",
        secondary:
          "bg-paper-0 text-paper-900 border-paper-200 shadow-edge-flat " +
          "hover:bg-paper-50 hover:border-paper-450 active:bg-paper-100 active:shadow-none " +
          "focus-visible:border-brand-500 focus-visible:shadow-focus",
        ghost:
          "bg-transparent text-paper-700 border-transparent shadow-none " +
          "hover:bg-paper-100 active:bg-paper-200 " +
          "focus-visible:border-brand-500 focus-visible:shadow-focus",
        danger:
          "bg-danger text-paper-0 border-danger shadow-edge-raise-ink " +
          "hover:bg-danger-600 active:bg-danger-700 active:shadow-none " +
          "focus-visible:shadow-focus-danger",
      },
      size: {
        sm: "h-ctl-sm px-2.5 text-label tracking-label-tight",
        md: "h-ctl-md px-3.5 text-body leading-none tracking-btn",
        lg: "h-ctl-lg px-[18px] text-[16px] leading-none tracking-btn",
      },
      iconOnly: { true: "px-0 aspect-square", false: "" },
    },
    defaultVariants: { variant: "secondary", size: "md", iconOnly: false },
  }
);

export interface ButtonProps
  extends React.ComponentPropsWithoutRef<"button">,
    VariantProps<typeof button> {
  loading?: boolean;
  /** loading 중 라벨. 기본 "처리 중…" — 스피너 대신 이 텍스트가 상태를 말한다 */
  loadingText?: string;
  asChild?: boolean;
}

export function Button({
  className, variant, size, iconOnly,
  loading = false, loadingText = "처리 중…",
  children, disabled, ...props
}: ButtonProps) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [lockedWidth, setLockedWidth] = React.useState<number>();
  // 라벨 교체로 폭이 튀는 것을 막는다 — 레이아웃 시프트가 스피너보다 더 산만하다
  React.useLayoutEffect(() => {
    if (loading && ref.current) setLockedWidth(ref.current.offsetWidth);
    if (!loading) setLockedWidth(undefined);
  }, [loading]);

  return (
    <button
      ref={ref}
      className={cn(button({ variant, size, iconOnly }), className)}
      style={lockedWidth ? { minInlineSize: lockedWidth } : undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? loadingText : children}
    </button>
  );
}
```

### 접근성
- 네이티브 `<button>`만 쓴다. `<div role="button">` 금지.
- 아이콘 전용: `aria-label` 필수, 히트 영역 최소 32×32.
- `loading` 시 `disabled`가 걸리므로 포커스를 잃는다 → 폼 제출 버튼은 `aria-disabled`로 대체하고 `onClick`에서 early-return 하는 패턴을 권장(포커스 유지).
- danger 버튼은 다이얼로그 안에서 **초기 포커스를 받지 않는다**(취소가 받는다).

### 안티패턴
- Primary를 `brand-600`으로 칠하는 것. **Primary는 잉크다.** 그린은 포커스 링·링크·선택 상태에만.
- 한 화면에 primary 2개.
- 로딩 스피너, `animate-pulse`, `hover:scale-105`, `active:translate-y-px`.
- `shadow-sm` 추가.

---

## 2. Input / Textarea

> **용도** — 값 입력. 아웃라인 본문은 이걸 쓰지 않는다(§5 OutlineBlock).

### 치수

- Input `md`: h 36px / padding 0 12px / radius 6px / border 1px `paper-300` / bg `n-0` / 15px·1.4·400·-0.005em
- Input `lg`(온보딩): h 44px / padding 0 14px / 16px·1.4
- Textarea: min-h 88px / padding 10px 12px / line-height **1.65** / `field-sizing: content`(미지원 시 auto-grow 훅)
- placeholder `paper-400`. **라벨을 인쇄하지 않는다**(원칙 1) — 시각 라벨이 필요 없으면 `aria-label`로만 붙인다.

### 상태

| 상태 | 변화 |
|---|---|
| default | `border n-300`, 그림자 없음 |
| hover | `border paper-400` |
| focus | `border brand-500` + `box-shadow: 0 0 0 3px rgb(42 115 88/.14)`, caret `brand-600` |
| error | `border danger` + `0 0 0 3px rgb(180 52 43/.14)`, 하단 13px `danger` 메시지, `aria-invalid` |
| disabled | `bg n-50 / text paper-400 / border n-200`, placeholder 숨김 |
| **composing (IME)** | 포커스 링 유지, **에러 스타일·검증 메시지 전부 억제**, 자동 서식·자동완성 팝오버 억제, 상위 다이어그램 재배치 트리거 차단 |

한국어 조합 중 상태는 장식이 아니라 **버그 방지 장치**다. `onChange`만 보면 "ㄱ", "가", "각"이 모두 확정 입력으로 처리돼 (1) 글자마다 에러가 깜빡이고 (2) ELK 재배치가 프레임마다 돈다.

```tsx
// hooks/use-composition.ts
export function useComposition() {
  const [composing, setComposing] = React.useState(false);
  return {
    composing,
    bind: {
      onCompositionStart: () => setComposing(true),
      onCompositionEnd: () => setComposing(false),
      "data-composing": composing || undefined,
    },
  };
}
```

```tsx
const inputBase =
  "w-full rounded-sm border border-paper-450 bg-paper-0 text-paper-900 " +
  "placeholder:text-paper-550 caret-brand-600 outline-none " +
  "transition-[border-color,box-shadow] duration-fast ease-out " +
  "hover:border-paper-450 " +
  "focus:border-brand-500 focus:shadow-focus " +
  "disabled:bg-paper-50 disabled:text-paper-550 disabled:border-paper-450 disabled:placeholder:text-transparent " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:shadow-focus-danger " +
  // 조합 중에는 에러 표현을 되돌린다
  "data-[composing]:!border-brand-500 data-[composing]:!shadow-focus";

export interface InputProps extends Omit<React.ComponentPropsWithoutRef<"input">, "size"> {
  size?: "md" | "lg";
  error?: string;
  /** 조합 중 onValueCommit을 지연시켜 상위 재배치를 막는다 */
  onValueCommit?: (v: string) => void;
}
```

### 접근성
- 시각 라벨이 없으면 `aria-label`, 있으면 `<label htmlFor>`. placeholder를 라벨로 쓰지 않는다.
- 에러: `aria-invalid="true"` + `aria-describedby="{id}-error"`, 에러 노드는 `role="alert"`.
- Textarea에서 Enter는 줄바꿈, `⌘/Ctrl+Enter`가 제출.
- `autocomplete`는 이름·이메일에만. 업무 텍스트에는 `autocomplete="off" spellcheck="false"`.

### 안티패턴
- `ring-2 ring-offset-2`. 오프셋 링은 인풋이 밀려 보인다.
- 조합 중 실시간 검증 / 조합 중 `onChange`마다 서버 저장.
- 필드 위에 "업무명" 같은 라벨을 박는 것(원칙 1).
- Textarea 우하단 리사이즈 그립 노출(`resize-none` + auto-grow).

---

## 3. Badge / Chip

> **용도** — 분류 표식. 값 하나를 짧게. 숫자 집계는 칩으로 만들지 않는다(원칙 2).

### 4종 규격

| 종류 | 높이 | radius | 배경 / 보더 | 폰트 |
|---|---|---|---|---|
| 도구 칩 `tool` | 20px | 6px | `paper-100` / 없음 | 11 / 500 / `paper-700` + 12px 라인 아이콘 |
| 부서 칩 `dept` | 24px | full | `paper-100` / 1px `paper-200` | 13 / 500 / `paper-700` |
| 시간 칩 `duration` | 24px | 6px | `n-0` / 1px `paper-200` | 13 / 500 / `paper-700` + DurationBar |
| 선택 칩 `selectable` | 32px | full | `n-0` / 1px `paper-200` | 13 / 500 |

패딩: 도구 `0 7px`, 부서·시간 `0 9px`, 선택 `0 12px`. 아이콘 gap 4px. 제거 버튼은 우측 `-2px` 오프셋, 히트 20×20.

### 상태
- `selectable` default → hover `bg n-50 border n-300` → **selected** `bg brand-50 / border brand-500 / text brand-700` + 12px `check` → focus-visible 소프트 링 → disabled `bg n-50 text paper-400`.
- `removable`: x 아이콘 hover 시 `bg n-200` 원형, 칩 자체 색은 안 변한다.
- 도구 칩은 상태가 없다(비인터랙티브). 4개 초과는 `+2` 칩으로 접고 나머지는 팝오버.

```tsx
export interface ChipProps extends React.ComponentPropsWithoutRef<"span"> {
  variant?: "tool" | "dept" | "duration" | "selectable";
  icon?: React.ReactNode;
  selected?: boolean;               // selectable 전용 → aria-pressed
  onToggle?: (next: boolean) => void;
  onRemove?: () => void;            // 있으면 제거 버튼 렌더
  removeLabel?: string;             // 기본 `${children} 제거`
}
```

```tsx
const chip = cva("inline-flex items-center gap-1 font-medium select-none align-middle", {
  variants: {
    variant: {
      tool: "h-5 rounded-sm px-[7px] bg-paper-100 text-paper-700 text-[11px] leading-none",
      dept: "h-6 rounded-full px-[9px] bg-paper-100 border border-paper-200 text-paper-700 text-label",
      duration: "h-6 rounded-sm px-[9px] bg-paper-0 border border-paper-200 text-paper-700 text-label tabular-nums",
      selectable:
        "h-8 rounded-full px-3 bg-paper-0 border border-paper-200 text-paper-700 text-label cursor-pointer " +
        "transition-[background-color,border-color,color,box-shadow] duration-fast ease-out " +
        "hover:bg-paper-50 hover:border-paper-450 outline-none focus-visible:shadow-focus " +
        "aria-pressed:bg-brand-50 aria-pressed:border-brand-500 aria-pressed:text-brand-700",
    },
  },
});
```

### 접근성
- `selectable`은 `<button type="button" aria-pressed>`. 여러 개가 한 그룹이면 `role="group" aria-label="도구 선택"`으로 감싼다.
- 제거 버튼은 별도 `<button aria-label="Slack 제거">`. 칩 전체를 클릭 대상으로 삼고 제거를 겹치지 않는다.
- 색만으로 selected를 표현하지 않는다 → `check` 아이콘 동반.

### 안티패턴
- 신호등 색 칩(`bg-red-100` 지연, `bg-green-100` 정상). 원칙 3 위반.
- 도구 브랜드 로고·브랜드 색 사용(§DESIGN 6.2).
- 칩 안에 `12단계 · 67%` 같은 집계 삽입.

---

## 4. Card

> **용도** — 서피스 1장. 그림자로 띄우지 않고 **보더와 배경 톤**으로 층을 만든다.

| 종류 | padding | radius | 배경 | 보더 | 그림자 |
|---|---|---|---|---|---|
| `document` 문서 카드 | 16px | 12px | `n-0` | 1px `paper-200` | **없음** + `--edge-flat` |
| `summary` 요약 카드 | 20px | 12px | `brand-50` | 1px `brand-100` | 없음 |
| `stack` 메타 카드 | 24px | 14px | `n-0` | 1px `paper-200` | `--shadow-float` (실제로 떠 있음) |

`stack`은 폭 420px 고정(온보딩 카드 스택). 카드 안 제목 18/1.45/600, 본문 15/1.65/400, 캡션 12/1.5/500 `paper-500`.

### 상태
default → hover(`document`만) `border n-300` + `bg n-25` → focus-visible 소프트 링 → **selected** `border brand-500` + `box-shadow: 0 0 0 3px rgb(42 115 88/.12)` → disabled `opacity` 대신 `text paper-400` + `bg n-50`.

`summary`·`stack`은 hover 상태를 갖지 않는다(클릭 대상이 아니다).

```tsx
export interface CardProps extends React.ComponentPropsWithoutRef<"div"> {
  variant?: "document" | "summary" | "stack";
  interactive?: boolean;   // true면 button 의미론 부여
  selected?: boolean;
}
```

```tsx
const card = cva("relative", {
  variants: {
    variant: {
      document: "rounded-md border border-paper-200 bg-paper-0 p-4 shadow-edge-flat",
      summary:  "rounded-md border border-brand-100 bg-brand-50 p-5",
      stack:    "w-[420px] rounded-lg border border-paper-200 bg-paper-0 p-6 shadow-float",
    },
    interactive: {
      true: "cursor-pointer outline-none transition-[background-color,border-color,box-shadow] " +
            "duration-fast ease-out hover:border-paper-450 hover:bg-paper-25 " +
            "focus-visible:border-brand-500 focus-visible:shadow-focus " +
            "aria-selected:border-brand-500 aria-selected:shadow-ring-select",
    },
  },
});
```

### 접근성
- `interactive` 카드는 `<button>`이거나 카드 안 제목이 유일한 링크(카드 전체는 `::after` 확장 히트 영역). 중첩 인터랙티브 금지.
- 리스트 안이면 `role="listitem"`, 선택형이면 `role="option" aria-selected`.

### 안티패턴
- `shadow-sm`으로 카드 구분. 50장이 쌓이면 화면이 뿌예진다.
- 카드마다 radius를 다르게(12px 고정, 떠 있는 카드만 14px).
- 카드 안에 진행률 바.

---

## 5. OutlineBlock

> **용도** — 아웃라인 한 줄. 사용자가 실제로 "글을 쓰는" 유일한 곳.

> ## ⚠️ 이 절과 §6은 **크롬(chrome) 명세**다 — 구현 명세가 아니다
>
> 초안은 이 두 컴포넌트를 `<textarea>`·`<input>` 기반 React 컴포넌트로 그렸다. **폐기한다.**
>
> **에디터 본체는 BlockNote(ProseMirror)다** — D-034, D-108, [EDITOR.md](./EDITOR.md).
> contenteditable 안에 controlled `<textarea>`/`<input>`을 두는 것은 **D-034가 금지한 바로 그 패턴**이고,
> undo 스택 분기 · 선택 끊김 · IME 표면 이중화를 일으킨다.
>
> | 이 문서가 정하는 것 | EDITOR.md가 정하는 것 |
> |---|---|
> | 치수·간격·색·상태별 시각 변화 | 블록 스키마, `contentRef`, 트랜잭션 |
> | 거터·드래그핸들·`+`·`⋯` 배치 | 키보드 커맨드, IME 처리 |
> | 데코레이션의 **생김새** | 데코레이션의 **동작** |
>
> 아래 JSX는 **레이아웃 참조용**이다. 텍스트 영역은 전부 `contentRef`로 대체한다.

### 치수
```
행 높이      min 40px (텍스트 15/1.65 + padding 10px 0)
블록 간 gap  4px
좌측 거터    40px  = 드래그 핸들 16px + gap 4 + [+] 20px
우측 거터    28px  = ⋯ 24px
들여쓰기     depth × 20px (최대 depth 2)
텍스트 영역  flex-1, border 0, bg transparent, radius 4px
활성 행 배경 n-25 (radius 6px, 좌우 -8px 확장)
```

### 상태

| 상태 | 컨트롤 | 배경 |
|---|---|---|
| default | `opacity 0`, `pointer-events:none` | 투명 |
| hover | `opacity 1` (140ms) | `paper-25` |
| **cursor(활성)** | **`opacity 1` 상시** — 커서가 있는 줄은 컨트롤이 사라지지 않는다 | `paper-25` |
| focus-visible(핸들·버튼) | 소프트 링 | — |
| dragging | 원본 `opacity .4`, 고스트에 `--shadow-drag`, 삽입 지점 2px `brand-500` 라인 | — |
| composing | 컨트롤 유지, **재배치 트리거 억제** | — |
| disabled(읽기 전용 공유) | 컨트롤 미렌더 | 투명 |

"커서 있는 줄 상시 표시"가 핵심이다. hover에만 의존하면 키보드 사용자와 터치 사용자가 `+`·`⋯`를 영원히 못 본다.

```tsx
export interface OutlineBlockProps {
  id: string;
  text: string;
  depth: 0 | 1 | 2;
  active: boolean;                    // 커서 보유
  dragging?: boolean;
  readOnly?: boolean;
  onChange: (id: string, text: string) => void;
  onEnter: (id: string, caretAtEnd: boolean) => void;
  onIndent: (id: string, dir: 1 | -1) => void;
  onMove: (id: string, dir: 1 | -1) => void;
  onDelete: (id: string) => void;
  onInsertAfter: (id: string) => void;
  onOpenMenu: (id: string, anchor: HTMLElement) => void;
  onSlashCommand: (id: string, query: string) => void;   // '/' → CommandPalette
}
```

```tsx
<div
  data-active={active || undefined}
  className={cn(
    "group/blk relative flex items-start gap-1 rounded-sm px-2 -mx-2 py-2.5",
    "transition-colors duration-fast ease-out",
    "hover:bg-paper-25 data-[active]:bg-paper-25"
  )}
  style={{ paddingInlineStart: 8 + depth * 20 }}
>
  <span className={cn(
    "flex w-10 shrink-0 items-center gap-1 opacity-0 pointer-events-none",
    "transition-opacity duration-fast ease-out",
    "group-hover/blk:opacity-100 group-hover/blk:pointer-events-auto",
    "group-focus-within/blk:opacity-100 group-focus-within/blk:pointer-events-auto",
    "group-data-[active]/blk:opacity-100 group-data-[active]/blk:pointer-events-auto"
  )}>
    <button aria-label="순서 바꾸기" className="h-5 w-4 cursor-grab text-paper-550 hover:text-paper-700 active:cursor-grabbing">
      <GripVertical size={16} strokeWidth={1.75} aria-hidden />
    </button>
    <button aria-label="아래에 단계 추가" className="grid h-5 w-5 place-items-center rounded-xs text-paper-550 hover:bg-paper-200 hover:text-paper-700">
      <Plus size={16} strokeWidth={1.75} aria-hidden />
    </button>
  </span>
  {/* textarea: rows=1 + field-sizing:content */}
</div>
```

### 키보드
| 키 | 동작 |
|---|---|
| `Enter` | 아래에 새 블록(커서가 중간이면 분할) |
| `Tab` / `Shift+Tab` | 들여쓰기 ±1 (포커스 이동 아님 — 마지막 블록의 `Tab`만 다음 영역으로) |
| `Backspace`(빈 줄/맨 앞) | 이전 블록과 병합 |
| `Alt+↑ / Alt+↓` | 블록 이동 |
| `↑ / ↓` | 이전·다음 블록으로 캐럿 이동 |
| `/` (줄 시작) | CommandPalette |
| `⌘.` | ⋯ 메뉴 |

### 접근성
- 컨테이너 `role="list"`, 블록 `role="listitem"`. 텍스트는 `<textarea aria-label="단계 내용">`.
- 드래그는 **키보드 대체 경로(`Alt+↑↓`)가 필수**. 핸들에 `aria-describedby`로 안내.
- 이동 결과는 `role="status"`로 "3번째로 이동했습니다" 알림.

### 안티패턴
- 컨트롤을 hover에만 노출.
- 컨트롤 등장/퇴장에 `transform` 사용(글자가 밀린다 → opacity만).
- 타이핑마다 다이어그램 재배치(DESIGN 6.6-1).
- 블록마다 삭제 아이콘 상시 노출(⋯ 안으로).

---

## 6. BranchContainer

> **크롬 명세.** §5의 경고가 그대로 적용된다 — 조건 입력은 `<input>`이 아니라 `contentRef`,
> 하단 버튼줄(`[+경우 추가]`/`[갈래 끝내기]`/2택 칩)은 **위젯 데코레이션**이다.
> 진짜 블록으로 만들면 그게 `Item`이 되어 버린다 (D-108).

> **용도** — 분기를 "자연어 껍데기"로 감싼다. 사용자는 조건식이 아니라 문장을 쓴다.

### 치수
```
좌측 컬러바   4px, 전체 높이, radius 좌측만 md
배경          #FCF8F1  (branch #9E6511 6% over n-0)
보더          1px n-200 (좌측 제외)
radius        12px
패딩          12px 14px 12px 18px
케이스 행     min-h 36px, gap 6px
문장 조각     15/1.65/400 n-700  ·  인라인 인풋 h 32 / min-w 120 / radius 6
푸터 버튼     ghost sm, gap 8px, margin-top 10px
2택 칩        selectable chip 32px ×2, margin-top 10px, 상단 1px n-200 구분선 + 10px
```

문구 고정: 첫 행 `만약 [____]라면`, 이후 `아니면 [____]라면`, 마지막 행 뒤 `[+ 경우 추가]` `[갈래 끝내기]`. 하단 2택은 `이어짐` / `여기서 끝`.

### 상태
default → hover(컬러바 `#8F5B0F`) → focus-within(보더 `brand-500` + 소프트 링) → **incomplete**(빈 조건이 있으면 해당 인풋만 `border paper-400 dashed`, 에러 아님 — 미완성은 잘못이 아니다) → collapsed(케이스 요약 1줄 + `+2 갈래`).

### 코드 / 시그니처
```tsx
export interface BranchCase { id: string; condition: string; childBlockIds: string[]; }
export interface BranchContainerProps {
  id: string;
  cases: BranchCase[];
  /** 갈래 종료 후 흐름 — 'merge' 이어짐 | 'end' 여기서 끝 */
  after: "merge" | "end";
  collapsed?: boolean;
  onAddCase: (id: string) => void;
  onCloseBranch: (id: string) => void;         // [갈래 끝내기]
  onChangeCondition: (caseId: string, v: string) => void;
  onChangeAfter: (id: string, v: "merge" | "end") => void;
}
```

```tsx
<section
  aria-label="분기"
  className="relative rounded-md border border-paper-200 bg-branch-tint pl-[18px] pr-3.5 py-3
             focus-within:border-brand-500 focus-within:shadow-focus
             transition-[border-color,box-shadow] duration-fast ease-out"
>
  <span aria-hidden className="absolute inset-y-0 left-0 w-1 rounded-l-md bg-branch" />
  {cases.map((c, i) => (
    <p key={c.id} className="flex min-h-9 items-center gap-1.5 text-body text-paper-700">
      {i === 0 ? "만약" : "아니면"}
      <input className="h-8 min-w-[120px] rounded-sm border border-paper-200 bg-paper-0 px-2 text-body
                        focus:border-brand-500 focus:shadow-focus outline-none"
             value={c.condition} aria-label={`${i + 1}번째 경우의 조건`} />
      라면
    </p>
  ))}
</section>
```

### 접근성
- `<section aria-label="분기">` + 각 케이스 `<fieldset>`은 쓰지 않는다(스크린리더에서 "폼"으로 읽힌다 — 원칙 1).
- 2택 칩은 `role="radiogroup" aria-label="갈래가 끝난 뒤"` + `role="radio" aria-checked`, ←→로 이동.
- `[갈래 끝내기]`는 파괴적이지 않다 → ghost. 실제 삭제만 danger.

### 안티패턴
- `IF / ELSE IF / ELSE` 영문 키워드 노출.
- 조건 입력을 드롭다운(연산자 선택)으로 만드는 것. 자연어 한 줄이 전부다.
- 컬러바를 빨강으로.
- 중첩 분기 3단계 이상 허용(depth 2에서 막고 "새 흐름으로 분리" 제안).

---

## 7. WorkflowNode

> **용도** — 캔버스 노드. **260×76px 고정**이 자동 레이아웃 안정성의 전제다.

### 치수
```
크기      260 × 76px  (고정. 렌즈·줌·내용과 무관)
radius    12px   보더 1.5px n-200 (캔버스), 1px (내보내기)
배경      #FFFFFF   그림자 0 1px 2px rgb(28 27 25/.06) — 한 겹
패딩      14px 16px 14px 19px      좌측 액센트 바 3px
제목      15/1.45/600/-0.01em n-900, 좌측 정렬, line-clamp 2
메타 스트립 하단 24px 고정 예약 (비어도 유지)
아이콘    좌상단 16px, n-500, strokeWidth 1.75
```

| 타입 | 액센트 바 | 보더 | 실루엣 | 아이콘 |
|---|---|---|---|---|
| `task` | 없음 | 1.5px `paper-200` | 평범 | `square-check` |
| `branch` | 3px `#9E6511` | 1.5px `paper-200` | 하단 중앙 노치 16×7 (`clip-path`) | `git-branch` |
| `hold` | 3px `#6E4666` | **1.5px dashed `paper-300`** | 대시 | `clock` |

### 상태
| 상태 | 변화 |
|---|---|
| default | 위 규격 |
| hover | `border paper-400`, 300ms 후 240px 팝오버 |
| selected | `border 2px brand-500` + `box-shadow: 0 0 0 4px rgb(42 115 88/.12)` (보더 두께 변화는 `inset box-shadow`로 흡수해 **크기 불변**) |
| focus-visible | selected와 동일 링 + `outline` 없음 |
| dragging | `--shadow-drag`, `opacity .95`, `cursor: grabbing` |
| dimmed(렌즈) | `opacity .45` + `grayscale(1)`, 200ms `--ease-flow` |
| flagged(짜증 렌즈) | `bg #FBF7F9` + `border 1.5px #6E4666` |
| ghost(다음 단계 유도) | `1.5px dashed n-300`, 배경 투명, 중앙 13px `paper-400` |

**보더 두께를 실제로 바꾸면 안 된다.** `border: 1.5px` 고정 + `box-shadow: inset 0 0 0 2px var(--brand-500)`로 선택을 그린다. 1px 차이가 ELK 좌표에 반영되면 선택할 때마다 그래프가 떨린다.

```tsx
export interface WorkflowNodeData {
  id: string;
  type: "task" | "branch" | "hold";
  title: string;
  assignee?: { name: string };
  durationBucket?: 1 | 2 | 3 | 4;
  tools?: string[];
  automatable?: boolean;
  flagged?: boolean;
}
export interface WorkflowNodeProps {
  data: WorkflowNodeData;
  lens: LensId;
  selected?: boolean;
  dimmed?: boolean;
  dragging?: boolean;
}
```

```tsx
<div
  className={cn(
    "relative box-border h-[76px] w-[260px] rounded-md border-[1.5px] border-paper-200 bg-paper-0",
    "pl-[19px] pr-4 pt-3.5 pb-0 shadow-node outline-none",
    "transition-[box-shadow,border-color,opacity,filter] duration-base ease-flow",
    "hover:border-paper-450",
    selected && "shadow-node-selected",
    dimmed && "opacity-45 grayscale",
    dragging && "shadow-drag opacity-95",
    type === "hold" && "border-dashed border-paper-450"
  )}
  role="button" tabIndex={-1}
  aria-label={`${typeLabel[type]}: ${title}`} aria-pressed={selected}
>
  {type !== "task" && (
    <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px] rounded-l-md",
      type === "branch" ? "bg-branch" : "bg-hold")} />
  )}
  <p className="line-clamp-2 text-node font-semibold text-paper-900">{title}</p>
  <div className="absolute inset-x-4 bottom-0 flex h-6 items-center gap-1.5">{/* 메타 3슬롯 */}</div>
</div>
```

### 접근성
- 캔버스는 **탭 스톱 1개**(`role="application" aria-label="업무 흐름 다이어그램"`). 내부 노드는 `tabIndex={-1}` + 방향키 이동(roving focus).
- 선택 시 `role="status"`로 "3번째 단계, 견적서 작성, 담당 김지수" 낭독.
- 캔버스 옆에 **동일 내용의 순서 리스트**를 `sr-only`로 항상 제공한다(다이어그램은 보조 표현).

### 안티패턴
- 내용 길이에 따른 가변 높이.
- 마름모·원형 등 형태 변형(한글 줄바꿈 파탄).
- 상태 색(빨강/초록) 사용.
- 노드에 4번째 메타 슬롯 추가.

---

## 8. Avatar

> **용도** — 담당자 식별. **사진을 쓰지 않는다** — 사진은 즉시 인사 시스템 톤이 된다.

### 치수
- 20px 원형(노드·아웃라인) / 24px(인스펙터) / 28px(공유 페이지 헤더)
- 이니셜 11px(20px 기준) / 600 / `letter-spacing: 0` / 중앙 정렬, `line-height: 1`
- 한글: **성 + 이름 첫 자** 2글자(`김지수` → `김지`). 라틴: 첫 글자 2개 대문자
- 배경: 이름 해시 → 채도 낮은 8색. 텍스트는 항상 해당 색의 `700` 톤
- 스택: `margin-left: -6px`, `ring: 2px var(--n-0)`, 최대 3개 + `+2`

```ts
export const AVATAR_HUES = [
  { bg: "#E7E3DC", fg: "#4A463F" }, { bg: "#DDE7E0", fg: "#33513E" },
  { bg: "#E4E2EA", fg: "#454154" }, { bg: "#EBE3DA", fg: "#5A4633" },
  { bg: "#DFE6E8", fg: "#37474C" }, { bg: "#EAE1E4", fg: "#54404A" },
  { bg: "#E3E7DD", fg: "#414B36" }, { bg: "#E9E5DE", fg: "#4F4A42" },
] as const;

export function avatarIndex(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % AVATAR_HUES.length;
}
export function initials(name: string) {
  const t = name.trim();
  return /[가-힣]/.test(t) ? t.slice(0, 2) : t.split(/\s+/).slice(0, 2).map(s => s[0]!.toUpperCase()).join("");
}
```

```tsx
export interface AvatarProps { name: string; size?: 20 | 24 | 28; muted?: boolean; }
```

### 상태
default / muted(렌즈 dim 시 `opacity .45`) / stacked(겹침 + ring) / empty(담당자 미지정 → **아바타를 렌더하지 않는다**. 물음표 아바타는 "안 채웠다"는 질책으로 읽힌다).

### 접근성
- `role="img" aria-label="김지수"` + `title`. 이니셜 자체는 `aria-hidden`.
- 8색은 **식별자이지 의미가 아니다** → 색을 범례로 만들지 않는다.
- 스택은 `role="list"`, `+2`는 `aria-label="외 2명"`.

### 안티패턴
- 사진 업로드, gravatar.
- 랜덤 채도 높은 색(HSL 랜덤 hue).
- 이름 없는 자리에 회색 사람 아이콘 표시.

---

## 9. DurationBar

> **용도** — 소요시간 4단계. 텍스트보다 스캔이 빠르고, 숫자 합산을 유도하지 않는다.

### 치수
```
세그먼트   3px(w) × 10px(h), radius 1px, gap 2px → 총 폭 18px
채움       n-700     빈칸  n-200
4단계 라벨 1 몇 분 · 2 한 시간쯤 · 3 반나절 · 4 하루 이상
시간 렌즈  세그먼트 높이 12px + 우측 13px 텍스트 라벨 동반
```

```tsx
export interface DurationBarProps {
  level: 1 | 2 | 3 | 4;
  showLabel?: boolean;
  size?: "sm" | "md";   // sm 10px, md 12px
}

const LABEL = { 1: "몇 분", 2: "한 시간쯤", 3: "반나절", 4: "하루 이상" } as const;

export function DurationBar({ level, showLabel, size = "sm" }: DurationBarProps) {
  return (
    <span role="img" aria-label={`소요시간 ${LABEL[level]}`} className="inline-flex items-center gap-1.5">
      <span aria-hidden className="flex items-end gap-[2px]">
        {[1, 2, 3, 4].map(i => (
          <i key={i} className={cn("w-[3px] rounded-[1px]", size === "sm" ? "h-2.5" : "h-3",
            i <= level ? "bg-paper-700" : "bg-paper-200")} />
        ))}
      </span>
      {showLabel && <span className="text-label text-paper-700 tabular-nums">{LABEL[level]}</span>}
    </span>
  );
}
```

### 상태
default / dimmed(`opacity .45`) / unset(**렌더하지 않음** — 빈 막대 4개는 결핍으로 읽힌다) / over-threshold(level 4일 때만 노드 보더 `1.5px #9E6511`, 막대 색은 그대로).

### 안티패턴
- 막대를 색으로 구분(1=초록, 4=빨강). 원칙 3 위반.
- 세그먼트를 5단계 이상으로 확장.
- 총합 계산 표시.

---

## 10. LensSwitcher

> **용도** — 같은 그래프를 5가지로 읽는다. **전환해도 노드는 1px도 안 움직인다.**

### 치수
```
컨테이너  h 32px, bg n-100, radius 8px, padding 2px, gap 0
아이템    h 28px, padding 0 10px, radius 6px, 13/500, gap 4px, icon 14px
활성      bg n-0 + --edge-flat + 1px n-200 + text n-900 600
전환      배경만 140ms; 캔버스 내용은 200ms cubic-bezier(.2,.8,.2,1) 크로스페이드
단축키    1~5
```

| id | 라벨 | 아이콘 |
|---|---|---|
| `flow` | 흐름 | `route` |
| `people` | 사람 | `users` |
| `time` | 시간 | `clock` |
| `tools` | 도구 | `wrench` |
| `friction` | 짜증 | `frown` |

```tsx
export type LensId = "flow" | "people" | "time" | "tools" | "friction";
export interface LensSwitcherProps {
  value: LensId;
  onChange: (v: LensId) => void;
  /** 데이터가 없는 렌즈는 흐리게 두되 비활성화하지 않는다 — 눌러보고 비어 있음을 알게 한다 */
  sparse?: LensId[];
}
```

```tsx
<div role="radiogroup" aria-label="보기 방식" className="inline-flex h-8 items-center gap-0 rounded-lg bg-paper-100 p-0.5">
  {LENSES.map(l => (
    <button key={l.id} role="radio" aria-checked={value === l.id}
      tabIndex={value === l.id ? 0 : -1}
      onClick={() => onChange(l.id)}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-sm px-2.5 text-label text-paper-500 outline-none",
        "transition-[background-color,color,box-shadow] duration-fast ease-out",
        "hover:text-paper-900 focus-visible:shadow-focus",
        value === l.id && "bg-paper-0 border border-paper-200 font-semibold text-paper-900 shadow-edge-flat"
      )}>
      <l.Icon size={14} strokeWidth={1.75} aria-hidden />{l.label}
    </button>
  ))}
</div>
```

### 접근성
- `role="radiogroup"` + roving tabindex(←→ 이동, Home/End). 탭 스톱은 1개.
- 전환 시 `role="status"`로 "사람 렌즈. 담당자와 인계 지점을 표시합니다" 낭독.
- 짜증 렌즈는 `grayscale` 의존이므로 **flagged 노드에 보더 강조를 동반**한다(색만으로 신호 금지).

### 안티패턴
- 렌즈 전환 시 재레이아웃(ELK 재실행). 위치 변경은 신뢰를 즉시 깎는다.
- 5개를 드롭다운으로 접기(전환 비용이 올라가면 아무도 안 쓴다).
- 활성 탭에 `brand-600` 채움 배경(세그먼트는 잉크도 그린도 아니고 흰 종이다).

---

## 11. Inspector

> **용도** — 노드 1개의 전체 메타. **열려도 캔버스가 리플로우되지 않는다.**

### 치수
```
폭        360px 고정, 우측 fixed, top 52px(상단바 아래) ~ bottom 0
배경      n-0     보더  좌측 1px n-200     그림자 --shadow-float (오버레이이므로 허용)
헤더      52px, padding 0 16px, 제목 15/600, 우측 닫기 28px
섹션      padding 16px, 구분선 1px n-200
섹션 제목 12/1.5/500/+0.005em n-500  ← 인스펙터는 원칙 1의 예외(문서가 아니라 속성 패널)
행        min-h 36px, 라벨 13/500 n-500 (좌 96px) + 값 flex-1
진입      transform: translateX(100%) → 0, 200ms --ease-flow, opacity 동반
```

캔버스는 `padding-right`를 바꾸지 않는다. 인스펙터는 **떠 있는 층**이고, 필요하면 캔버스가 선택 노드를 시야에 넣도록 `translate`만 한다(레이아웃 재계산 아님).

### 상태
closed(unmount) / open / pinned(고정 시 캔버스 폭을 줄이는 옵션 — 기본 off) / multi(2개 이상 선택 시 공통 속성만 + "3개 선택됨") / readonly(공유 페이지: 입력이 텍스트로 렌더).

```tsx
export interface InspectorProps {
  nodeId: string | null;
  onClose: () => void;
  onPatch: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
  readOnly?: boolean;
}
```

### 접근성
- **모달이 아니다** → 포커스 트랩 없음, `aria-modal` 없음. `<aside role="complementary" aria-label="단계 상세">`.
- 열릴 때 헤더 제목으로 포커스 이동(`tabIndex={-1}`), `Esc`로 닫고 **원래 노드로 포커스 복귀**.
- 노드 선택이 바뀌면 내용만 교체하고 포커스는 옮기지 않는다.

### 안티패턴
- 열릴 때 캔버스 폭을 줄여 노드를 재배치.
- 폭 가변(드래그 리사이즈). 360px 고정.
- 오버레이 딤 처리(모달이 아니다).
- 삭제 버튼을 헤더 우상단에(하단 danger 영역으로).

---

## 12. CommandPalette

> **용도** — `/` 또는 `⌘K`. **아이콘 + 한국어 라벨만.** 영문 명령어는 이 제품의 사용자를 배제한다.

### 치수
```
폭 480px, 상단에서 15vh, radius 14px, bg n-0, border 1px n-200, --shadow-float
입력      h 44px, padding 0 14px, 15px, 하단 1px n-200, 좌측 16px search 아이콘
리스트    max-h 320px, padding 6px
아이템    h 36px, padding 0 10px, radius 6px, gap 8px, icon 16px, 라벨 15/400
힌트      우측 12/500 paper-400 (예: "Enter")
그룹헤더  h 26px, 12/500 n-500, padding 0 10px
빈 상태   h 72px, 13 n-500 "찾는 게 없나요? 그냥 문장으로 적어도 됩니다"
```

### 상태
- 아이템: default / **highlighted** `bg n-100`(브랜드색 아님 — 목록에서 초록이 반복되면 소음) / disabled `text paper-400` / danger 항목은 `text danger`, hover 시 `bg #FBF1F0`.
- 팔레트: opening(`opacity 0→1`, 140ms, 스케일·오버슈트 없음) / filtering(결과 0건이어도 닫히지 않음) / composing(**조합 중 Enter는 실행이 아니라 확정** — `isComposing` 체크 필수).

```tsx
export interface Command {
  id: string;
  label: string;             // 한국어. "Add step" 금지, "단계 추가"
  keywords?: string[];       // 초성 검색용 ["ㄷㄱㅊㄱ", "단계"]
  icon: LucideIcon;
  hint?: string;
  group: "단계" | "구조" | "보기" | "문서";
  danger?: boolean;
  run: () => void;
}
export interface CommandPaletteProps {
  open: boolean; onOpenChange: (o: boolean) => void;
  commands: Command[];
  /** '/'로 열렸을 때의 앵커 블록 id */ anchorBlockId?: string;
}
```

```tsx
// ⚠️ 한글 조합 중 Enter 이중 실행 방지
onKeyDown={(e) => {
  if (e.nativeEvent.isComposing) return;
  if (e.key === "Enter") { e.preventDefault(); run(items[cursor]); }
  if (e.key === "ArrowDown") setCursor(c => Math.min(c + 1, items.length - 1));
  if (e.key === "ArrowUp") setCursor(c => Math.max(c - 1, 0));
  if (e.key === "Escape") onOpenChange(false);
}}
```

### 접근성
- `role="dialog" aria-modal="true"` + 포커스 트랩. 입력은 `role="combobox" aria-expanded aria-controls aria-activedescendant`.
- 리스트 `role="listbox"`, 아이템 `role="option" aria-selected`. 마우스 hover로 `aria-activedescendant`를 바꾸지 않는다(키보드 커서와 충돌).
- 결과 개수를 `role="status"`로 "4개 결과" 낭독(디바운스 500ms).
- 닫히면 이전 포커스(블록 캐럿) 복귀 — 캐럿 오프셋까지 복원.

### 안티패턴
- `⌘K` 아이콘만 있고 라벨이 영문(`Duplicate`, `Move to`).
- 검색어 없을 때 최근 명령 대신 전체 40개 나열.
- 조합 중 Enter로 첫 항목이 실행되는 버그(가장 흔한 한국어 팔레트 결함).
- 스케일 인 애니메이션.

---

## 13. Toast

> **용도** — 되돌릴 수 있는 사실의 통보. 축하하지 않는다.

### 치수
```
위치      하단 중앙, bottom 24px, gap 8px (스택 최대 3개)
크기      min-h 44px, max-w 420px, padding 12px 14px, radius 12px
기본      bg #1C1B19, text n-0 13/1.5/500, --shadow-float
액션      우측 ghost-on-ink: 13/600 #DDEDE5, h 28, px 8, radius 6, hover bg rgb(255 255 255/.10)
에러      bg n-0, border 1px danger, text n-900, 좌측 16px alert 아이콘 danger
등장      opacity 0→1 + translateY(6px)→0, 140ms --ease-out
```

3종:
| 종류 | 문구 | 지속 | 액션 |
|---|---|---|---|
| 저장됨 | `저장됨` | 2000ms | 없음 |
| 재배치 | `그림을 다시 정리했어요` | 6000ms | `되돌리기` |
| 에러 | `저장하지 못했어요. 잠시 뒤 다시 시도해 주세요` | 지속(수동 닫기) | `다시 시도` |

### 상태
enter / visible / hovered(**타이머 정지**) / focused(정지) / action-pending(액션 라벨을 "되돌리는 중…" 텍스트로 — 스피너 없음) / exit(`opacity` only, 140ms).

```tsx
export interface ToastSpec {
  id: string;
  tone?: "ink" | "error";
  message: string;                       // 한국어 완성 문장, 마침표 없음
  action?: { label: string; onAct: () => void };
  duration?: number | null;              // null이면 수동 닫기
}
export function useToast(): { toast: (t: Omit<ToastSpec, "id">) => string; dismiss: (id: string) => void };
```

### 접근성
- 컨테이너 `role="region" aria-label="알림"`. 일반 토스트 `role="status" aria-live="polite"`, 에러 `role="alert" aria-live="assertive"`.
- 액션이 있는 토스트는 **자동 소멸 6초 이상** + `F6`로 토스트 영역 포커스 이동 경로 제공.
- 소멸된 되돌리기는 `⌘Z`로 여전히 가능해야 한다(토스트는 편의이지 유일 경로가 아니다).

### 안티패턴
- 스피너·프로그레스 바 타이머 링.
- confetti, ✨, "완료! 🎉".
- 토스트에 "3명이 봤습니다" 류 조회 알림.
- 4개 이상 동시 스택.

---

## 14. QuestionCard

> **용도** — 온보딩·메타데이터 수집. 한 화면에 질문 1개. **"모르겠어요"가 정답과 같은 크기다.**

### 치수
```
레이아웃  전체화면, 콘텐츠 max-w 560px, 세로 38% 지점 정렬
진행      상단 2px 라인, 채움 brand-500, 320ms --ease-flow. 숫자·점 표시 없음
질문      28 / 1.32 / 700 / -0.025em  n-900
보조      15 / 1.65 / 400  n-500, margin-top 8px
입력      lg 44px, margin-top 24px
선택지    전폭 버튼 h 56px, radius 12px, 좌측 정렬 padding 0 18px, 16/600, gap 8px
          default: bg n-0 / border 1px n-200 / --edge-flat
          hover:   bg n-25 / border n-300
          selected: bg brand-50 / border brand-500 / text brand-700 + 우측 check 18px
"모르겠어요"  동일 h 56 / 동일 radius / 동일 폰트, border 1px n-200, text n-500
              ↑ ghost·작은 링크로 강등 금지
하단      [건너뛰기] ghost md 좌측, [다음] primary lg 우측, margin-top 32px
```

### 상태
idle / answered(다음 버튼 활성) / skipped / composing(Enter를 다음으로 해석하지 않음) / transition(이전 질문 `opacity 1→0` 140ms → 다음 질문 `opacity 0→1 + translateY(4px)` 200ms. **가로 슬라이드는 카드 스택에서만**).

```tsx
export interface QuestionCardProps {
  step: number; total: number;          // 진행 라인 계산용 — 화면에 숫자로 찍지 않는다
  question: string;
  help?: string;
  kind: "text" | "choice" | "chips";
  options?: { id: string; label: string }[];
  value?: string | string[];
  onChange: (v: string | string[]) => void;
  onNext: () => void;
  onSkip: () => void;                    // "모르겠어요" · [건너뛰기] 공통
  unknownLabel?: string;                 // 기본 "모르겠어요"
}
```

### 접근성
- `<section role="group" aria-labelledby="q-title">`, 질문에 `id="q-title"`.
- 진행 라인 `role="progressbar" aria-valuenow aria-valuemin aria-valuemax aria-label="진행"`.
- 선택지는 `role="radiogroup"`(단일) 또는 체크박스 그룹(복수). ↑↓ 이동, Space 선택.
- 질문 전환 시 새 질문 제목에 포커스(`tabIndex={-1}`) → 스크린리더가 자동 낭독.
- `Enter`로 다음(단, `isComposing` 체크).

### 안티패턴
- "모르겠어요"를 12px 회색 링크로 강등. 이 제품에서 모른다는 대답은 **1급 데이터**다.
- `3 / 12` 숫자 진행 표시(압박).
- 필수 표시 `*`, "이 항목은 필수입니다" 에러.
- 질문 아래 예시 이미지·일러스트.

---

## 15. ShareDialog

> **용도** — 링크 발급 · 권한 · 내보내기. 공유는 **명시적으로 이 다이얼로그를 거쳐야만** 일어난다.

### 치수
```
폭 520px, radius 14px, bg n-0, border 1px n-200, --shadow-float, padding 24px
딤       rgb(28 27 25 / .28), 140ms
헤더     제목 18/1.45/600 + 우상단 닫기 28px
섹션 간  20px + 1px n-200 구분선
링크 행  인풋 md(읽기 전용, bg n-50, 13 tabular-nums, text-ellipsis) + [복사] secondary md
권한     radio 3개, 행 h 44, 라벨 15/400 + 설명 13 n-500
내보내기 3버튼 그리드 gap 8px: PNG / PDF / 아웃라인 복사, 각 h 44 secondary + 아이콘 18px
푸터     좌측 12 n-500 "링크를 아는 사람만 볼 수 있어요", 우측 [완료] primary md
```

권한 옵션(3개, 한국어 서술형):
1. `나만 보기` — 기본값. 링크가 발급돼 있어도 이걸 고르면 즉시 비활성
2. `링크를 아는 사람만 보기`
3. `링크를 아는 사람이 댓글 달기` (P2, 비활성 + "준비 중" 캡션)

### 상태
closed / open / link-none(발급 전: 인풋 자리에 `[공유 링크 만들기]` primary md 전폭) / generating(버튼 라벨 "만드는 중…") / copied(버튼 라벨 **"복사됨"** 1600ms, 아이콘 `check`, 색 변화 없음) / revoking(danger ghost "링크 끄기" → 확인 후) / error(섹션 하단 13 danger).

```tsx
export interface ShareDialogProps {
  open: boolean; onOpenChange: (o: boolean) => void;
  docId: string;
  link?: { url: string; createdAt: string } | null;
  permission: "private" | "link-view" | "link-comment";
  onCreateLink: () => Promise<void>;
  onRevokeLink: () => Promise<void>;
  onPermissionChange: (p: ShareDialogProps["permission"]) => void;
  onExport: (fmt: "png" | "pdf" | "outline") => Promise<void>;
}
```

### 접근성
- `role="dialog" aria-modal="true" aria-labelledby`. **포커스 트랩 필수**, `Esc` 닫기, 딤 클릭 닫기.
- 초기 포커스: 링크가 있으면 `[복사]`, 없으면 `[공유 링크 만들기]`.
- 복사 성공은 `role="status"`로 "링크를 복사했어요" 낭독(시각 라벨 변화만으로 부족).
- 닫히면 `[공유]` 버튼으로 포커스 복귀.
- 권한 radio는 `<fieldset>` + `<legend class="sr-only">누가 볼 수 있나요</legend>`.

### 안티패턴
- 다이얼로그를 열자마자 링크 자동 발급. **발급은 사용자의 명시적 행위여야 한다.**
- "전체 공개" 옵션.
- 내보내기 형식을 6개 이상 나열.
- 조회 통계("12명이 열람") 표시.

---

## 16. PrivacyBadge

> **용도** — 상단바 좌측 **상시** 노출. "이건 아직 나만 본다"는 시각적 보증.

### 치수
```
h 24px, radius full, padding 0 10px 0 8px, gap 4px
아이콘 12px lock, strokeWidth 2 (12px에서 1.75는 사라진다)
라벨 13 / 1.5 / 500 / 0em
private: bg n-100 / border 1px n-200 / text n-700   라벨 "나만 보기"
shared : bg brand-50 / border 1px brand-100 / text brand-700 / 아이콘 link  라벨 "링크 공유 중"
```

### 상태
- `private`(기본) / `shared` / hover(클릭 가능일 때 `bg n-200` 또는 `brand-100`) / focus-visible 소프트 링 / **전 브레이크포인트에서 절대 숨기지 않는다** — `<768px`에서는 라벨만 숨기고 아이콘은 남긴다(`aria-label`은 유지).

```tsx
export interface PrivacyBadgeProps {
  state: "private" | "shared";
  /** 누르면 ShareDialog. 없으면 순수 상태 표시 */
  onOpenShare?: () => void;
}
```

```tsx
const Cmp = onOpenShare ? "button" : "span";
<Cmp
  {...(onOpenShare && { type: "button", onClick: onOpenShare, "aria-haspopup": "dialog" })}
  aria-label={state === "private" ? "이 문서는 나만 볼 수 있습니다. 공유 설정 열기" : "링크로 공유 중입니다. 공유 설정 열기"}
  className={cn(
    "inline-flex h-6 items-center gap-1 rounded-full border pl-2 pr-2.5 text-label font-medium outline-none",
    "transition-colors duration-fast ease-out focus-visible:shadow-focus",
    state === "private"
      ? "border-paper-200 bg-paper-100 text-paper-700 hover:bg-paper-200"
      : "border-brand-100 bg-brand-50 text-brand-700 hover:bg-brand-100"
  )}
>
  {state === "private" ? <Lock size={12} strokeWidth={2} aria-hidden /> : <Link size={12} strokeWidth={2} aria-hidden />}
  <span className="max-md:sr-only">{state === "private" ? "나만 보기" : "링크 공유 중"}</span>
</Cmp>
```

### 접근성
- 상태 변경 시 `role="status"`로 "이제 링크로 공유 중입니다" 낭독.
- 색 의존 금지 → 아이콘(`lock`↔`link`)과 라벨이 함께 바뀐다.

### 안티패턴
- 스크롤 시 숨김, 모바일에서 제거, `•••` 안으로 이동.
- 자물쇠를 초록 체크로 바꿔 "안전 인증" 뉘앙스 주기.
- 배지 옆에 조회자 아바타 스택(DESIGN §2 절대 금지).

---

## 17. `tailwind.config.ts`

값을 CSS 변수 참조가 아니라 **리터럴 hex로 박는다.** Tailwind의 `/opacity` 문법(`bg-brand-500/12`)이 변수로는 안 되고, 다크모드는 P2에 `data-theme` 셀렉터로 별도 매핑할 계획이기 때문이다(DESIGN §4).

```ts
// tailwind.config.ts
import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink:      { DEFAULT: "#1C1B19", 600: "#302E2A", 900: "#111110" },
        brand:    { 50: "#EEF6F1", 100: "#DDEDE5", 500: "#2A7358", 600: "#1F5C46", 700: "#16452F" },
        // ★ 대비 감사(DESIGN §4) 반영본. 아래 주석의 등급을 지우지 말 것 —
        //   린트 규칙(§2)이 이 표를 근거로 삼는다.
        paper:    { 0: "#FFFFFF", 25: "#FCFBF9", 50: "#F7F6F3", 100: "#F0EEEA",
                    200: "#E4E1DB",   // 1.26:1 — 면 구분 전용. border-*에 쓰지 말 것
                    300: "#D2CEC6",   // 1.53:1 — 장식 보더(고스트 노드)만
                    400: "#A8A39A",   // 2.43:1 — ✗ 텍스트 금지. 도트 그리드 등 순수 장식만
                    450: "#948F87",   // 3.11:1 — ✓ 인풋·버튼·컨트롤 경계선 전용
                    500: "#7C7770",   // 4.29:1 on paper-25 — 흰 배경(paper-0) 위에서만
                    550: "#6F6A62",   // 5.19:1 — ✓ 보조 텍스트·캡션·placeholder
                    700: "#45423D", 900: "#1C1B19" },  // 17.21:1
        danger:   { DEFAULT: "#B4342B", 600: "#9E2C24", 700: "#8A2620", tint: "#FBF1F0" },
        branch:   { DEFAULT: "#9E6511", tint: "#FCF8F1" },  // 4.86:1 (구 #9E6511는 4.50:1로 임계 탈락)
        hold:     { DEFAULT: "#6E4666", tint: "#FBF7F9" },  // 7.69:1
      },
      borderRadius: { xs: "4px", sm: "6px", md: "12px", lg: "14px", full: "999px" },
      height:    { "ctl-sm": "32px", "ctl-md": "36px", "ctl-lg": "44px" },
      minHeight: { "ctl-sm": "32px", "ctl-md": "36px", "ctl-lg": "44px" },
      spacing: {
        // base 4px — 8px 그리드 아님
        px: "1px", 0.5: "2px", 1: "4px", 1.5: "6px", 2: "8px", 2.5: "10px",
        3: "12px", 3.5: "14px", 4: "16px", 5: "20px", 6: "24px", 8: "32px", 10: "40px", 12: "48px",
        node: "260px", inspector: "360px", topbar: "52px",
      },
      fontFamily: { sans: ["var(--font-pretendard)", "-apple-system", "Apple SD Gothic Neo", "Malgun Gothic", "sans-serif"] },
      fontSize: {
        onboarding: ["28px", { lineHeight: "1.32", letterSpacing: "-0.025em", fontWeight: "700" }],
        title:      ["22px", { lineHeight: "1.36", letterSpacing: "-0.020em", fontWeight: "600" }],
        section:    ["18px", { lineHeight: "1.45", letterSpacing: "-0.015em", fontWeight: "600" }],
        body:       ["15px", { lineHeight: "1.65", letterSpacing: "-0.005em" }],
        node:       ["15px", { lineHeight: "1.45", letterSpacing: "-0.010em", fontWeight: "600" }],
        label:      ["13px", { lineHeight: "1.50", letterSpacing: "0em",      fontWeight: "500" }],
        caption:    ["12px", { lineHeight: "1.50", letterSpacing: "+0.005em", fontWeight: "500" }],
        micro:      ["11px", { lineHeight: "1.20", letterSpacing: "0em",      fontWeight: "500" }],
      },
      letterSpacing: { btn: "-0.01em", "label-tight": "-0.005em" },
      boxShadow: {
        "edge-flat":      "inset 0 1px 0 rgb(255 255 255 / .55)",
        "edge-raise":     "0 1px 0 rgb(28 27 25 / .04), inset 0 1px 0 rgb(255 255 255 / .7)",
        "edge-raise-ink": "0 1px 0 rgb(28 27 25 / .10), inset 0 1px 0 rgb(255 255 255 / .12)",
        float:            "0 1px 2px rgb(28 27 25/.06), 0 8px 24px -8px rgb(28 27 25/.16)",
        drag:             "0 2px 4px rgb(28 27 25/.08), 0 16px 32px -12px rgb(28 27 25/.22)",
        node:             "0 1px 2px rgb(28 27 25/.06)",
        "node-selected":  "inset 0 0 0 2px #2A7358, 0 0 0 4px rgb(42 115 88 / .12)",
        focus:            "0 0 0 3px rgb(42 115 88 / .14)",
        "focus-ink":      "0 0 0 3px rgb(42 115 88 / .28)",
        "focus-danger":   "0 0 0 3px rgb(180 52 43 / .16)",
        "ring-select":    "0 0 0 3px rgb(42 115 88 / .12)",
        none: "none",
      },
      transitionDuration: { instant: "80ms", fast: "140ms", base: "200ms", slow: "320ms" },
      transitionTimingFunction: {
        out:      "cubic-bezier(.16, 1, .3, 1)",
        standard: "cubic-bezier(.2, 0, 0, 1)",
        flow:     "cubic-bezier(.2, .8, .2, 1)",
      },
    },
  },
  plugins: [require("@tailwindcss/container-queries")],
} satisfies Config;
```

**의도적으로 제외한 것**: `colors.blue|indigo|violet` 등 기본 팔레트 전체(`theme.extend`가 아니라 `theme.colors`를 덮어써 파랑을 아예 컴파일 불가로 만드는 옵션도 검토 — P1에서 `eslint` 규칙으로 대체), `boxShadow.sm|DEFAULT|lg`, `borderRadius.DEFAULT`, `animate-*` 기본 키프레임.

### ⚠️ 린트 규칙이 공허해지지 않게 하는 법

초안의 게이트는 **`n-400`을 찾도록** 적혀 있었다. 그런데 실제 클래스는 `paper-400`으로 컴파일된다 —
**규칙이 0건을 찾고 항상 초록이 된다.** 방어하는 척하면서 아무것도 안 막는, 가장 위험한 실패 유형이다.

> 게이트는 **소스에 실제로 존재하는 문자열**을 대상으로 해야 한다. 문서의 개념 이름이 아니라.

```js
// eslint.config.js — Tailwind 클래스 문자열을 AST 레벨에서 검사
const FORBIDDEN = [
  // [패턴, 사유]
  [/\btext-paper-(200|300|400)\b/,     'paper-200/300/400은 텍스트 대비 미달. text는 paper-550 이상'],
  [/\bplaceholder:text-paper-(400)\b/, 'placeholder는 주 안내문이다. paper-550 사용'],
  [/\bborder-paper-(200|300)\b(?!.*decorative)/, '인터랙티브 경계선은 3:1 필요. paper-450 사용'],
  [/\b(bg|text|border)-(blue|indigo|violet|sky|cyan)-/, '파랑은 팔레트에 없다 (D-020)'],
  [/\banimate-(spin|pulse|bounce)\b/, '스피너·shimmer 금지 (STATES §8)'],
  [/\bshadow-(sm|md|lg|xl)\b/,        '기본 그림자 금지. --edge-* 또는 --shadow-float'],
  [/\brounded(-|$)(?!xs|sm|md|lg|full)/, 'radius는 5단계만 (xs/sm/md/lg/full)'],
  [/\bring-offset-/,                   'ring-offset 이중 링 폐기. 이중 링은 box-shadow로'],
];
```

**검증 테스트를 함께 넣는다** — 규칙이 실제로 뭔가를 잡는지 확인하는 테스트가 없으면 같은 사고가 반복된다.

```ts
// eslint.rules.test.ts
it('금지 패턴이 실제 소스에서 최소 1건은 잡혀야 한다 (게이트 생존 확인)', () => {
  // 의도적 위반 픽스처를 두고, 규칙이 그걸 잡는지 검증한다.
  // 픽스처에서 0건이 나오면 규칙이 죽은 것이다.
  expect(lintFixture('text-paper-400')).toHaveLength(1)
  expect(lintFixture('bg-blue-500')).toHaveLength(1)
  expect(lintFixture('animate-spin')).toHaveLength(1)
})
```

---

## 18. `app/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* radius */
    --radius-xs: 4px; --radius-sm: 6px; --radius-md: 12px; --radius-lg: 14px; --radius-full: 999px;
    /* edge & shadow */
    --edge-flat:  inset 0 1px 0 rgb(255 255 255 / .55);
    --edge-raise: 0 1px 0 rgb(28 27 25 / .04), inset 0 1px 0 rgb(255 255 255 / .7);
    --shadow-float: 0 1px 2px rgb(28 27 25/.06), 0 8px 24px -8px rgb(28 27 25/.16);
    --shadow-drag:  0 2px 4px rgb(28 27 25/.08), 0 16px 32px -12px rgb(28 27 25/.22);
    --ring-focus:        0 0 0 3px rgb(42 115 88 / .14);
    --ring-focus-strong: 0 0 0 3px rgb(42 115 88 / .28);
    /* control & space */
    --control-h-sm: 32px; --control-h-md: 36px; --control-h-lg: 44px; --space-base: 4px;
    /* brand */
    --brand-700:#16452F; --brand-600:#1F5C46; --brand-500:#2A7358; --brand-100:#DDEDE5; --brand-50:#EEF6F1;
    /* neutral */
    --n-0:#FFFFFF; --n-25:#FCFBF9; --n-50:#F7F6F3; --n-100:#F0EEEA; --n-200:#E4E1DB;
    --n-300:#D2CEC6; --paper-400:#A8A39A; --n-500:#7C7770; --n-700:#45423D; --n-900:#1C1B19;
    /* semantic */
    --danger:#B4342B; --branch:#9E6511; --hold:#6E4666;
    /* 시맨틱 별칭 — 컴포넌트는 가능하면 이 이름을 쓴다(다크모드는 여기만 교체) */
    --surface-app:    var(--n-25);
    --surface-canvas: var(--n-50);
    --surface-card:   var(--n-0);
    --border-subtle:  var(--n-200);
    --border-strong:  var(--n-300);
    --text-primary:   var(--n-900);
    --text-secondary: var(--n-500);
    --text-placeholder: var(--paper-400);
    /* motion */
    --dur-instant: 80ms; --dur-fast: 140ms; --dur-base: 200ms; --dur-slow: 320ms; --dur-stagger: 40ms;
    --ease-out: cubic-bezier(.16, 1, .3, 1);
    --ease-standard: cubic-bezier(.2, 0, 0, 1);
    --ease-flow: cubic-bezier(.2, .8, .2, 1);
  }

  html { -webkit-text-size-adjust: 100%; }

  body {
    background: var(--surface-app);
    color: var(--text-primary);
    font-family: var(--font-pretendard), -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
    font-size: 15px; line-height: 1.65; letter-spacing: -0.005em; font-weight: 400;
    /* 한글 어절 단위 줄바꿈 — 전역 */
    word-break: keep-all;
    overflow-wrap: anywhere;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    font-feature-settings: "ss01", "case";
  }

  /* 숫자·시간은 폭이 고정돼야 재배치가 안 생긴다 */
  time, [data-numeric], .tabular { font-variant-numeric: tabular-nums; }

  /* Pretendard 500은 한글에서 400과 구분되지 않는다 → 강조는 600 */
  strong, b { font-weight: 600; }

  /* 포커스: 오프셋 링 폐기, 단일 소프트 링 */
  :where(button, a, input, textarea, select, [tabindex]):focus { outline: none; }
  :where(button, a, input, textarea, select, [tabindex]):focus-visible {
    outline: none;
    box-shadow: var(--ring-focus);
    border-color: var(--brand-500);
  }
  /* 커스텀 링을 직접 그리는 컴포넌트는 이 훅으로 기본값을 끈다 */
  [data-custom-focus]:focus-visible { box-shadow: revert-layer; }

  ::selection { background: var(--brand-100); color: var(--brand-700); }
  ::placeholder { color: var(--text-placeholder); }

  /* 캔버스 도트 그리드 */
  .canvas-grid {
    background-color: var(--surface-canvas);
    background-image: radial-gradient(circle, var(--n-200) 1px, transparent 1px);
    background-size: 24px 24px;
    opacity: 1;
  }

  /* 스킵 링크 */
  .skip-link {
    position: fixed; top: 8px; left: 8px; z-index: 100;
    transform: translateY(-200%);
    height: var(--control-h-md); display: inline-flex; align-items: center;
    padding: 0 14px; border-radius: var(--radius-sm);
    background: var(--n-900); color: var(--n-0); font-size: 13px; font-weight: 600;
  }
  .skip-link:focus-visible { transform: translateY(0); box-shadow: var(--ring-focus-strong); }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important; scroll-behavior: auto !important;
    }
  }

  /* 내보내기 렌더 컨텍스트: 그림자 제거, 보더 유지 */
  [data-export="true"] { --shadow-float: none; --shadow-drag: none; }
  [data-export="true"] * { box-shadow: none !important; }
  [data-export="true"] .canvas-grid { background-image: none; background-color: #FFFFFF; }
}

@layer components {
  .sr-only-list { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
}
```

---

## 19. 아이콘 시스템

**Lucide React.** 트리셰이킹되고, 라인 굵기가 균일하며, 한 세트로 25개를 다 덮는다. 자체 제작은 도구 칩용 12px 아이콘(Slack·Notion 등, 브랜드 로고 대체) 뿐이다.

### 규격

| 사용 크기 | strokeWidth | 사용처 |
|---|---|---|
| 12px | **2** | 도구 칩, PrivacyBadge, 자동화 스파클 |
| 14px | 1.75 | LensSwitcher, sm 버튼 |
| 16px | 1.75 | 기본값 — 노드 타입, 아웃라인 컨트롤, md 버튼, 팔레트 |
| 18px | 1.5 | lg 버튼, QuestionCard 선택지 |
| 24px | 1.5 | 빈 상태 일러스트 대체 |

12px에서 1.75는 안티에일리어싱에 먹혀 사라진다 → **12px만 2**. `absoluteStrokeWidth`는 쓰지 않는다(크기별로 명시 지정이 더 예측 가능하다).
색은 기본 `paper-500`, 텍스트와 나란히 놓이면 `currentColor`, 타입 액센트만 해당 hue.

### 25개와 매핑

| # | Lucide | 사용처 |
|---|---|---|
| 1 | `lock` | PrivacyBadge(private) |
| 2 | `link` | PrivacyBadge(shared), ShareDialog 링크 복사 |
| 3 | `share-2` | 상단바 [공유] |
| 4 | `more-horizontal` | 상단바 `•••`, OutlineBlock `⋯` |
| 5 | `plus` | OutlineBlock [+], BranchContainer [+경우 추가] |
| 6 | `grip-vertical` | OutlineBlock 드래그 핸들 |
| 7 | `square-check` | task 노드, 팔레트 "단계 추가" |
| 8 | `git-branch` | branch 노드, BranchContainer, 팔레트 "갈래 만들기" |
| 9 | `clock` | hold 노드, 시간 렌즈, 소요시간 행 |
| 10 | `play` | 시작 pill |
| 11 | `flag` | 종료 pill |
| 12 | `route` | 흐름 렌즈 |
| 13 | `users` | 사람 렌즈, 담당자 섹션 |
| 14 | `wrench` | 도구 렌즈, 도구 섹션 |
| 15 | `frown` | 짜증 렌즈, 인스펙터 감정 칩 |
| 16 | `sparkles` | 자동화 가능 마커(12px `brand-500`) |
| 17 | `search` | CommandPalette 입력 |
| 18 | `corner-down-left` | 팔레트 Enter 힌트, 아웃라인 단축키 안내 |
| 19 | `x` | 칩 제거, 다이얼로그·인스펙터 닫기, 토스트 닫기 |
| 20 | `check` | 선택 칩, 권한 라디오, "복사됨" |
| 21 | `undo-2` | 토스트 [되돌리기], 팔레트 "되돌리기" |
| 22 | `download` | 내보내기 진입 |
| 23 | `image` | PNG 내보내기 |
| 24 | `file-text` | PDF 내보내기, 공유 페이지 아웃라인 전문 |
| 25 | `chevron-right` | 그룹 접기/펼치기, 인스펙터 섹션, 팬아웃 |

P2 대기: `alert-triangle`(에러 토스트 — P1은 텍스트만), `pin`(배치 고정), `arrow-right-left`(인계 마커 — P1은 SVG 직접 그림), `zoom-in`/`zoom-out`(캔버스 컨트롤은 `+`/`−` 텍스트로 충분).

```tsx
// components/ui/icon.tsx — 크기와 굵기를 짝지어 강제한다
const STROKE = { 12: 2, 14: 1.75, 16: 1.75, 18: 1.5, 24: 1.5 } as const;
export function Icon({ as: C, size = 16, className }: {
  as: LucideIcon; size?: keyof typeof STROKE; className?: string;
}) {
  return <C size={size} strokeWidth={STROKE[size]} aria-hidden className={cn("shrink-0", className)} />;
}
```

### 금지
- 이모지 아이콘(😤, ✨, 🎉). 짜증 렌즈조차 `frown` 라인 아이콘을 쓴다.
- 채워진(filled) 아이콘 세트 혼용.
- 도구 브랜드 로고.
- 아이콘만으로 의미 전달(라벨 또는 `aria-label` 필수).
- 아이콘 툴바 20개(DESIGN §2).

---

## 20. 포커스 관리 규칙

### 전역 링
```
box-shadow: 0 0 0 3px rgb(42 115 88 / .14)   +   border-color: var(--brand-500)
잉크·danger 서피스 위: alpha .28 / danger .16
offset: 0 (항상)      outline: none + 반드시 대체 링
```
`:focus-visible`만 그린다. 마우스 클릭에 링이 생기면 사용자가 "뭔가 잘못 눌렀나" 느낀다.
`box-shadow` 기반이므로 **레이아웃에 영향이 없다** — 이게 `ring-offset`을 버린 실질 이유다(오프셋 링은 부모 `overflow: hidden`에 잘리고, 인접 요소와 겹친다).

### 포커스 트랩 — 대상과 비대상

| 트랩함(모달) | 트랩 안 함 |
|---|---|
| ShareDialog, CommandPalette, 삭제 확인 다이얼로그, `<768px` 바텀시트 | Inspector, hover 팝오버, Toast, LensSwitcher, ⋯ 메뉴 |

트랩 구현 규칙:
1. 열기 전 `document.activeElement`를 저장 → 닫을 때 복귀(요소가 사라졌으면 논리적 부모로).
2. 열 때 초기 포커스는 **가장 안전한 요소**(취소·복사·입력). danger 버튼은 절대 초기 포커스를 받지 않는다.
3. `Tab` 순환은 컨테이너 내부로 한정, `Escape`는 항상 닫는다.
4. 배경에 `inert` 속성 부여(`aria-hidden` 대신 — 포커스까지 막는다).
5. 스크롤 락은 `overflow: hidden` + `padding-right: scrollbar-width`(레이아웃 시프트 방지).

```tsx
// hooks/use-focus-trap.ts (요약)
export function useFocusTrap(ref: React.RefObject<HTMLElement>, active: boolean) {
  React.useEffect(() => {
    if (!active || !ref.current) return;
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const f = Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(el => el.offsetParent !== null);
      if (!f.length) return;
      const [first, last] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    root.addEventListener("keydown", onKey);
    return () => { root.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [active, ref]);
}
```

### 스킵 링크
`<body>` 첫 자식으로 3개, `Tab` 한 번에 순서대로 노출:
```html
<a class="skip-link" href="#outline">아웃라인으로 건너뛰기</a>
<a class="skip-link" href="#canvas">다이어그램으로 건너뛰기</a>
<a class="skip-link" href="#topbar-actions">문서 메뉴로 건너뛰기</a>
```
대상 요소는 `tabIndex={-1}`을 갖는다(그래야 포커스가 실제로 이동한다).

### Roving tabindex 적용 대상
아웃라인 블록 리스트 · 캔버스 노드 · LensSwitcher · 선택 칩 그룹 · CommandPalette 옵션.
각 그룹은 **탭 스톱 1개**를 갖고 내부는 방향키로 이동한다. 50개 노드가 전부 탭 스톱이면 키보드 사용자가 상단바에 도달하는 데 50번을 누른다.

### 탭 순서(문서 화면)
`스킵 링크 → PrivacyBadge → 문서 제목 → 상단바 액션 → LensSwitcher → 아웃라인(1 스톱) → 캔버스(1 스톱) → Inspector(열려 있을 때)`

### 안티패턴
- `ring-2 ring-offset-2 ring-offset-background`.
- `outline: none`만 쓰고 대체 링 없음.
- 자동 포커스를 페이지 로드 시 입력에(스크린리더 사용자가 문맥을 잃는다).
- 모달 닫은 뒤 `document.body`에 포커스 남김.
- 포커스 링에 트랜지션(`box-shadow` 전환 140ms는 허용하되 `transform`은 금지).

---

## 부록 — 구현 순서

| 주 | 항목 |
|---|---|
| 1 | §17 config · §18 globals.css · §20 포커스 규칙 · §19 Icon 래퍼 |
| 2 | Button · Input/Textarea · Badge/Chip · Card (shadcn fork 4개) |
| 3 | OutlineBlock · BranchContainer · CommandPalette |
| 3 | WorkflowNode · Avatar · DurationBar (노드 규격 260×76 확정) |
| 4 | LensSwitcher · Inspector · Toast |
| 5 | QuestionCard · ShareDialog · PrivacyBadge |

§17·§18·§20은 **재논의하지 않는다**(DESIGN §11 "비싼 결정"). 나머지는 언제든 바꿔도 파급이 국소적이다.
