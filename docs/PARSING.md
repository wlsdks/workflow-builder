# 붙여넣기 파싱 알고리즘 명세

> 구현: `packages/paste-parse` · 테스트 59건 (골든 픽스처 6 + 무손실 불변식 + 속성 테스트 1,000건) · 명세와 갈린 지점은 `src/__fixtures__/golden.ts`의 `deviations`에 근거와 함께 적혀 있다
> 최종 갱신: 2026-08-17 · 상태: 초안 v0.1
> 대상 패키지: `packages/paste-parse` (React·Drizzle·DOM 무의존 순수 패키지)
> 관련 문서: [PRD §3](./PRD.md) · [STATES.md §붙여넣기](./STATES.md) · [WRITING.md §5](./WRITING.md) · [TOOLS.md](./TOOLS.md) · [MEASUREMENT.md §붙여넣기 파싱](./MEASUREMENT.md)

PRD가 세 번 반복한 **"AI 없이 줄바꿈·번호·동사 패턴 규칙만으로 80% 커버"** 의 그 규칙이 이 문서다.

---

## 0. 먼저 못 박는 것 — 성공 기준과 설계 편향

이 두 개를 합의하지 않으면 아래 알고리즘의 모든 임계값이 임의값이 된다.

### 0.1 유일한 성공 기준은 무손실이다

STATES.md가 이미 선언했다 — **"원문은 한 글자도 잃지 않는다 — 이게 유일한 성공 기준"**.
그래서 이 파서는 **문자열을 변형하지 않는다.** 전 파이프라인이 **원문 위의 구간(span) 대수**로만 동작한다.

```
원문 O (길이 N)
  ├─ items[i].sourceRange   → 단계가 된 구간
  ├─ dropped[j].range       → 단계로 만들지 않은 구간 (노이즈·문맥·인사말) — 삭제가 아니라 "보류"
  └─ unparsedTailRange      → 파싱 포기 구간

불변식:  위 세 집합은 서로 겹치지 않고, 그 사이의 빈틈은 공백 문자뿐이다.
        ⇒ 어떤 문자도 "설명되지 않은 채 사라지지" 않는다.
```

이 불변식은 주석이 아니라 **런타임 assert**다 (§10.4). 개발·운영 양쪽에서 돈다. 비용은 O(N) 한 번이다.
실패하면 파싱 결과를 통째로 버리고 "원문 1덩어리" 폴백으로 내려간다. **틀리게 나누느니 안 나눈다.**

### 0.2 과분할 vs 미분할 — **미분할 쪽으로 편향한다**

| | 사용자 복구 동작 | 실제 비용 |
|---|---|---|
| **미분할** (덜 나눔) | 커서 놓고 `Enter` | 키 1회. **텍스트가 원문 그대로라 읽고 판단하기 쉽다.** STATES.md가 이미 이 복구 경로를 사용자에게 가르치고 있다 — *"줄 끝에서 Enter를 치시면 단계가 나뉘어요"* |
| **과분할** (더 나눔) | `[위와 합치기]` 클릭 | 클릭 1회 + **문장 재작성 1회**. 한국어 절 분할은 어미를 손대야 하므로(§4.6) 되돌려 합쳐도 원문이 복원되지 않는다 |

결정적 비대칭은 여기다 — **분할은 무손실 연산이지만 병합은 손실 연산이다.**
`"메일로 요청 받아서 엑셀에 정리하고"`를 두 단계로 쪼개면 첫 단계 제목은 `"메일로 요청 받아요"`가 된다. 어미가 이미 바뀌었다. 사용자가 "아니 이건 한 단계야"라며 합치면 `"메일로 요청 받아요 엑셀에 정리해요"`라는 원문에 없던 문장이 남는다. 반대로 안 쪼갠 문장은 언제든 그대로 쪼갤 수 있다.

2차 근거:

- **다이어그램 폭발.** 항목 1개 = 그래프 노드 1개다. 5단계 업무가 20노드로 그려지면 ARCHITECTURE.md §8이 1번 리스크로 꼽은 "의도와 그림이 어긋나 신뢰가 무너지는" 바로 그 실패가 붙여넣기 직후에 발생한다.
- **텔레메트리 정합.** MEASUREMENT.md의 `paste_result_edited`는 `deleted_step_count`와 `added_step_count`를 따로 센다. 과분할은 삭제로, 미분할은 추가로 나타난다. 추가는 이 제품의 기본 동작(Enter)이고 삭제는 아니다.

**단, 편향은 "추론한 경계"에만 적용한다.**
사용자가 직접 찍은 번호·불릿·체크박스는 **저자의 명시적 의도**이므로 100% 따른다. 마커가 있는데 합치는 일은 없다.

```
정밀도 편향 구간 (추론):  절 분할 · 문장 분할 · 계층 추정 · 분기 승격   → precision 0.90 목표, recall 0.60 허용
재현율 편향 구간 (확인식): 도구·담당자·소요시간·빈도 힌트              → recall 0.85 목표, precision 0.60 허용
```

메타 힌트가 재현율 편향인 이유는 TOOLS.md §정규화 운영규칙 1이 이미 정해뒀다 — 힌트는 배지로 뜨고 **클릭 1회로 확정**한다. **입력이 아니라 확인**이므로 오탐 비용이 극히 싸다. 반대로 경계는 잘못 잡으면 문장을 다시 쓰게 만든다.

### 0.3 이 파서가 하지 않는 것

- 형태소 분석기를 붙이지 않는다 (mecab-ko/khaiii). 번들 수 MB + WASM 로딩이 "붙여넣으면 바로 된다"의 300ms 예산을 혼자 다 먹는다. §4는 **표면형 패턴 + 폐쇄 어휘 게이트**로 형태소 분석의 90%를 대체한다.
- 텍스트를 요약하거나 다시 쓰지 않는다. 제목 보정은 §4.6의 **폐쇄 변환표**만 적용하고, 표에 없으면 원문을 그대로 둔다.
- 순서를 바꾸지 않는다. 항목 순서 = 원문 등장 순서. 예외 없다.

---

## 1. 파이프라인 전체 설계

실행 순서. 각 단계는 앞 단계의 출력만 읽는다(순수 함수 9개).

```
                                    입력: string (원문 O)
  ┌──────────────────────────────────────────────────────────────────┐
  │ S0  가드            길이·라인수 검사 → 동기/워커/거부 분기          │  §10.3
  ├──────────────────────────────────────────────────────────────────┤
  │ S1  전처리          NFC·CRLF·제로폭 정규화 + 역인덱스맵 생성        │  §1.1
  │                     ★ 길이가 변하면 TextMap이 원문 좌표를 보존한다  │
  ├──────────────────────────────────────────────────────────────────┤
  │ S2  소스 유형 감지   9종 시그니처 채점 → sourceHint + traits[]      │  §2
  ├──────────────────────────────────────────────────────────────────┤
  │ S3  라인 분할        Line[] 생성 (span·indent·marker·blankBefore)   │  §3.1
  │     + 마커 시퀀스 검증 → 가짜 마커 강등                             │  §3.2
  │     + 줄바꿈 복원(wrapped join)                                    │  §3.3
  ├──────────────────────────────────────────────────────────────────┤
  │ S4  노이즈 마킹      dropped[] 후보 표시 (삭제 아님) + 과잉 제거 방어 │  §8
  │     ★ 순서 주의: 경계 판정 전에 해야 헤더가 단계로 승격되지 않는다   │
  ├──────────────────────────────────────────────────────────────────┤
  │ S5  단계 경계 판정   R1..R7 우선순위 규칙 → Segment[]               │  §3
  │       R1 마커 → R2 표행 → R3 발화 → R4 빈줄블록                    │
  │       → R5 줄 → R6 문장 → R7 절(한국어 연결어미)                    │
  ├──────────────────────────────────────────────────────────────────┤
  │ S6  타입 분류        규칙 게이트 → 점수 → task|branch|hold          │  §5
  ├──────────────────────────────────────────────────────────────────┤
  │ S7  계층 추정        들여쓰기 사다리 / 마커 클래스 / 분기 스코프      │  §6
  ├──────────────────────────────────────────────────────────────────┤
  │ S8  메타 힌트        도구·담당자·소요시간·빈도 (재현율 편향)          │  §7
  ├──────────────────────────────────────────────────────────────────┤
  │ S9  후처리           제목 정리·어미 보정·중복 병합·고아 정리          │  §1.2
  │                     · 신뢰도 산출 · assertLossless()               │  §9 §10.4
  └──────────────────────────────────────────────────────────────────┘
                                    출력: ParseResult
```

### 1.1 S1 전처리 — 좌표를 잃지 않는 정규화

정규화가 길이를 바꾸는 경우가 실제로 있다. 특히 **macOS에서 복사한 한글은 NFD(자모 분리)로 들어온다.** `"확인"`이 2자가 아니라 4~6 코드유닛이 된다. 정규화하지 않으면 모든 한글 정규식이 조용히 실패하고, 그냥 정규화하면 `sourceRange`가 원문과 어긋난다.

```ts
// packages/paste-parse/src/normalize.ts
const ZERO_WIDTH = /[​-‍⁠﻿­]/;
const JAMO = /[ᄀ-ᇿꥠ-꥿ힰ-퟿]/;
const JAMO_L = /[ᄀ-ᅟ]/, JAMO_V = /[ᅠ-ᆧ]/, JAMO_T = /[ᆨ-ᇿ]/;

export class TextMap {
  private constructor(
    readonly orig: string,
    readonly work: string,
    /** work 인덱스 → orig 인덱스. 길이 = work.length + 1 (끝 경계 포함) */
    private readonly idx: Int32Array | null,   // null = 항등 사상 (fast path)
  ) {}

  /** work 좌표 구간 → 원문 좌표 구간 */
  toOrig([s, e]: Span): Span {
    if (!this.idx) return [s, e];
    return [this.idx[s], this.idx[e]];
  }

  static of(orig: string): TextMap {
    // ── fast path: 손댈 게 없으면 배열조차 만들지 않는다 (입력의 99% 이상)
    if (!JAMO.test(orig) && !orig.includes('\r') && !ZERO_WIDTH.test(orig)) {
      return new TextMap(orig, orig, null);
    }
    const out: string[] = [];
    const idx: number[] = [];
    for (let i = 0; i < orig.length; ) {
      const c = orig[i];
      if (c === '\r') {                                   // CRLF/CR → LF
        if (orig[i + 1] === '\n') { i++; continue; }
        out.push('\n'); idx.push(i); i++; continue;
      }
      if (ZERO_WIDTH.test(c)) { i++; continue; }
      if (JAMO_L.test(c)) {                               // NFD 한글 음절 = L(+V)(+T)
        let j = i + 1;
        if (j < orig.length && JAMO_V.test(orig[j])) j++;
        if (j < orig.length && JAMO_T.test(orig[j])) j++;
        out.push(orig.slice(i, j).normalize('NFC'));      // → 1자
        idx.push(i); i = j; continue;
      }
      out.push(c); idx.push(i); i++;
    }
    idx.push(orig.length);                                // 끝 경계
    return new TextMap(orig, out.join(''), Int32Array.from(idx));
  }
}
```

**하지 않는 정규화** — 정보를 지우기 때문이다.

| | 이유 |
|---|---|
| 탭 → 공백 치환 | 탭은 엑셀 열 구분 신호다 (§2 `table`). 치환하면 열이 사라진다 |
| 연속 공백 축약 | 들여쓰기 폭이 곧 계층이다 (§6) |
| 전각 → 반각 | `①`, `．`, `　`는 한글 문서의 유효한 마커다. 마커 표에서 직접 다룬다 |
| 이모지 제거 | S4에서 **구간으로 표시**할 뿐 문자열에서 빼지 않는다 |

### 1.2 S9 후처리에서 도는 정리 규칙 (순서대로)

```
P1  제목 트리밍       마커·선행 공백·후행 구두점 제거 (sourceRange는 마커를 포함한 채 유지)
P2  어미 보정         §4.6 폐쇄표. 절 분할로 생긴 항목에만 적용
P3  빈 항목 제거      title이 공백뿐 → dropped('empty')로 강등
P4  초단문 흡수       title 길이 < 4 이고 동사 없음 → 직전 항목에 흡수(구간 합침)
P5  중복 인접 병합    정규화 후 동일한 연속 항목 → 1개로 (구간 합침)
P6  고아 자식 승격    부모가 dropped된 자식 → depth-1
P7  깊이 클램프       depth > 2 → 2 (그림이 읽히는 한계. DESIGN.md §6 semantic zoom 전제)
P8  단일 항목 검사    항목 1개 & 원문 200자↑ → confidence='low' 강제 (§10.1)
P9  신뢰도 산출       §9
P10 assertLossless    실패 시 폴백 (§10.4)
```

---

## 2. 소스 유형 자동 감지

### 2.1 단일 라벨이 아니라 (라벨 + 특성 집합)이다

메일 안에 번호 목록이 있고, 카톡 안에 불릿이 있다. 하나로 찍으면 전처리가 틀린다.
→ **`sourceHint`는 텔레메트리용 대표 라벨**(MEASUREMENT.md `paste_attempted.source_hint`)이고, **실제 전처리를 움직이는 것은 `traits`**다.

```ts
export type SourceHint =
  | 'word_sop' | 'kakao' | 'email' | 'table' | 'notion'
  | 'minutes' | 'prose' | 'ppt' | 'unknown';

export type Trait =
  | 'numbered' | 'bulleted' | 'checkbox' | 'heading'   // 구조 마커
  | 'tabbed' | 'indented' | 'wrapped'                   // 레이아웃
  | 'timestamped' | 'speakered' | 'emoticon'            // 대화
  | 'mail_headered' | 'quoted' | 'signed'               // 메일
  | 'sectioned' | 'mentioned'                           // 회의록
  | 'noun_ended' | 'short_lines';                       // PPT

export type Detection = {
  hint: SourceHint;
  certainty: number;      // 0..1 — §9 신뢰도에 들어간다
  traits: Set<Trait>;
  meta: { lineCount: number; charLen: number; modalWidth: number; tabCols: number | null };
};
```

### 2.2 판별 시그니처

전부 **줄 단위 앵커드 정규식**이다. `.*`도, 중첩 수량자도 없다(ReDoS 차단, §12).

```ts
// packages/paste-parse/src/detect/signatures.ts

// ── 카카오톡 ───────────────────────────────────────────────
export const RE_KAKAO_PC     = /^\d{4}년 \d{1,2}월 \d{1,2}일 (오전|오후) \d{1,2}:\d{2}, (.{1,30}?) : /;
export const RE_KAKAO_MOBILE = /^\[(.{1,30}?)\] \[(오전|오후) \d{1,2}:\d{2}\] /;
export const RE_KAKAO_DATE   = /^-{5,}\s*\d{4}년 \d{1,2}월 \d{1,2}일 [월화수목금토일]요일\s*-{5,}$/;
export const RE_KAKAO_CSV    = /^"?Date"?\s*,\s*"?User"?\s*,\s*"?Message"?/;
export const RE_KAKAO_SYS    = /^(.{1,30}?)님이 (들어왔습니다|나갔습니다)\.?$|^삭제된 메시지입니다\.?$|^사진 \d+장$|^(이모티콘|사진|동영상|파일: )/;
export const RE_EMOTICON     = /[ㅋㅎㅠㅜ]{2,}|[😀-🙏🚀-🛿☀-➿]/u;

// ── 메일 ──────────────────────────────────────────────────
export const RE_MAIL_HEADER  = /^(보낸사람|보낸 사람|받는사람|받는 사람|참조|숨은참조|제목|날짜|보낸날짜|첨부|From|To|Cc|Bcc|Subject|Sent|Date|Reply-To)\s*[:：]\s?/;
export const RE_MAIL_QUOTE   = /^\s*>{1,6}\s?/;
export const RE_MAIL_ORIG    = /^\s*(-{2,}\s*(Original Message|원본 메일|원본 메시지)\s*-{2,}|={5,}|_{5,})\s*$/i;
export const RE_MAIL_WROTE   = /(님이 (작성|쓰|보내)|.{1,40}\bwrote:\s*$|다음 글을 작성했습니다)/;
export const RE_MAIL_ADDR    = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
export const RE_SIGN_CLOSE   = /^\s*(감사합니다|고맙습니다|수고하세요|수고하십시오|드림|올림|배상|Best regards|Thanks|Regards)[.!,\s]*$/;
export const RE_SIGN_CONTACT = /(?:^|\s)(?:\(?0\d{1,2}\)?[-\s]?\d{3,4}[-\s]?\d{4}|010[-\s]?\d{4}[-\s]?\d{4})(?:\s|$)/;
export const RE_SIGN_TITLE   = /^\s*[가-힣]{1,6}(팀|부|실|본부|센터|그룹|파트)?\s*(사원|주임|대리|과장|차장|부장|팀장|실장|이사|상무|전무|대표|매니저|담당)\s*$/;

// ── 워드/한글 SOP ──────────────────────────────────────────
export const RE_NUM_ANY      = /^\s*(?:\(?\d{1,3}[.)]|\d{1,2}(?:[.\-]\d{1,2}){1,3}\.?|[①-⑳]|[가-하][.)]|[㉠-㉿]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ][.)]|[a-zA-Z][.)])\s+/;
export const RE_HWP_DEPTH    = /^\s*(?:[가-하][.)]|[①-⑳]|[㉠-㉿])\s+/;   // 한국 문서 특유의 2·3단
export const RE_PAGE_NUM     = /^\s*[-–—‹«\[(]?\s*(?:page\s*)?\d{1,4}\s*(?:\/\s*\d{1,4})?\s*[-–—›»\])]?\s*$/i;

// ── 표/엑셀 ────────────────────────────────────────────────
export const RE_TAB_ROW      = /\t/;
export const RE_MD_TABLE     = /^\s*\|.+\|\s*$/;

// ── 노션/구글독스 ───────────────────────────────────────────
export const RE_CHECKBOX     = /^\s*[-*+]\s*\[\s*[ xX✓]\s*\]\s+/;
export const RE_BULLET       = /^\s*[-*+•‣◦▪▫·※○●□■◇◆–—]\s+/;
export const RE_MD_HEADING   = /^\s*#{1,6}\s+\S/;
export const RE_NOTION_TOGGLE= /^\s*[▸▾▶▼]\s+/;
export const RE_CALLOUT      = /^\s*[💡⚠️📌❗✅]\s*/u;

// ── 회의록 ────────────────────────────────────────────────
export const RE_MINUTES_SEC  = /^\s*[■□▶◆●※]?\s*(액션\s?아이템|Action\s?Items?|실행\s?항목|후속\s?조치|To-?Do|할\s?일|결정\s?사항|논의\s?(내용|사항)|안건|공유\s?사항|이슈)\s*[:：]?\s*$/i;
export const RE_MINUTES_HEAD = /^\s*(일시|장소|참석(자)?|배석|불참|작성자|회의명|주관)\s*[:：]/;
export const RE_MENTION      = /@([가-힣]{2,4}|[A-Za-z][A-Za-z0-9._-]{1,20})/;

// ── PPT 도형 ───────────────────────────────────────────────
export const RE_NOUN_END     = /(?:[가-힣]{2,}(?:등록|접수|확인|발송|검토|승인|정리|입력|작성|보고|취합|마감|완료|처리|요청|전달|조회|발행|점검)|[가-힣]+(?:화|서|표|안|건))\s*$/;
```

### 2.3 채점기

각 감지기는 **독립적으로** 0..1을 반환하고, 최댓값이 임계(0.35)를 넘으면 그 라벨을 쓴다. `prose`와 `unknown`은 폴백이다.

```ts
export function detect(lines: Line[], work: string): Detection {
  const n = lines.length;
  const nonEmpty = lines.filter(l => l.text.trim().length > 0);
  const m = Math.max(1, nonEmpty.length);
  const ratio = (p: (l: Line) => boolean) => nonEmpty.filter(p).length / m;
  const head = nonEmpty.slice(0, 40);
  const traits = new Set<Trait>();

  // 대화: 타임스탬프+화자가 붙은 줄의 비율. 3줄 이상 + 40% 이상이면 확정적
  const chatR = ratio(l => RE_KAKAO_PC.test(l.text) || RE_KAKAO_MOBILE.test(l.text));
  const kakao = clamp01(chatR * 1.6)
    + (head.some(l => RE_KAKAO_DATE.test(l.text) || RE_KAKAO_CSV.test(l.text)) ? 0.3 : 0)
    + (ratio(l => RE_EMOTICON.test(l.text)) > 0.15 ? 0.1 : 0);
  if (chatR > 0.2) { traits.add('timestamped'); traits.add('speakered'); }

  // 메일: 헤더는 "앞쪽 10줄 안에 2종 이상"일 때만 인정한다. 본문 중간의 "제목:"은 헤더가 아니다
  const headerHits = new Set(
    nonEmpty.slice(0, 10).map(l => l.text.match(RE_MAIL_HEADER)?.[1]).filter(Boolean) as string[]);
  const quoteR = ratio(l => RE_MAIL_QUOTE.test(l.text));
  const email = (headerHits.size >= 2 ? 0.55 : headerHits.size === 1 ? 0.2 : 0)
    + clamp01(quoteR * 2) * 0.25
    + (nonEmpty.some(l => RE_MAIL_ORIG.test(l.text) || RE_MAIL_WROTE.test(l.text)) ? 0.25 : 0);
  if (headerHits.size >= 2) traits.add('mail_headered');
  if (quoteR > 0.05) traits.add('quoted');

  // 표: "탭이 있는 줄의 비율"이 아니라 "열 개수가 일정한가"가 핵심이다
  const tabCounts = nonEmpty.filter(l => l.text.includes('\t')).map(l => l.text.split('\t').length);
  const tabCols = modal(tabCounts);
  const tabConsistent = tabCounts.length >= 2 && tabCounts.filter(c => c === tabCols).length / tabCounts.length;
  const table = tabCounts.length / m >= 0.6 && (tabConsistent as number) >= 0.8
    ? 0.5 + 0.4 * (tabConsistent as number)
    : ratio(l => RE_MD_TABLE.test(l.text)) > 0.6 ? 0.8 : 0;
  if (table > 0.35) traits.add('tabbed');

  // 노션/독스
  const cbR = ratio(l => RE_CHECKBOX.test(l.text));
  const buR = ratio(l => RE_BULLET.test(l.text) && !RE_CHECKBOX.test(l.text));
  const hdR = ratio(l => RE_MD_HEADING.test(l.text));
  const notion = clamp01(cbR * 2) * 0.6 + clamp01(buR * 1.4) * 0.4 + (hdR > 0 ? 0.15 : 0);
  if (cbR > 0.1) traits.add('checkbox');
  if (buR > 0.15) traits.add('bulleted');
  if (hdR > 0) traits.add('heading');

  // 워드/한글 SOP: 번호 밀도 + 한국 문서 특유 2·3단 마커 + 들여쓰기
  const numR = ratio(l => RE_NUM_ANY.test(l.text));
  const indR = ratio(l => l.indentWidth > 0);
  const word = clamp01(numR * 1.5) * 0.6
    + (nonEmpty.some(l => RE_HWP_DEPTH.test(l.text)) ? 0.25 : 0)
    + clamp01(indR) * 0.15;
  if (numR > 0.2) traits.add('numbered');
  if (indR > 0.2) traits.add('indented');

  // 회의록
  const minutes = (nonEmpty.some(l => RE_MINUTES_SEC.test(l.text)) ? 0.5 : 0)
    + (head.filter(l => RE_MINUTES_HEAD.test(l.text)).length >= 2 ? 0.3 : 0)
    + (ratio(l => RE_MENTION.test(l.text)) > 0.15 ? 0.2 : 0);
  if (nonEmpty.some(l => RE_MINUTES_SEC.test(l.text))) traits.add('sectioned');
  if (ratio(l => RE_MENTION.test(l.text)) > 0.1) traits.add('mentioned');

  // PPT 도형: 짧고 · 종결부호 없고 · 명사형으로 끝나고 · 마커 없음
  const med = median(nonEmpty.map(l => l.text.trim().length));
  const ppt = (med <= 18 && m >= 3 && numR < 0.1 && buR < 0.2)
    ? 0.3 + 0.4 * ratio(l => RE_NOUN_END.test(l.text.trim())) + 0.2 * ratio(l => !/[.!?]$/.test(l.text.trim()))
    : 0;
  if (med <= 18) traits.add('short_lines');
  if (ratio(l => RE_NOUN_END.test(l.text.trim())) > 0.5) traits.add('noun_ended');

  // 프로즈: 줄이 거의 없고 글자가 많다
  const prose = (m <= 3 && work.trim().length >= 40 && numR === 0 && buR === 0) ? 0.6 : 0;

  // 워드랩: 종결 없이 끊긴 줄이 많고 줄 길이가 균일하다 → §3.3에서 되붙인다
  const modalWidth = median(nonEmpty.map(l => l.text.length));
  if (m >= 5 && ratio(l => !/[.!?…]$|[다요음함임까죠네](?:[.!?])?$/.test(l.text.trim())) > 0.5
      && stdev(nonEmpty.map(l => l.text.length)) / Math.max(1, modalWidth) < 0.15) traits.add('wrapped');

  const scored: [SourceHint, number][] = [
    ['kakao', kakao], ['email', email], ['table', table], ['notion', notion],
    ['word_sop', word], ['minutes', minutes], ['ppt', ppt], ['prose', prose],
  ];
  scored.sort((a, b) => b[1] - a[1]);
  const [hint, certainty] = scored[0][1] >= 0.35 ? scored[0] : (['unknown', 0.1] as [SourceHint, number]);
  return { hint, certainty: clamp01(certainty), traits,
           meta: { lineCount: n, charLen: work.length, modalWidth, tabCols: table > 0.35 ? tabCols : null } };
}
```

### 2.4 유형별로 달라지는 전처리

**라벨이 아니라 trait가 스위치를 누른다.** 그래서 "번호 목록이 들어있는 메일"이 정상 동작한다.

| trait | S4 노이즈 | S5 경계 | S6 타입 | S7 계층 | 비고 |
|---|---|---|---|---|---|
| `mail_headered` | 상단 헤더 블록 통째로 `drop` (첫 공백줄까지) | — | — | — | 헤더 블록 = 파일 선두에서 `RE_MAIL_HEADER` 연속 구간 |
| `quoted` | `>` 인용 블록 `drop`. **단 인용만 남으면 인용을 본문으로 승격** | — | — | — | 회신에 본문 없이 인용만 있는 케이스 방어 |
| `signed` | 하단 서명 블록 `drop` (§8.3 꼬리 탐색) | — | — | — | |
| `timestamped` | 타임스탬프+화자 프리픽스만 `drop`, **발화 본문은 절대 건드리지 않는다** | R3 발화 단위 → 같은 화자 연속 발화 병합 | 화자 전환 = 담당자 신호 | 들여쓰기 없음 → §6.3 분기 스코프 복원 | |
| `emoticon` | `ㅋㅋ`·이모지 **단독 줄**만 `drop` | — | — | — | 문장 중간 이모지는 제목 트리밍(P1)에서만 정리 |
| `tabbed` | 헤더 행(첫 행이 열 제목) `drop` | R2 행=단계, 열 매핑(§3.5) | 열 이름이 있으면 그걸로 | 첫 열이 번호면 계층 | |
| `numbered`/`bulleted`/`checkbox` | — | **R1 최우선. 절 분할 임계 +0.10 상향**(저자가 이미 나눴으므로 더 안 나눈다) | 체크박스는 무조건 `task` 기본 | 마커 클래스 사다리(§6.2) | |
| `indented` | — | — | — | 들여쓰기 사다리(§6.1) | |
| `wrapped` | — | **R5 전에 줄 재결합**(§3.3) | — | — | hwp/PDF 복사 |
| `sectioned` | `액션아이템` 계열 섹션 **밖**은 `drop('context_section')` | 섹션 헤더 자체 `drop` | — | — | §8.5 |
| `mentioned` | `@이름 :` 프리픽스 `drop` | — | — | 담당자 전환은 계층 신호가 **아니다** | |
| `noun_ended`+`short_lines` | — | R5만 사용, **R6·R7 비활성**(쪼갤 문장 자체가 없다) | 명사형은 `task` 기본 | 평면 | PPT |
| (`prose`) | — | R6 → R7 **주 경로**. 이 경우에만 절 분할이 1급 규칙 | — | 분기 스코프만 | |

---

## 3. 단계 경계 판정 규칙

### 3.1 Line 모델

```ts
export type Line = {
  i: number;
  span: Span;            // work 좌표, 개행 제외
  text: string;
  indentWidth: number;   // 탭=4열로 확장한 시각적 열 수
  rawIndent: string;
  marker: Marker | null;
  blankBefore: number;   // 직전 연속 빈 줄 수
};

export type Marker = {
  cls: MarkerClass; raw: string; value: number | null; consumed: number; // 프리픽스 길이
};
export type MarkerClass =
  | 'checkbox' | 'heading' | 'decimalMulti' | 'decimalDot' | 'decimalParen' | 'decimalWrap'
  | 'circledNum' | 'hangulOrder' | 'circledHangul' | 'roman' | 'alpha' | 'bullet' | 'arrow' | 'step';
```

```ts
export const MARKERS: readonly { cls: MarkerClass; re: RegExp; val?: (m: RegExpExecArray) => number }[] = [
  { cls: 'checkbox',     re: /^[-*+]\s*\[\s*([ xX✓])\s*\]\s+/ },
  { cls: 'heading',      re: /^(#{1,6})\s+/,                 val: m => m[1].length },
  { cls: 'step',         re: /^(?:STEP|Step|step|단계)\s*(\d{1,2})\s*[.):]?\s+/, val: m => +m[1] },
  { cls: 'decimalMulti', re: /^(\d{1,2}(?:[.\-]\d{1,2}){1,3})\.?\s+/,
                         val: m => +m[1].split(/[.\-]/).pop()! },
  { cls: 'decimalWrap',  re: /^\((\d{1,3})\)\s+/,            val: m => +m[1] },
  { cls: 'decimalParen', re: /^(\d{1,3})\)\s+/,              val: m => +m[1] },
  { cls: 'decimalDot',   re: /^(\d{1,3})\.\s+/,              val: m => +m[1] },
  { cls: 'circledNum',   re: /^([①-⑳])\s*/,        val: m => m[1].charCodeAt(0) - 0x245f },
  { cls: 'circledHangul',re: /^([㉠-㉾])\s*/,        val: m => m[1].charCodeAt(0) - 0x325f },
  { cls: 'hangulOrder',  re: /^([가-하])[.)]\s+/,            val: m => HANGUL_ORDER.indexOf(m[1]) + 1 },
  { cls: 'roman',        re: /^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]|(?:X{0,1}(?:IX|IV|V?I{0,3})))[.)]\s+/, val: m => romanValue(m[1]) },
  { cls: 'alpha',        re: /^([a-zA-Z])[.)]\s+/,           val: m => m[1].toLowerCase().charCodeAt(0) - 96 },
  { cls: 'bullet',       re: /^([-*+•‣◦▪▫·※○●□■◇◆–—])\s+/ },
  { cls: 'arrow',        re: /^([→⇒▶》])\s*/ },
];
export const HANGUL_ORDER = '가나다라마바사아자차카타파하';
```

**순서가 곧 우선순위다.** `decimalMulti`가 `decimalDot`보다 먼저여야 `1.2.3`이 `1.`로 잘리지 않는다.

### 3.2 마커 시퀀스 검증 — 가짜 마커를 죽이는 규칙

`^([가-하])[.)]\s+` 는 `"다. 확인 후 넘긴다"` 같은 평범한 문장을 마커로 오인할 수 있다. 숫자 마커도 `"3. 5억 이상은…"`에서 오작동한다.

**해법: 마커는 개별 줄이 아니라 "수열"로 검증한다.**

```ts
/** 문서 전체에서 각 마커 클래스가 실제 수열을 이루는지 확인하고, 아니면 강등한다 */
export function validateMarkerRuns(lines: Line[]): void {
  const byClass = new Map<MarkerClass, Line[]>();
  for (const l of lines) if (l.marker?.value != null) push(byClass, l.marker.cls, l);

  for (const [cls, ls] of byClass) {
    if (ls.length === 1) {
      // 단발 마커는 문맥으로만 인정: 같은 들여쓰기의 다른 마커 이웃이 있어야 한다
      if (cls === 'hangulOrder' || cls === 'alpha') demote(ls);
      continue;
    }
    let ok = 0;
    for (let k = 1; k < ls.length; k++) {
      const p = ls[k - 1].marker!.value!, c = ls[k].marker!.value!;
      if (c === p + 1) ok++;                                    // 정상 증가
      else if (c === 1 && ls[k].indentWidth !== ls[k - 1].indentWidth) ok++; // 하위 목록 재시작
      else if (c === p) ok += 0.5;                              // 워드 자동번호 붕괴 흔적
    }
    if (ok / (ls.length - 1) < 0.6) demote(ls);                 // ★ 수열이 아니면 마커가 아니다
  }
}
```

이 한 함수가 오탐의 대부분을 잡는다. `"3. 5억 이상은"` 앞에 `2.`가 없으면 마커로 인정되지 않는다.
`bullet`·`checkbox`·`arrow`는 값이 없으므로 검증 대상이 아니다(수열 개념이 없다).

### 3.3 줄바꿈 복원 (wrapped join) — R5 이전에 돈다

hwp·PDF·일부 메일 클라이언트에서 복사하면 문단 중간에 개행이 들어온다. 이걸 안 되돌리면 **줄마다 단계가 생겨 최악의 과분할**이 난다.

```ts
const RE_CONT_TAIL = /(?:[,·、]|(?:[가-힣](?:고|서|며|면서|면|다가|는데|지만|여|어|아))|[을를이가은는와과의에도만로])$/;
const RE_TERMINAL  = /(?:[.!?…]|[다요음함임까죠네])\s*$/;

export function rejoinWrapped(lines: Line[], d: Detection): Line[] {
  if (!d.traits.has('wrapped')) return lines;
  const out: Line[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    const joinable = prev
      && l.marker == null && prev.marker?.cls !== 'heading'
      && l.blankBefore === 0
      && !RE_TERMINAL.test(prev.text)
      && Math.abs(l.indentWidth - prev.indentWidth) <= 1
      && (RE_CONT_TAIL.test(prev.text.trim()) || prev.text.length >= d.meta.modalWidth * 0.9);
    if (joinable) { out[out.length - 1] = mergeLine(prev, l); continue; }  // span은 [prev.start, l.end]
    out.push(l);
  }
  return out;
}
```

`mergeLine`은 **구간을 잇기만 한다.** 두 줄 사이 개행 문자는 병합된 구간 안에 그대로 들어 있다 → 무손실.

### 3.4 경계 규칙 R1..R7 (우선순위 내림차순)

한 줄(또는 발화)은 **가장 높은 순위의 규칙 하나로만** 나뉜다. 상위 규칙이 적중하면 하위 규칙은 그 단위 안에서만 다시 시도된다.

| # | 규칙 | 조건 | 신뢰 | 편향 |
|---|---|---|---|---|
| **R1** | **명시 마커** | `marker != null` && 시퀀스 검증 통과 | 0.99 | 무조건 따름. 병합 없음 |
| **R2** | **표 행** | `trait.tabbed` && 열 수 == modal | 0.95 | 행 1개 = 단계 1개 |
| **R3** | **대화 발화** | `trait.timestamped` | 0.85 | 같은 화자 + 60초 이내 연속 발화는 **1블록으로 병합**한 뒤 R6/R7 재적용 |
| **R4** | **빈 줄 블록** | `blankBefore >= 2` | 0.80 | 블록 경계는 확정. 블록 내부는 R5 |
| **R5** | **줄** | `blankBefore <= 1` && 길이 ≥ 4 | 0.70 | wrapped join 이후의 줄만 |
| **R6** | **문장** | 종결 패턴 + 공백/개행 | 0.60 | 한 줄에 2문장 이상일 때만 |
| **R7** | **절** | §3.6 연결어미 채점 ≥ 0.75 | 가변 | **정밀도 편향. 이 규칙만 임계값을 갖는다** |

```ts
// R6 문장 경계 — 한국어 종결은 마침표 없이도 온다
export const RE_SENTENCE_END =
  /(?<=[가-힣])(?:다|요|죠|네요|습니다|ㅂ니다|십시오|세요|해요|어요|아요|군요|는군요|음|함|임|것|기)[.!?…]+(?=\s|$)|[.!?…]{1,3}(?=\s|$)/gu;

// 잘못 끊으면 안 되는 것들 (마침표가 종결이 아닌 경우)
export const RE_NOT_SENTENCE_END =
  /(?:\d\.\d|[A-Za-z]\.[A-Za-z]|(?:주식회사|㈜)\s?[가-힣]+\.|등\.|예\.|참고\.|vs\.|No\.|\.\w{2,4}$)/;
```

### 3.5 R2 표 행 → 열 매핑

엑셀·워드 표 복사는 **열이 곧 스키마**다. 첫 행이 헤더면 그대로 쓴다.

```ts
const COLUMN_ALIASES: Record<string, keyof ParsedItem | 'skip'> = {
  '순번': 'skip', 'no': 'skip', 'NO': 'skip', '번호': 'skip',
  '단계': 'title', '업무': 'title', '작업': 'title', '내용': 'title', '절차': 'title', '활동': 'title',
  '담당': 'assigneeHint', '담당자': 'assigneeHint', '수행자': 'assigneeHint', '부서': 'assigneeHint',
  '도구': 'toolHints', '시스템': 'toolHints', '사용도구': 'toolHints', '프로그램': 'toolHints',
  '소요시간': 'durationHint', '소요': 'durationHint', '시간': 'durationHint',
  '조건': 'branchCondition', '분기': 'branchCondition', '비고': 'skip', '비고사항': 'skip',
};
```

헤더가 없으면 **열 개수로 추정**: 2열 → `[title, assignee]`, 3열 → `[title, assignee, tool]`, 첫 열이 전부 숫자면 `skip`. 실패하면 **행 전체를 title로** 쓴다(무손실 우선).

### 3.6 R7 — 한 문단 안의 여러 동작을 어떻게 쪼개는가 (가장 어려운 부분)

정본 입력:

> `메일로 요청 받아서 엑셀에 정리하고 팀장님 컨펌 받고 ERP에 등록해요`

한국어 연결어미는 **다의적**이다. `-고`는 나열이기도 하고(`받고 정리하고`) 보조용언 구성이기도 하며(`하고 있다`) 인용이기도 하고(`된다고 했다`) 그냥 명사다(`재고`, `보고`, `참고`). 그래서 **어미 패턴 단독으로는 절대 쪼개지 않는다.**

#### (1) 후보 스캔 — 1-pass

```ts
// packages/paste-parse/src/segment/clause.ts
export const RE_CLAUSE_CANDIDATE = new RegExp([
  // ── 순차 강 (거의 항상 별개 동작)
  '(?<seqA>(?:하고|되고)\\s*(?:나서|난\\s*(?:뒤|후|다음)))',
  '(?<seqB>[가-힣]{1,12}?(?:한|된|하신)?\\s*(?:뒤|후|다음)에?)',
  '(?<imm>[가-힣]자마자)',
  // ── 조건 (분기 후보 — §5)
  '(?<cond>[가-힣](?:으면|면|라면|이면|거든))',
  '(?<condN>(?:인|일|할|한|하는|되는)\\s*경우(?:에는|에|엔)?|[가-힣]{1,10}\\s*시(?:에는|에)?)',
  // ── 나열/계속
  '(?<go>[가-힣]고)',
  '(?<seo>[가-힣](?:아서|어서|여서|해서))',
  // ── 약함
  '(?<sim>[가-힣](?:며|면서))',
  '(?<trans>[가-힣]다가)',
  // ── 분할 금지 (매칭되면 그 지점은 경계가 아니라고 확정한다)
  '(?<never>[가-힣](?:지만|는데|은데|려고|러|도록|게끔|더라도|아도|어도|든지|거나|나마))',
].join('|'), 'gu');

const BASE_WEIGHT = { seqA: 0.80, seqB: 0.80, imm: 0.70, cond: 0.60, condN: 0.65,
                      go: 0.55, seo: 0.45, sim: 0.30, trans: 0.30, never: -1 } as const;
```

#### (2) 게이트 — 후보를 죽이는 조건 (하나라도 걸리면 즉시 탈락)

```ts
/** -고로 끝나지만 동사가 아닌 명사들. 이게 없으면 "재고 확인하고"가 "재고" + "확인하고"로 갈린다 */
const NOUN_GO = new Set(['재고','보고','참고','신고','공고','광고','원고','예고','통고','경고',
                         '최고','중고','창고','사고','삼고','회고','권고','충고','조고','비고','상고','수고']);

/** 뒤에 오면 -고가 보조용언 구성인 것들: "하고 있다", "받아 놓고 있다" */
const AUX_AFTER = /^(?:있|계시|싶|말|나|보|주|드리|버리|두|놓|가|오|치우|대|앉|서)(?:[가-힣]|$)/;

/** -고 앞이 진짜 동사 어간인가 (표면형 화이트리스트 + X하/X되 패턴) */
const RE_GO_VERB = /(?:[가-힣]+(?:하|되|시키|당하)|받|보내|넣|올리|내리|적|쓰|주|가|오|만들|묶|맞추|채우|열|닫|찍|누르|눌러|뽑|고르|나누|합치|붙이|붙여넣|매기|알리|끝내|남기|옮기|바꾸|모으|찾|묻|보|듣|읽|앉히|걸)고$/;

/** 인용의 -고: "된다고", "하라고", "왔냐고", "가자고" */
const RE_QUOTE_GO = /[다라냐자][고]$/;

/** -아서/어서의 앞절이 준비 동작이면 별개 단계가 아니다: "엑셀 열어서 붙여넣고" */
const PREP_VERB = /(?:열|켜|들어가|접속하|로그인하|실행하|띄우|찾아|가|와|받아)(?:아서|어서|여서|해서)$/;

/** 조건절이지만 분기가 아닌 것: 앞 단계의 산출물 수령 */
const RE_RECEIVING_COND = /(?:받으면|오면|도착하면|되면|나면|끝나면|완료되면|채워지면|들어오면|생기면)$/;
```

#### (3) 채점 — 어미 강도 + **독립 증거**

핵심 아이디어: **연결어미는 "여기서 끊을 수 있다"만 말해준다. "끊어야 한다"는 문맥이 말해준다.**
가장 강력한 문맥 증거는 **도구 전환**이다. 정본 입력이 정확히 그 패턴이다 — 메일 → 엑셀 → 사람 → ERP.

```ts
export type ClauseSplit = { at: number; score: number; kind: keyof typeof BASE_WEIGHT };

export function scoreClauseSplits(text: string, base: number, ctx: SegCtx): ClauseSplit[] {
  const out: ClauseSplit[] = [];
  const forbid: number[] = [];
  RE_CLAUSE_CANDIDATE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = RE_CLAUSE_CANDIDATE.exec(text))) {
    const g = Object.entries(m.groups!).find(([, v]) => v != null);
    if (!g) continue;
    const [kind, tok] = g as [keyof typeof BASE_WEIGHT, string];
    const end = m.index + tok.length;

    // 어미 뒤에 공백이 없으면 어미가 아니다 ("고객" 안의 '고')
    if (end < text.length && !/[\s,]/.test(text[end])) continue;
    if (kind === 'never') { forbid.push(end); continue; }

    // ── 게이트 ──────────────────────────────────────────────
    if (kind === 'go') {
      const word = /[가-힣]+고$/.exec(text.slice(0, end))?.[0] ?? '';
      if (NOUN_GO.has(word)) continue;
      if (RE_QUOTE_GO.test(word)) continue;
      if (!RE_GO_VERB.test(word)) continue;
      if (AUX_AFTER.test(text.slice(end).trimStart())) continue;
    }
    if (kind === 'cond' && RE_RECEIVING_COND.test(text.slice(0, end).split(/\s/).pop() ?? '')) {
      // 수령형 조건 — 분기가 아니라 앞 단계와의 이음새. 끊되 분기로 승격하지 않는다
      out.push({ at: end, score: 0.5, kind: 'seqB' });
      continue;
    }

    let s: number = BASE_WEIGHT[kind];
    if (kind === 'seo' && PREP_VERB.test(text.slice(0, end).split(/\s/).pop() ?? '')) s -= 0.30;

    // ── 독립 증거 가산 ───────────────────────────────────────
    const left  = text.slice(0, end);
    const right = text.slice(end);
    const lTool = ctx.tools.scan(left), rTool = ctx.tools.scan(right);
    if (lTool.length && rTool.length && lTool.at(-1)!.id !== rTool[0].id) s += 0.25;  // ★ 도구 전환
    if (ctx.people.scan(left).at(-1)?.id !== ctx.people.scan(right)[0]?.id
        && ctx.people.scan(right).length) s += 0.20;                                  // 담당자 전환
    if (/[가-힣]{2,}(?:에|에서|으로|로|한테|에게|께)\s/.test(right.slice(0, 24))) s += 0.15; // 처소·도구 부사구
    if (hasActionPredicate(left) && hasActionPredicate(right)) s += 0.15;              // 양쪽에 서술어

    // ── 감산 ────────────────────────────────────────────────
    const lLen = end - lastSplit(out, 0), rLen = nextBoundary(text, end) - end;
    if (lLen < MIN_CLAUSE || rLen < MIN_CLAUSE) s -= 0.20;                             // 초단문
    if (ctx.traits.has('numbered') || ctx.traits.has('bulleted')) s -= 0.10;           // 저자가 이미 나눴다
    if (out.length >= MAX_SPLIT_PER_SENTENCE - 1) s -= 0.30;                           // 잘게 부수기 방지

    out.push({ at: end, score: s, kind });
  }

  return out
    .filter(c => c.score >= CLAUSE_THRESHOLD && !forbid.some(f => Math.abs(f - c.at) < 3))
    .slice(0, MAX_SPLIT_PER_SENTENCE);
}

export const CLAUSE_THRESHOLD = 0.75;   // ★ 미분할 편향의 수치적 정체
export const MIN_CLAUSE = 6;            // 자
export const MAX_SPLIT_PER_SENTENCE = 4;
```

#### (4) 이 채점기가 정본 입력에서 어떻게 도는가

| 후보 | 어미 | 기본 | 도구 전환 | 부사구 | 양쪽 서술어 | 합 | 판정 |
|---|---|---|---|---|---|---|---|
| `받아서` | seo | 0.45 | +0.25 (메일→엑셀) | +0.15 (`엑셀에`) | +0.15 | **1.00** | 분할 |
| `정리하고` | go | 0.55 | +0.25 (엑셀→사람) | — | +0.15 | **0.95** | 분할 |
| `받고` | go | 0.55 | +0.25 (사람→ERP) | +0.15 (`ERP에`) | +0.15 | **1.10** | 분할 |

그리고 반례에서 어떻게 **안 쪼개는가**:

| 입력 | 후보 | 계산 | 판정 |
|---|---|---|---|
| `실적취합.xlsx 열어서 시트에 붙여넣고` | `열어서` | 0.45 − 0.30(준비동사) + 0.15 + 0.15 = 0.45 | **유지** ✓ |
| `재고 확인하고 발주서 작성해요` | `재고` | `NOUN_GO` 게이트 탈락 | **유지** ✓ |
| `승인된다고 들었는데 확인해요` | `된다고` | `RE_QUOTE_GO` 탈락 / `는데` = never | **유지** ✓ |
| `엑셀 정리하고 있어요` | `정리하고` | `AUX_AFTER("있")` 탈락 | **유지** ✓ |
| `ERP에 전표를 입력하고 마감합니다` | `입력하고` | 0.55 + 0.15 + 0.15 = 0.85 → 우측 `마감합니다` 4자 < 6 ⇒ −0.20 = **0.65** | **유지** ✓ |

마지막 줄이 §0.2 편향이 실제로 작동하는 지점이다. `마감합니다`는 별도 단계일 수도 있지만, **애매하면 안 쪼갠다.**

---

## 4. 한국어 동사·문형 패턴 사전

전부 데이터 파일(`src/lexicon/*.ts`)로 분리한다. 코드가 아니라 **데이터**여야 §13에서 LLM이 사전을 확장할 수 있다.

### 4.1 작업 동사 (`task`)

어간 기준. 활용형은 §4.6 매처가 생성한다.

```ts
// src/lexicon/verbs.ts
export const ACTION_VERBS = [
  // 문서·데이터
  '작성','기재','입력','기입','등록','수정','삭제','정리','취합','집계','정산','대사','대조','검증',
  '확인','점검','검토','조회','검색','조사','분석','산출','계산','집행','반영','갱신','업데이트',
  // 이동·전달
  '발송','송부','전달','회신','답변','공유','업로드','다운로드','첨부','복사','붙여넣기','출력','인쇄','스캔',
  '제출','접수','수령','수취','반납','반려','이관','인계','배포','게시','공지','안내','통보','통지',
  // 승인·결재
  '상신','기안','품의','결재','승인','반려','전결','대결','서명','날인','捺印'.replace('捺印','날인'),
  // 물류·현장
  '발주','수주','출고','입고','배송','포장','검수','실사','재고조사','적재','피킹','반품','교환',
  // 시스템 조작
  '생성','발행','발급','신청','연동','동기화','백업','복구','설정','권한부여','계정생성','마감','정산마감',
  // 커뮤니케이션
  '요청','문의','협의','논의','보고','설명','미팅','통화','연락','알림','독촉','리마인드',
] as const;

/** 명사 + 접미 → 동사가 되는 패턴. 사전에 없는 명사도 잡는다 */
export const RE_VERBALIZER = /[가-힣]{2,}(?:하다|한다|해요|합니다|했|하고|하며|하여|해서|하기|함|해|시키|되다|된다|돼요|됩니다|되고|되어|돼서|됨)/;

/** 순수 동사 (명사+하 형태가 아닌 것) */
export const PLAIN_VERBS = [
  '받','보내','넣','빼','올리','내리','적','쓰','읽','주','가','오','만들','묶','풀','맞추','채우',
  '열','닫','찍','누르','뽑','고르','나누','합치','붙이','붙여넣','매기','알리','끝내','남기','옮기','바꾸','모으','찾','묻','걸','챙기',
] as const;
```

```ts
export function hasActionPredicate(clause: string): boolean {
  if (RE_VERBALIZER.test(clause)) return true;
  if (RE_PLAIN_VERB_INFLECTED.test(clause)) return true;
  return RE_NOUN_ENDING.test(clause.trim());   // 명사형 종결 (§4.6)
}
```

### 4.2 분기 신호 (`branch`)

```ts
// src/lexicon/branch.ts
export const BRANCH_MARKERS = {
  /** 조건 도입 — 문두에 오면 강함 */
  opener: /(?:^|\s)(?:만약|만일|혹시|가령|예를\s?들어|경우에\s?따라|상황에\s?따라|케바케)/,

  /** 조건 어미 */
  conditional: /[가-힣](?:으면|면|라면|이면|거든|더라도)(?=\s|,)/,
  caseNoun: /(?:인|일|할|한|하는|되는|아닌|없는|있는)\s*경우(?:에는|에|엔|만)?|[가-힣]{1,10}\s*시(?:에는|에)?(?=\s)/,

  /** 대안 표지 — ★ 이게 있어야 진짜 XOR 분기다 */
  alternative: /(?:^|\s)(?:아니면|그렇지\s?않으면|그\s?외에는|안\s?되면|불가하면|반려되면|거절되면|미승인|실패하면|아닐\s?때|없으면|해당\s?없으면|이외의\s?경우)/,

  /** 승인/반려 쌍 — 결재 흐름의 전형 */
  approvalPair: /(?:승인(?:되면|나면|되는\s?경우)|가결)[\s\S]{0,80}?(?:반려|부결|거절|미승인)/,

  /** 분류 기준 (택1 아님 — 반복 축) */
  perAxis: /(?:[가-힣]{1,10})(?:별로|마다|에\s?따라|기준으로)(?=\s)/,

  /** 동시 (AND) */
  parallel: /(?:동시에|병행(?:해서|하여)?|같이|나란히|각각|양쪽\s?다|모두)/,

  /** 조건 스킵 (갈래가 하나뿐) */
  skipOnly: /(?:에만|일\s?때만|인\s?경우에만|해당하면|필요하면|필요\s?시)(?=\s)/,
};
```

`branchMode` 결정:

```
alternative | approvalPair 존재  → 'xor'
parallel 존재                    → 'and'
conditional|caseNoun 만 존재     → 'skip'      ← 갈래가 하나뿐이라 사용자에게 빈칸을 요구하지 않는다
perAxis 존재                     → 'xor' + "갈래를 나열해달라" 후속 질문 플래그
```

`skip`으로 떨어뜨리는 게 중요하다. PRD §4.3의 `mode: 조건스킵`이 정확히 이 자리를 위해 있다. **조건은 있는데 대안이 없을 때 `xor`로 만들면 사용자가 빈 갈래를 마주한다 — 빈 화면 공포의 재발이다.**

### 4.3 대기 신호 (`hold`)

```ts
// src/lexicon/hold.ts
export const HOLD = {
  /** 대기 동사 — 주 서술어일 때만 hold로 인정 (§5.2) */
  verb: /(?:기다리|대기|보류|홀드|계류|묵히|멈추|중단하|지켜보)(?:다|고|는|며|면서|자|기|ㅁ|어요|습니다|세요|시|겠)/,

  /** 수동 수신 표현 */
  passive: /(?:올\s?때까지|올\s?때|올\s?것|도착할\s?때까지|받을\s?때까지|나올\s?때까지|될\s?때까지|나면|떨어지면)/,

  target: {
    approval: /(?:결재|전자결재|상신|기안|품의|승인|재가|전결|컨펌|confirm|사인|서명|결재선|결재\s?올리|올려|사장님\s?보고|윗선)/,
    reply:    /(?:회신|답변|답장|응답|리플|피드백|연락(?:을)?\s?기다|답\s?오|답이\s?오|확인\s?회신)/,
    time:     /(?:까지|마감|기한|월말|말일|월초|익일|다음\s?영업일|영업일|정시|매달\s?\d{1,2}일|D\+\d|\d{1,2}시(?:까지)?)/,
    resource: /(?:입고|도착|배송|자료(?:가)?\s?와|파일(?:이)?\s?오|발행(?:되면|될)|세금계산서|원본|서류(?:가)?\s?오|재고(?:가)?\s?들어)/,
  },

  /** ★ hold가 아닌 것 — 내가 하는 행위 */
  activeNotHold: /(?:회신(?:합니다|해요|한다|하기|할\s?것|드립니다)|답변(?:합니다|해요|한다)|보고(?:합니다|해요|한다)|올립니다|제출(?:합니다|해요))\s*$/,
};
```

`waitFor` 우선순위: `approval` > `resource` > `reply` > `time`.
`time`이 마지막인 이유 — `까지`는 대기 신호이기도 하지만 **마감이 있는 작업**이기도 하다. `8/20까지 회신` 은 task고, `8/20까지 기다린다`는 hold다. §5.2의 주 서술어 규칙이 이걸 가른다.

### 4.4 인계 · 종결 · 예외 신호

```ts
// src/lexicon/flow.ts
export const HANDOFF = {
  verb: /(?:넘기|넘겨|전달|이관|인계|배정|할당|넘어가|패스|포워딩|포워드|토스)/,
  dative: /([가-힣]{1,10}(?:팀|부서|파트|실|본부|센터|과|님|씨|담당자|담당|사|측))(?:에게|한테|께|으로|로|에)/g,
  polite: /(?:요청\s?드리|부탁\s?드리|공유\s?드리|전달\s?드리|말씀\s?드리|보내\s?드리)/,
};

export const TERMINAL = {
  word: /(?:완료|마무리|마감|종료|끝(?:이에요|입니다|납니다|)|종결|클로즈|closing|보관|아카이브|파일링|철하|스캔해서\s?보관)/,
  phrase: /(?:여기까지|이걸로\s?끝|이후\s?없|더\s?이상\s?없|그러면\s?끝)/,
};

export const EXCEPTION = {
  opener: /(?:^|\s)(?:단,|다만,?|예외적으로|특이사항|주의|참고로|유의|except|간혹|가끔|드물게|보통은\s?아니지만)/,
  negativeCase: /(?:안\s?될\s?경우|안\s?되면|불가(?:능)?할\s?때|문제(?:가)?\s?생기면|오류(?:가)?\s?나면|누락(?:되면|된\s?경우)|틀리면|실패(?:하면|시))/,
};
```

`EXCEPTION.opener`로 시작하는 줄은 **단계로 만들지 않고 직전 항목의 예외 각주로 붙인다**(P4 흡수의 변형). PRD가 "예외는 존재가 아니라 빈도로 묻는다"고 한 그 예외 슬롯이다. 별도 단계로 만들면 흐름이 예외로 오염된다.

### 4.5 문체 혼재 — 무엇을 정규화하고 무엇을 두는가

한국 실무 문서에는 네 문체가 한 문서에 섞여 들어온다.

| 문체 | 예 | 감지 |
|---|---|---|
| `haeyo` 해요체 | `등록해요`, `보내요`, `받아요` | `/(?:해요\|어요\|아요\|예요\|이에요\|돼요\|봐요\|줘요)[.!?]?$/` |
| `hamnida` 합쇼체 | `등록합니다`, `송부합니다` | `/(?:합니다\|습니다\|ㅂ니다\|십시오\|세요)[.!?]?$/` |
| `plain` 평서체 | `등록한다`, `확인한다` | `/(?:[가-힣](?:는다\|ㄴ다\|다))[.]?$/` |
| `noun` 명사형 | `등록`, `확인함`, `제출할 것`, `취합하기` | `/(?:[가-힣](?:함\|됨\|임\|음)\|하기\|할\s?것\|요망\|필요\|바람\|요함)$/` 또는 §2.2 `RE_NOUN_END` |

**정규화 방침 — 문체는 통일하지 않는다.**

WRITING.md §6의 에디터 placeholder가 `예: 영업사원이 카톡으로 견적 요청을 보내요` 다. 제품은 **사용자의 말투를 그대로 둔다**. 문체 통일은 (a) 목소리를 지우고 (b) 변환 실패 시 이상한 문장을 만들고 (c) 무손실 철학과 충돌한다.

**바꾸는 것은 딱 하나 — 절 분할로 잘려서 연결어미로 끝나버린 제목.** 그것도 문서의 **지배 문체로** 맞춘다.

```ts
export function dominantStyle(items: string[]): Style {
  const c = { haeyo: 0, hamnida: 0, plain: 0, noun: 0 };
  for (const t of items) { const s = detectStyle(t); if (s) c[s]++; }
  const top = (Object.entries(c) as [Style, number][]).sort((a, b) => b[1] - a[1])[0];
  return top[1] === 0 ? 'haeyo' : top[0];    // 기본값은 제품 톤과 같은 해요체
}
```

### 4.6 어미 보정 폐쇄표

```ts
// src/lexicon/endings.ts — 표에 없으면 원문을 그대로 둔다. 추측하지 않는다
type Style = 'haeyo' | 'hamnida' | 'plain' | 'noun';

export const ENDING_FIX: readonly [RegExp, Record<Style, string>][] = [
  // 명사+하/되 (압도적 다수)
  [/하고$/,        { haeyo:'해요',   hamnida:'합니다', plain:'한다', noun:'하기' }],
  [/하여$|해서$/,  { haeyo:'해요',   hamnida:'합니다', plain:'한다', noun:'하기' }],
  [/하며$|하면서$/,{ haeyo:'해요',   hamnida:'합니다', plain:'한다', noun:'하기' }],
  [/한\s*(?:뒤|후|다음)에?$/, { haeyo:'해요', hamnida:'합니다', plain:'한다', noun:'하기' }],
  [/되고$|되어$|돼서$/, { haeyo:'돼요', hamnida:'됩니다', plain:'된다', noun:'되기' }],
  // 규칙 활용 (어간 + 아/어 계열) — 접미만 갈아끼우면 맞는다
  [/아서$/,        { haeyo:'아요',   hamnida:'습니다', plain:'는다', noun:'기' }],
  [/어서$/,        { haeyo:'어요',   hamnida:'습니다', plain:'는다', noun:'기' }],
  // 빈출 불규칙 — 개별 등재
  [/^(.*)받고$/,   { haeyo:'$1받아요', hamnida:'$1받습니다', plain:'$1받는다', noun:'$1받기' }],
  [/^(.*)보내고$/, { haeyo:'$1보내요', hamnida:'$1보냅니다', plain:'$1보낸다', noun:'$1보내기' }],
  [/^(.*)넣고$/,   { haeyo:'$1넣어요', hamnida:'$1넣습니다', plain:'$1넣는다', noun:'$1넣기' }],
  [/^(.*)붙여넣고$/,{haeyo:'$1붙여넣어요', hamnida:'$1붙여넣습니다', plain:'$1붙여넣는다', noun:'$1붙여넣기' }],
  [/^(.*)올리고$/, { haeyo:'$1올려요', hamnida:'$1올립니다', plain:'$1올린다', noun:'$1올리기' }],
  [/^(.*)내리고$/, { haeyo:'$1내려요', hamnida:'$1내립니다', plain:'$1내린다', noun:'$1내리기' }],
  [/^(.*)적고$/,   { haeyo:'$1적어요', hamnida:'$1적습니다', plain:'$1적는다', noun:'$1적기' }],
  [/^(.*)쓰고$/,   { haeyo:'$1써요',   hamnida:'$1씁니다',   plain:'$1쓴다',   noun:'$1쓰기' }],
  [/^(.*)주고$/,   { haeyo:'$1줘요',   hamnida:'$1줍니다',   plain:'$1준다',   noun:'$1주기' }],
  [/^(.*)만들고$/, { haeyo:'$1만들어요', hamnida:'$1만듭니다', plain:'$1만든다', noun:'$1만들기' }],
  [/^(.*)열고$/,   { haeyo:'$1열어요', hamnida:'$1엽니다',   plain:'$1연다',   noun:'$1열기' }],
  [/^(.*)닫고$/,   { haeyo:'$1닫아요', hamnida:'$1닫습니다', plain:'$1닫는다', noun:'$1닫기' }],
  [/^(.*)찍고$/,   { haeyo:'$1찍어요', hamnida:'$1찍습니다', plain:'$1찍는다', noun:'$1찍기' }],
  [/^(.*)누르고$/, { haeyo:'$1눌러요', hamnida:'$1누릅니다', plain:'$1누른다', noun:'$1누르기' }],
  [/^(.*)뽑고$/,   { haeyo:'$1뽑아요', hamnida:'$1뽑습니다', plain:'$1뽑는다', noun:'$1뽑기' }],
  [/^(.*)나누고$/, { haeyo:'$1나눠요', hamnida:'$1나눕니다', plain:'$1나눈다', noun:'$1나누기' }],
  [/^(.*)합치고$/, { haeyo:'$1합쳐요', hamnida:'$1합칩니다', plain:'$1합친다', noun:'$1합치기' }],
  [/^(.*)알리고$/, { haeyo:'$1알려요', hamnida:'$1알립니다', plain:'$1알린다', noun:'$1알리기' }],
  [/^(.*)옮기고$/, { haeyo:'$1옮겨요', hamnida:'$1옮깁니다', plain:'$1옮긴다', noun:'$1옮기기' }],
  [/^(.*)바꾸고$/, { haeyo:'$1바꿔요', hamnida:'$1바꿉니다', plain:'$1바꾼다', noun:'$1바꾸기' }],
  [/^(.*)찾고$/,   { haeyo:'$1찾아요', hamnida:'$1찾습니다', plain:'$1찾는다', noun:'$1찾기' }],
  [/^(.*)끝내고$/, { haeyo:'$1끝내요', hamnida:'$1끝냅니다', plain:'$1끝낸다', noun:'$1끝내기' }],
];

export function fixEnding(title: string, style: Style): string {
  const t = title.replace(/[,·\s]+$/, '');
  for (const [re, rep] of ENDING_FIX) if (re.test(t)) return t.replace(re, rep[style]);
  // 폴백 1: -고로 끝나면 명사형으로 (어간 + 기)
  if (/[가-힣]고$/.test(t)) return t.slice(0, -1) + '기';
  // 폴백 2: 손대지 않는다 ★
  return t;
}
```

**폴백 2가 이 표의 존재 이유다.** 어색한 제목보다 **틀린 제목**이 훨씬 비싸다. 그리고 어떤 경우에도 `sourceRange`가 원문을 가리키고 있으므로 사용자는 언제든 원문을 되살릴 수 있다.

---

## 5. 타입 분류 (task / branch / hold)

### 5.1 규칙 기반인가 점수 기반인가 — **게이트 우선 + 점수 보조 하이브리드**

순수 점수제는 이 문제에 맞지 않는다. 세 클래스의 **오분류 비용이 비대칭**이기 때문이다.

| 오분류 | 사용자가 겪는 것 | 복구 비용 |
|---|---|---|
| `task` → `branch` (거짓 분기) | **빈 갈래 슬롯**이 생긴다. 자식 자리가 열리고 사용자는 "여기 뭘 넣으라는 거지"를 마주한다. 그래프에도 XOR 노드가 그려진다 | **높음.** 타입 변경 op + 자식 재배치 op + 그래프 재계산. 무엇보다 *빈 화면 공포의 재발* |
| `branch` → `task` (분기 놓침) | 그냥 한 줄로 남는다. 그림이 일자가 된다 | **낮음.** 배지 클릭 1회 → 조건 입력 |
| `hold` ↔ `task` | 배지 색만 다르다 | **낮음.** 클릭 1회. `waitFor`는 4지선다 |

→ **`task`가 기본값이고, `branch` 승격은 가장 엄격하게, `hold` 승격은 중간으로.**
점수제는 게이트를 통과한 뒤 **`hold`의 세부 판단**과 **애매한 `branch`의 최종 컷**에만 쓴다.

### 5.2 분류기

```ts
// packages/paste-parse/src/classify.ts
export type Verdict = {
  kind: ItemKind;
  branchMode?: 'xor' | 'and' | 'skip';
  branchCondition?: string;
  waitFor?: WaitFor;
  confidence: number;      // 0..1 — §9와 §13(LLM 재판정 구간 선정)에 쓰인다
  rule: string;            // 어떤 규칙이 발화했는가 (텔레메트리·디버깅)
};

export function classify(seg: Segment, ctx: ClassifyCtx): Verdict {
  const t = seg.text;
  const mainPred = mainPredicate(t);   // 마지막 서술어 구 (§5.3)

  // ══ G1. 분기 게이트 — 조건 + 구조적 증거를 동시에 요구한다 ═══════
  const cond = matchCondition(t);      // {span, text} | null
  if (cond) {
    const hasAlt =
      BRANCH_MARKERS.alternative.test(t) ||
      BRANCH_MARKERS.approvalPair.test(t) ||
      ctx.siblingsAhead.slice(0, 3).some(s => BRANCH_MARKERS.alternative.test(s.text));
    const hasParallel = BRANCH_MARKERS.parallel.test(t);
    const explicit = BRANCH_MARKERS.opener.test(t);          // "만약"
    const perAxis = BRANCH_MARKERS.perAxis.test(t);

    // 수령형 조건은 분기가 아니다 ("자료 받으면", "결재 완료되면")
    if (!RE_RECEIVING_COND.test(cond.text)) {
      if (hasAlt)      return { kind:'branch', branchMode:'xor',  branchCondition:cond.text, confidence:0.90, rule:'G1.alt' };
      if (hasParallel) return { kind:'branch', branchMode:'and',  branchCondition:cond.text, confidence:0.75, rule:'G1.and' };
      if (perAxis)     return { kind:'branch', branchMode:'xor',  branchCondition:cond.text, confidence:0.65, rule:'G1.axis' };
      if (explicit || BRANCH_MARKERS.skipOnly.test(t) || EXCEPTION.negativeCase.test(t))
                       return { kind:'branch', branchMode:'skip', branchCondition:cond.text, confidence:0.70, rule:'G1.skip' };
      // 조건은 있는데 증거가 약하다 → 점수로 마지막 판단
      const s = 0.35 + (cond.at === 0 ? 0.20 : 0) + (ctx.childCandidates >= 2 ? 0.25 : 0);
      if (s >= 0.60) return { kind:'branch', branchMode:'skip', branchCondition:cond.text, confidence:s, rule:'G1.score' };
    }
  }

  // ══ G2. 대기 게이트 — "손을 놓고 기다리는가"가 유일한 기준 ═══════
  if (!HOLD.activeNotHold.test(mainPred)) {
    const waitVerb = HOLD.verb.test(mainPred) || HOLD.passive.test(t);
    const target = pickWaitTarget(t);                        // approval > resource > reply > time
    const submitting = /(?:결재|기안|품의)(?:를)?\s*(?:올리|상신|제출)|승인(?:을)?\s*(?:요청|받)|컨펌(?:을)?\s*받/.test(t);

    if (waitVerb && target)  return { kind:'hold', waitFor:target, confidence:0.85, rule:'G2.verb' };
    if (submitting)          return { kind:'hold', waitFor:'approval', confidence:0.80, rule:'G2.submit' };
    if (target === 'approval' && /(?:승인|결재|컨펌|재가)(?:되|나|될|날)/.test(t))
                             return { kind:'hold', waitFor:'approval', confidence:0.70, rule:'G2.approvalPassive' };
    // 점수 보조: 대기 대상은 있는데 대기 동사가 없다
    if (target) {
      const s = 0.30 + (target === 'approval' ? 0.25 : 0.10)
              + (/(?:까지|동안|간)\s*$/.test(mainPred) ? 0.15 : 0)
              + (hasActionPredicate(t) ? -0.15 : 0.15);      // 내가 하는 동작이면 감점
      if (s >= 0.55) return { kind:'hold', waitFor:target, confidence:s, rule:'G2.score' };
    }
  }

  return { kind: 'task', confidence: 0.80, rule: 'default' };
}
```

### 5.3 주 서술어 추출 — 종속절의 어휘에 속지 않기

`"여신한도는 재무팀 승인 후 입력할 것"` 은 `승인`을 포함하지만 **하는 일은 입력**이다. 이걸 `hold`로 찍으면 흐름이 통째로 멈춘 것처럼 그려진다.

```ts
/** 문장의 마지막 서술어 구를 잘라낸다 (뒤에서 앞으로 최대 20자) */
export function mainPredicate(t: string): string {
  const s = t.trim().replace(/[.!?…]+$/, '');
  const m = /(?:[가-힣]{1,12}(?:합니다|습니다|해요|어요|아요|한다|는다|하기|할\s?것|함|됨|하세요|하시면|하고|해서))\s*$/.exec(s);
  return m ? m[0] : s.slice(-20);
}
```

부속절에서만 대기 어휘가 발견되면 `hold`로 승격하지 않는다. 대신 **`holdSuspect` 플래그**를 남기고, PRD §4.5 질문 연쇄가 *"여기 누구 기다리는 데가 있나요?"* 로 회수한다. **파서가 확신 없이 구조를 만드는 것보다 질문 한 줄이 싸다.**

### 5.4 분류 결정표 (요약)

```
조건절 O + 대안 표지 O                      → branch/xor    (0.90)
조건절 O + 동시 표지 O                      → branch/and    (0.75)
조건절 O + "별로/마다/에 따라"               → branch/xor    (0.65) + 갈래 나열 질문
조건절 O + "만약"/"~만"/부정 케이스          → branch/skip   (0.70)
조건절 O + 자식 후보 2개 이상                → branch/skip   (0.60)
수령형 조건 (받으면/되면/완료되면)            → branch 아님. 이음새로 흡수
대기 동사 + 대기 대상                        → hold          (0.85)
결재 상신 / 승인 요청 / 컨펌 받기            → hold/approval (0.80)
"~까지" + 대기 동사                          → hold/time     (0.70)
"~까지" + 행위 동사                          → task (마감 있음)
그 외                                        → task          (0.80)
```

---

## 6. 계층 추정

**전제: 계층도 §0.2 편향을 따른다.** 증거가 없으면 평면(`depth: 0`)이다.
잘못 중첩된 항목은 그래프에서 갈래로 그려지고, 사용자가 그걸 되돌리려면 드래그 + 부모 재지정 op가 필요하다. 평평한 리스트를 들여쓰는 건 `Tab` 한 번이다.

### 6.1 들여쓰기가 있을 때 — 순위 사다리

들여쓰기 폭을 나누기(`width / unit`) 하면 안 된다. 워드는 2·4·5·7열을 섞고, 한글은 전각 공백을 쓰며, 탭과 공백이 한 문서에 공존한다.
→ **관측된 폭들을 정렬해 순위를 매긴다.**

```ts
// packages/paste-parse/src/depth.ts
const TAB_COLS = 4;
export function indentWidth(raw: string): number {
  let w = 0;
  for (const c of raw) w += c === '\t' ? TAB_COLS - (w % TAB_COLS) : (c === '　' ? 2 : 1);
  return w;
}

/** 관측 폭 → 레벨 사다리. 1열 이내 차이는 같은 레벨로 흡수한다 */
export function buildIndentLadder(lines: Line[]): number[] {
  const widths = [...new Set(lines.filter(l => l.text.trim()).map(l => l.indentWidth))].sort((a, b) => a - b);
  const ladder: number[] = [];
  for (const w of widths) {
    if (!ladder.length || w - ladder[ladder.length - 1] > 1) ladder.push(w);
  }
  return ladder;               // ladder.indexOf(가장 가까운 값) = depth
}

export function depthFromIndent(w: number, ladder: number[]): number {
  let best = 0;
  for (let i = 0; i < ladder.length; i++) if (w >= ladder[i] - 1) best = i;
  return Math.min(best, MAX_DEPTH);
}
export const MAX_DEPTH = 2;    // 0,1,2 — 3단을 넘으면 그림이 읽히지 않는다 (DESIGN.md §6)
```

**들여쓰기 사다리가 깊이 4 이상을 만들면 사다리를 의심한다.** 4단 이상은 워드 자동 번호가 붕괴한 흔적일 확률이 높다. 이때는 사다리를 버리고 §6.2 마커 클래스로 폴백한다.

### 6.2 들여쓰기가 없거나 못 믿을 때 — 마커 클래스 사다리

마커 클래스의 서열을 **하드코딩하지 않는다.** 문서마다 다르다(`1. → 가. → ①` 인 문서도, `1. → 1) → -` 인 문서도 있다).
→ **등장 순서로 학습한다.** 문서에서 처음 나온 마커 클래스가 depth 0이고, 그 아래에서 처음 나온 새 클래스가 depth 1이다.

```ts
export function assignDepthByMarkerClass(lines: Line[]): Map<MarkerClass, number> {
  const stack: MarkerClass[] = [];
  const depth = new Map<MarkerClass, number>();
  for (const l of lines) {
    const c = l.marker?.cls;
    if (!c) continue;
    if (depth.has(c)) {                       // 이미 아는 클래스 → 그 깊이로 되감기
      stack.length = depth.get(c)! ;
      stack.push(c);
      continue;
    }
    depth.set(c, Math.min(stack.length, MAX_DEPTH));
    stack.push(c);
  }
  return depth;
}
```

`heading`(`#`)은 예외적으로 레벨을 자기 값으로 갖는다(`##` = 1). 그리고 **heading은 단계가 아니라 문서 제목/섹션**이므로 §8.5에서 대부분 `drop`된다.

두 신호가 모두 있으면 **들여쓰기가 이긴다.** 마커 클래스는 같은 들여쓰기 안에서 동점을 깰 때만 쓴다.

### 6.3 분기 다음 줄들을 어떻게 자식으로 묶는가

`branch` 항목 뒤에 오는 항목들을 무조건 자식으로 삼으면 흐름 전체가 분기 밑으로 빨려 들어간다. **닫는 조건이 규칙의 본체다.**

```ts
export function nestBranchScope(items: Draft[], ctx: NestCtx): void {
  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    if (b.kind !== 'branch') continue;

    const parentIndent = b.line.indentWidth, parentDepth = b.depth;
    let taken = 0;

    for (let j = i + 1; j < items.length && taken < MAX_BRANCH_CHILDREN; j++) {
      const c = items[j];

      // ── 닫는 조건 (하나라도 걸리면 스코프 종료) ──────────────
      if (c.line.indentWidth < parentIndent) break;                       // 들여쓰기가 되돌아옴
      if (c.line.blankBefore >= 2) break;                                 // 빈 줄 블록 경계
      if (c.marker && c.marker.cls === b.marker?.cls) break;              // 같은 서열 마커 = 형제
      if (c.speaker && b.speaker && c.speaker !== b.speaker && !isAlt(c)) break;  // 화자 전환
      if (TERMINAL.word.test(c.text) && !isAlt(c)) break;                 // 종결 어휘
      if (c.kind === 'branch' && !isAlt(c)) break;                        // 다음 분기 시작

      // ── 자식으로 인정하는 조건 (셋 중 하나) ──────────────────
      const sameSentence = c.originLine === b.originLine;                 // (a) 같은 문장에서 갈라짐
      const altMarker    = isAlt(c);                                      // (b) 대안 표지로 시작
      const deeperIndent = c.line.indentWidth > parentIndent;             // (c) 더 깊은 들여쓰기
      if (!(sameSentence || altMarker || deeperIndent)) break;

      c.depth = Math.min(parentDepth + 1, MAX_DEPTH);
      c.parentId = b.id;
      taken++;
    }

    // 자식이 하나도 안 붙은 xor 분기는 skip으로 강등한다 (빈 갈래 금지)
    if (taken === 0 && b.branchMode === 'xor') b.branchMode = 'skip';
    if (taken === 1 && b.branchMode === 'xor') b.branchMode = 'skip';
  }
}
const isAlt = (c: Draft) => BRANCH_MARKERS.alternative.test(c.text) || /^(?:승인|반려|가결|부결)/.test(c.text);
export const MAX_BRANCH_CHILDREN = 4;
```

마지막 두 줄이 중요하다. **자식이 0~1개인 `xor`는 존재할 수 없다.** 갈래가 하나뿐인 분기는 정의상 `skip`(조건부 수행)이다. 이 강등이 없으면 사용자는 "갈래를 하나 더 넣으세요"라는 빈칸을 받는다.

### 6.4 들여쓰기가 전혀 없는 카톡에서 분기를 복원하는 법

카톡에는 계층이 **줄에 없고 문장 안에 있다.**

> `숫자가 전주 대비 20% 넘게 차이나면 영업팀 박과장님한테 확인 한번 받아주세요 아니면 그냥 진행하시면 돼요`

복원 절차:

```
1) R7 절 분할이 이 발화를 3조각으로 나눈다
   ┌ "숫자가 전주 대비 20% 넘게 차이나면"          ← cond 후보, score 0.60 + 대안 표지 존재 ⇒ 통과
   ├ "영업팀 박과장님한테 확인 한번 받아주세요"
   └ "아니면 그냥 진행하시면 돼요"                  ← alternative 표지

2) §5 G1.alt 가 첫 조각을 branch/xor 로 승격 (같은 발화 안에 alternative가 있으므로)

3) §6.3 nestBranchScope 가 나머지 둘을 자식으로 흡수
   - 조건 (a) sameSentence == true  → 둘 다 통과
   - 닫는 조건: 발화가 끝나면 originLine이 바뀌므로 자동 종료 ★

  결과:
    branch  "숫자가 전주 대비 20% 넘게 차이나면"      depth 0
      ├ hold "영업팀 박과장님한테 확인 한번 받아요"     depth 1  waitFor: approval
      └ task "아니면 그냥 진행해요"                    depth 1
```

**`originLine` 경계가 스코프의 자연스러운 울타리 역할을 한다.** 카톡은 발화가 곧 문장이므로, "같은 발화에서 갈라진 것만 자식" 규칙이 거의 정확하게 맞는다. 발화를 넘어서까지 자식으로 끌고 가지 않는다.

화자 전환은 계층 신호가 **아니다.** `박정우: 넵` 같은 응답이 자식으로 붙으면 안 되므로, 화자 전환은 스코프를 닫는다(위 코드 4번째 break).

---

## 7. 메타 힌트 추출

§0.2대로 이 절 전체가 **재현율 편향**이다. 틀려도 배지 클릭 1회다.
단 하나의 예외: `assigneeHint`는 ARCHITECTURE.md가 `assignee_id` FK를 강제하므로 **자유 텍스트로 저장되지 않는다.** 파서는 후보 문자열만 내고, 확정은 디렉터리(WorkOS Directory Sync) 대조 화면에서 한다.

### 7.1 도구 — 최장일치 트라이 + 조사 경계

사전은 TOOLS.md의 48종 × 동의어를 그대로 빌드타임에 컴파일한다.

```ts
// packages/paste-parse/src/hints/tools.ts  (사전은 tools.generated.ts 에서 생성)
export type ToolAlias = {
  id: string;            // 카탈로그 FK
  display: string;       // '엑셀'
  alias: string;         // '액셀'
  ambiguous?: boolean;   // 일반명사와 충돌 → 문맥 요구
  requires?: RegExp;     // ambiguous일 때 근처(±20자)에 있어야 하는 단서
};

export const AMBIGUOUS: Record<string, RegExp> = {
  '시트':   /구글|스프레드|공유\s?시트|시트에\s?(?:입력|정리|기록)/,   // "엑셀 시트"의 일반명사 시트 배제
  '드라이브':/구글|원|공유|G\s?드라이브|드라이브에\s?(?:올리|업로드|저장)/,
  '카드':   /법인|명세|매출|카드사|승인내역/,
  '폼':     /구글\s?폼|설문|응답/,
  '보드':   /화이트|칸반|잔디|트렐로/,
  '플로우': /flow|협업|메신저|채널/,
  '위하고': /더존|ERP|회계|전표/,                                    // "~을 위하고" 배제
  '전화':   /(?:전화(?:로|를|해|드려|받|걸|주)|통화|유선)/,
  '노션':   /(?:노션)/,
  '잔디':   /(?:잔디\s?(?:토픽|방|에|으로|로)|JANDI)/,               // 식물 잔디 배제
  '알밤':   /출퇴근|근태|알밤\s?(?:앱|에|으로)/,
};

/** 한글에는 단어 경계가 없다 → 앞뒤 문자를 직접 검사한다 */
const RE_BEFORE_OK = /(?:^|[\s,.·:;()\[\]{}"'「『/\-–—>|\t])$/;
const RE_AFTER_OK  = /^(?:에서|에게|한테|으로|에|은|는|이|가|을|를|로|와|과|도|만|의|랑|이랑|하고|부터|까지|나|든|든지|처럼|보다|같이)?(?:$|[\s,.·:;()\[\]{}"'」』/\-–—<|\t\n])/;

export class ToolScanner {
  private trie: Trie;                                  // 모듈 스코프에서 1회 빌드 (§12)
  scan(text: string): ToolHit[] {
    const hits: ToolHit[] = [];
    for (let i = 0; i < text.length; ) {
      const m = this.trie.longestAt(text, i);          // 최장일치
      if (!m) { i++; continue; }
      const end = i + m.alias.length;
      if (!RE_BEFORE_OK.test(text.slice(Math.max(0, i - 1), i)) || !RE_AFTER_OK.test(text.slice(end, end + 4))) { i++; continue; }
      const ctx = AMBIGUOUS[m.alias];
      if (ctx && !ctx.test(text.slice(Math.max(0, i - 20), end + 20))) { i = end; continue; }
      hits.push({ id: m.id, display: m.display, span: [i, end] });
      i = end;                                          // 겹침 방지
    }
    return dedupeById(hits);
  }
}
```

**오탐을 막는 4중 장치**

1. **최장일치** — `구글시트`가 있으면 `시트`로 매칭하지 않는다.
2. **조사 경계** — `엑셀런트`는 `엑셀`로 매칭되지 않는다(`런`이 조사 목록에 없음).
3. **동음이의 문맥 요구** — 위 `AMBIGUOUS` 표. 가장 많은 오탐을 잡는다.
4. **확정하지 않음** — TOOLS.md §정규화 규칙 1대로 배지로 뜬다. `toolHints`는 항상 "후보"다.

**부정 문맥은 처리하지 않는다.** `"엑셀 안 쓰고 구글시트로 해요"`에서 엑셀이 잡히는 건 허용한다. 부정 스코프를 규칙으로 잡으려 들면 오탐보다 부작용이 크고, 배지 삭제 1클릭이 더 싸다. (§13에서 LLM이 볼 첫 번째 후보 항목이다.)

**미매칭 수집** — 트라이에 걸리지 않았지만 도구스러운 토큰(`[A-Za-z]{3,}` 또는 `[가-힣]{2,6}(?:에|에서)\s*(?:입력|등록|정리|올리)`)은 `unmatchedToolCandidates`로 모아 올린다. TOOLS.md §운영규칙 2의 **카탈로그 확장 큐**를 실제로 채우는 유일한 경로다.

### 7.2 담당자

```ts
// src/hints/people.ts
export const RE_MENTION  = /@([가-힣]{2,4}|[A-Za-z][A-Za-z0-9._-]{1,20})/g;
export const RE_ORG      = /([가-힣A-Za-z]{1,8}(?:팀|부서|파트|실|본부|센터|과|국|지점|영업소|공장|법인))(?=[\s,.]|에서|에게|께|으로|로|이|가|은|는|의|$)/g;
export const RE_RANK     = /(?:([가-힣]{1,3}))?\s*(사장|부사장|전무|상무|이사|본부장|실장|팀장|파트장|그룹장|부장|차장|과장|대리|주임|사원|매니저|담당자|담당|점장|소장|기사|반장|대표)(님|씨)?/g;
export const RE_NAME_HON = /([가-힣]{2,4})\s*(?:님|씨)(?=[\s,.]|에게|한테|께|이|가|은|는|의|$)/g;
export const RE_SELF     = /(?:^|\s)(?:제가|내가|저는|나는|본인이|직접)(?=\s)/;

const HONORIFIC_STRIP = /(?:님|씨|분)$/;
const ROLE_ONLY = new Set(['담당자','담당','실무자','작성자','승인자','결재자','요청자','고객','거래처','업체','상대방','사용자']);
```

우선순위와 정규화:

```
1) @멘션            → 사람 후보 (가장 강함). "@김철수" → { kind:'person', name:'김철수' }
2) 이름+직급+님     → 사람 후보. "박과장님"    → { kind:'person', name:'박과장' }   ※ 님 제거
3) 이름+님          → 사람 후보. "김수연님"    → { kind:'person', name:'김수연' }
4) 조직+직급        → 역할 후보. "구매팀장"    → { kind:'role', name:'구매팀장' }
5) 조직             → 역할 후보. "재무팀에서"  → { kind:'role', name:'재무팀' }
6) 직급 단독        → 역할 후보. "팀장님께"    → { kind:'role', name:'팀장' }
7) 1인칭            → { kind:'self' }  → assigneeHint 를 비우고 "나"로 기본 배정
```

**격조사로 방향을 읽는다** — 이게 담당자와 상대방을 가른다.

| 조사 | 의미 | 매핑 |
|---|---|---|
| `~에게`, `~한테`, `~께`, `~로` | 수신자 | 다음 단계의 담당자 후보 (인계) |
| `~에서`, `~이/가` | 행위자 | 이 단계의 담당자 |
| `~와/과 함께`, `~랑` | 협업자 | 담당자로 쓰지 않음 |

여러 후보가 잡히면 **행위자 > 수신자 > 조직** 순으로 하나만 `assigneeHint`에 넣고, 나머지는 버린다. 두 명을 넣을 자리가 스키마에 없고, 넣어도 사용자가 지워야 한다.

### 7.3 소요시간

```ts
// src/hints/duration.ts
const NUM_KO: Record<string, number> = { 반:0.5, 한:1, 두:2, 세:3, 네:4, 댓:5, 다섯:5, 여섯:6,
  일곱:7, 여덟:8, 아홉:9, 열:10, 열다섯:15, 스무:20, 서른:30 };

export const RE_DURATION = /(?:약|대략|한)?\s*(\d{1,3}(?:[.~-]\d{1,3})?|반|한|두|세|네|댓|다섯|여섯|일곱|여덟|아홉|열|열다섯|스무|서른)\s*(분|시간|일|주일?|개월|달|년)\s*(?:정도|쯤|가량|내외|씩|남짓|이상|넘게)?/g;
export const RE_DURATION_WORD = /(잠깐|금방|바로|순식간|한나절|반나절|하루\s?종일|온종일|하루|이틀|사흘|나흘|닷새|일주일|열흘|보름|한\s?달)/g;

const WORD_MIN: Record<string, number> = {
  '잠깐':2,'금방':2,'바로':1,'순식간':1,'한나절':240,'반나절':240,'하루 종일':480,'온종일':480,
  '하루':480,'이틀':960,'사흘':1440,'나흘':1920,'닷새':2400,'일주일':2400,'열흘':4800,'보름':7200,'한 달':9600,
};
const UNIT_MIN: Record<string, number> = { '분':1,'시간':60,'일':480,'주':2400,'주일':2400,'개월':9600,'달':9600,'년':115200 };

/** ARCHITECTURE.md items.duration_band 로 접는다 */
export function toBand(min: number): DurationBand {
  if (min <= 2)   return '1m';
  if (min <= 7)   return '5m';
  if (min <= 20)  return '15m';
  if (min <= 90)  return '1h';
  if (min <= 300) return 'halfday';
  return '1d+';
}
```

**주의 — 소요시간이 아닌 시간 표현을 배제한다.**

```ts
/** 시점·마감·주기는 durationHint가 아니다 */
const RE_TIMEPOINT = /(?:\d{1,2}시(?:까지|에)|오전|오후|월말|말일|매|다음\s?주|내일|모레|익일|D[+\-]\d|\d{1,2}\/\d{1,2}|\d{4}[-.]\d{1,2}|까지)\s*$/;
```
`"입사 3일 전"`, `"D+1까지"`, `"8/20까지"`는 소요시간이 **아니다.** 앞뒤 4자를 보고 `까지`·`전`·`후`·`이내`가 붙으면 기한으로 분류하고 `durationHint`를 비운다.
`hold` 항목에서 잡힌 소요시간은 `attrs.avgWaitH`로 간다(작업 시간이 아니라 대기 시간이다). 이 구분은 리드타임 계산이 오염되지 않는 유일한 방법이다.

### 7.4 빈도

```ts
export const RE_FREQ = /(매일|날마다|일일|매주|주\s?[1-9]\s?회|매월|매달|월\s?[1-9]\s?회|매년|연\s?[1-9]\s?회|분기(?:마다|별|에\s?한\s?번)?|반기|격주|격월|월말|월초|말일|초일|매\s?[월화수목금토일]요일|매월\s?\d{1,2}일|매주\s?[월화수목금토일]요일|하루에\s?\d{1,2}\s?(?:번|건)|수시로|필요할\s?때마다|요청\s?시(?:마다)?|건별로|건건이|틈틈이|비정기(?:적)?|부정기)/g;

/** freqLast7d 추정치 — PRD의 "지난 7일 동안 몇 번" 축에 맞춘다 */
export const FREQ_TO_7D: Record<string, number> = {
  '매일': 5, '날마다': 5, '일일': 5,
  '매주': 1, '주 1회': 1, '주 2회': 2, '주 3회': 3, '주 5회': 5,
  '격주': 0, '매월': 0, '매달': 0, '월말': 0, '말일': 0, '격월': 0,
  '분기': 0, '반기': 0, '매년': 0,
  '수시로': 3, '건별로': 3, '건건이': 3, '틈틈이': 3,
};
```

`0`이 나오는 항목은 `freqLast7d`를 **저장하지 않는다.** 0으로 저장하면 "지난 7일 동안 0번"이 되어 집계에서 이 업무가 사라진다. 대신 `freqHint` 원문(`'매월 말일'`)만 남기고, 카드 스택 단계에서 사용자에게 확인받는다.

---

## 8. 노이즈 제거

### 8.1 삭제하지 않는다 — 두 등급으로 "표시"한다

```ts
export type Dropped = { range: Span; reason: DropReason; tier: 'strip' | 'demote' };
```

| tier | 의미 | UI |
|---|---|---|
| `strip` | 확실한 비본문 (메일 헤더, 타임스탬프, 페이지 번호) | 결과 화면에 보이지 않음. "숨긴 줄 12개 보기" 링크로만 접근 |
| `demote` | 본문일 수도 있는 것 (인사말, 문맥 섹션, 예산 초과분) | 결과 화면에 **회색 텍스트로 그대로 표시**. `[단계로 만들기]` 인라인 버튼 |

`demote`가 있어서 "과잉 제거로 본문을 날렸다"는 사고가 **사용자에게 보이는 사고**가 되지 않는다. 최악의 경우에도 화면에 남아 있다.

### 8.2 감지기 목록

```ts
// src/noise/detectors.ts — 각 감지기는 Span[]만 반환한다
export const DETECTORS: NoiseDetector[] = [
  { id:'mail_header',  tier:'strip',  fn: mailHeaderBlock },   // 선두 연속 헤더 블록만
  { id:'quoted',       tier:'strip',  fn: quoteBlocks },
  { id:'signature',    tier:'strip',  fn: signatureTail },     // §8.3
  { id:'chat_meta',    tier:'strip',  fn: chatPrefixes },      // 타임스탬프+화자 프리픽스
  { id:'page_number',  tier:'strip',  fn: pageNumbers },
  { id:'running_head', tier:'strip',  fn: repeatedLines },     // §8.4
  { id:'separator',    tier:'strip',  fn: rulers },            // ----, ====, ***
  { id:'doc_title',    tier:'demote', fn: docTitle },          // 첫 heading/괄호 제목 1개
  { id:'section_header',tier:'demote',fn: sectionHeaders },
  { id:'greeting',     tier:'demote', fn: greetings },
  { id:'closing',      tier:'demote', fn: closings },
  { id:'lead_in',      tier:'demote', fn: leadIns },           // "아래 순서로 진행하시면 됩니다"
  { id:'ack',          tier:'demote', fn: acks },              // "넵", "확인했습니다", "ㅇㅋ"
  { id:'emoticon',     tier:'demote', fn: emoticonOnlyLines },
  { id:'context_section',tier:'demote',fn: nonActionSections },// §8.5
  { id:'schedule',     tier:'demote', fn: scheduleLines },     // "다음 회의: ..."
  { id:'meta_stat',    tier:'demote', fn: metaStats },         // "한 건에 20분쯤 걸려요"
];
```

```ts
export const RE_GREETING = /^\s*(?:안녕하세요[.!,~\s]*|수고\s?많으십니다[.!,\s]*|[가-힣]{1,8}(?:팀|부)?\s*[가-힣]{2,4}입니다[.!,\s]*|반갑습니다[.!,\s]*)$/;
export const RE_ACK      = /^\s*(?:넵?|네{1,3}|예|웅|응|ㅇㅋ|오케이|확인했습니다|확인했어요|알겠습니다|알겠어요|감사합니다|ㄳ|굿|좋아요|👍|ok|OK)[.!~\s]*$/;
export const RE_LEAD_IN  = /^(?:아래|다음)(?:와\s?같이|\s?순서로|\s?내용)?\s*(?:참고|진행|확인)?(?:하시면\s?됩니다|해\s?주세요|드립니다|입니다)[.!\s]*$/;
export const RE_RULER    = /^\s*(?:[-=_*~·—–]{3,}|[─━]{3,})\s*$/;
export const RE_EMOJI_ONLY = /^\s*(?:[ㅋㅎㅠㅜ]{1,}|[😀-🙏🚀-🛿☀-➿☀-➿]{1,5})\s*$/u;
export const RE_META_STAT = /(?:한\s?건에|보통|평균|대개|하루에|한\s?달에)\s?.{0,20}(?:분|시간|건|번).{0,12}(?:걸리|들|와요|옵니다|정도)/;
export const RE_SCHEDULE  = /^\s*[-•]?\s*(?:다음|차기|next)\s?(?:회의|미팅|일정)\s*[:：]/i;
```

### 8.3 서명 꼬리 탐색 — 뒤에서 앞으로, 상한을 걸고

서명은 "위치 + 밀도"로만 안전하게 잡힌다. 정규식 하나로 잡으려 하면 본문을 먹는다.

```ts
export function signatureTail(lines: Line[]): Span[] {
  const last = lastNonEmptyIndex(lines);
  if (last < 3) return [];
  const MAX_LINES = 8;
  const MAX_RATIO = 0.15;                                  // 문서의 15% 넘게 서명일 수 없다

  let start = -1;
  for (let i = last; i >= Math.max(0, last - MAX_LINES); i--) {
    const t = lines[i].text.trim();
    if (!t) continue;
    const signalish =
      RE_SIGN_CONTACT.test(t) || RE_MAIL_ADDR.test(t) || RE_SIGN_TITLE.test(t) ||
      /^https?:\/\//.test(t) || /^[가-힣]{2,4}$/.test(t) ||                   // 이름만 있는 줄
      /(?:주식회사|㈜|Inc\.|Corp\.|Ltd\.)/.test(t) ||
      /^\s*(?:드림|올림|배상)\s*$/.test(t);
    if (!signalish) break;                                  // ★ 본문을 만나면 즉시 멈춘다
    if (hasActionPredicate(t) && t.length > 12) break;       // ★ 동작 문장이면 서명이 아니다
    start = i;
  }
  if (start < 0) return [];
  const span: Span = [lines[start].span[0], lines[last].span[1]];
  if ((span[1] - span[0]) / totalChars(lines) > MAX_RATIO) return [];  // 상한 초과 → 포기
  return [span];
}
```

`감사합니다` 같은 종결 인사는 서명 블록의 **시작 신호로만** 쓰고, 그것만 따로 지우지 않는다(그 자체가 `closing`/demote로 별도 처리된다). 본문 중간의 `감사합니다`는 건드리지 않는다 — **줄 전체가 그것뿐일 때만** 매칭되는 앵커드 정규식이기 때문이다.

### 8.4 반복 헤더/푸터 — 간격 검증이 필수

```ts
export function repeatedLines(lines: Line[]): Span[] {
  const key = (t: string) => t.trim().replace(/\d+/g, '#').replace(/\s+/g, ' ');
  const groups = new Map<string, number[]>();
  for (const l of lines) { const t = l.text.trim(); if (t && t.length <= 40) push(groups, key(t), l.i); }

  const out: Span[] = [];
  for (const [, idxs] of groups) {
    if (idxs.length < 3) continue;
    const sample = lines[idxs[0]].text.trim();
    if (hasActionPredicate(sample)) continue;                    // ★ 동작 문장은 반복돼도 본문이다
    // ★ 간격 검증: 페이지 머리말/꼬리말은 거의 일정한 간격으로 나온다
    const gaps = idxs.slice(1).map((v, k) => v - idxs[k]);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (mean < 5) continue;                                      // 연속 반복은 목록이지 헤더가 아니다
    if (stdev(gaps) / mean > 0.35) continue;                     // 불규칙하면 본문
    out.push(...idxs.map(i => lines[i].span));
  }
  return out;
}
```

`hasActionPredicate` 가드와 간격 검증, 이 둘이 `"확인한다"`가 세 번 나온다고 지워버리는 사고를 막는다.

### 8.5 섹션 게이팅 (회의록 전용)

`trait.sectioned`일 때만 켠다.

```ts
const ACTION_SECTIONS = /(?:액션\s?아이템|Action\s?Items?|실행\s?항목|후속\s?조치|To-?Do|할\s?일|업무\s?분장|결정\s?사항)/i;
const CONTEXT_SECTIONS = /(?:논의\s?(?:내용|사항)|배경|현황|참고|공유\s?사항|이슈|안건|기타)/;
```

액션 섹션이 **하나라도 있으면** 컨텍스트 섹션 전체를 `demote('context_section')`한다. 액션 섹션이 없으면 게이팅을 켜지 않는다(전부 후보로 둔다). **"확실히 액션이 어디 있는지 아는 경우에만" 나머지를 내린다.**

### 8.6 과잉 제거 방어 — 예산제 + 하드 가드

```ts
export function applyNoise(cands: Dropped[], work: string): { kept: Dropped[]; overBudget: number } {
  const total = countNonWhitespace(work);
  const BUDGET = 0.35;                                        // 원문 비공백 문자의 35%

  // 하드 가드 1: 문서 중앙 60% 구간의 signature/closing 은 strip 금지 → demote 강등
  for (const d of cands) {
    const mid = (d.range[0] + d.range[1]) / 2 / work.length;
    if (d.tier === 'strip' && (d.reason === 'signature' || d.reason === 'closing') && mid > 0.2 && mid < 0.8) d.tier = 'demote';
  }
  // 하드 가드 2: 인용이 문서의 80% 이상이면 인용이 본문이다 → 인용 제거 전량 취소
  const quoted = sum(cands.filter(d => d.reason === 'quoted').map(len));
  if (quoted / total > 0.8) cands = cands.filter(d => d.reason !== 'quoted');

  // 예산: strip을 신뢰도 순으로 적용하다 예산을 넘으면 이후는 demote로 강등
  const order: DropReason[] = ['mail_header','chat_meta','page_number','separator','running_head','quoted','signature'];
  let used = 0, over = 0;
  for (const d of cands.sort(byReasonOrder(order))) {
    const n = countNonWhitespace(work.slice(...d.range));
    if (d.tier === 'strip' && (used + n) / total > BUDGET) { d.tier = 'demote'; d.reason = 'over_budget'; over += n; continue; }
    if (d.tier === 'strip') used += n;
  }
  return { kept: cands, overBudget: over };
}
```

그리고 **최종 가드 3개**:

```
G-a. 노이즈 제거 후 단계 후보가 0개  → 제거 전량 롤백, confidence = 'low'
G-b. strip 총량 > 35%                 → 초과분 demote 강등 + confidence 한 등급 강등
G-c. demote 총량 > 50%                → confidence = 'low' 강제 (UI가 원문 병치 모드로 간다)
```

---

## 9. 신뢰도 산출

### 9.1 공식

> ## ⚠️ 구현이 찾아낸 결함 — 이 공식은 게으를수록 높은 점수를 준다
>
> `markerCoverage`(마커 기반 항목 / 전체 항목)와 `1 − clauseRatio`(절 분할 비중의 역수)는
> **같은 방향을 두 번 보상한다.** 절 분할을 덜 할수록 분모가 줄어 `markerCoverage`가 오르고,
> 동시에 `clauseRatio`가 내려가 두 번째 항도 오른다.
>
> ```
> 항목 11개 중 마커 8개  →  coverage 0.73
> 항목  8개 중 마커 8개  →  coverage 1.00     ← 분할을 3번 덜 했을 뿐인데
> ```
>
> **파서가 일을 덜 할수록 신뢰도가 높아진다.** 실제로 픽스처 F5가 이 때문에 `mid` 대신 `high`를 받는다.
>
> **정정** — `markerCoverage`의 분모를 **전체 항목이 아니라 "마커가 있을 수 있었던 위치 수"**로 바꾼다.
> 절 분할로 생긴 항목은 애초에 마커를 가질 수 없으므로 분모에서 뺀다. 그러면 두 항이 독립해진다.
> `1 − clauseRatio`는 그대로 두되 **가중치를 0.15 → 0.20**으로 올린다 — 추론 의존도는 신뢰도의
> 직접 신호이고, 이제 중복 보상이 아니다.
>
> 구현은 `packages/paste-parse`의 `deviations`에 이 판단이 기록되어 있다.

```ts
export function computeConfidence(s: Signals): { level: Confidence; score: number; reasons: string[] } {
  const score =
      0.30 * s.markerCoverage        // 명시 마커로 경계가 정해진 항목의 비율 (R1·R2)
    + 0.20 * s.predicateRatio        // 서술어(동사/명사형 종결)로 끝나는 항목의 비율
    + 0.15 * s.lengthSanity          // 항목 길이 중앙값이 6~60자 안이면 1, 벗어날수록 감소
    + 0.15 * (1 - s.clauseRatio)     // R7(절 분할)로 만들어진 항목의 비율 — 높을수록 추론 의존
    + 0.10 * s.sourceCertainty       // §2 detect().certainty
    + 0.10 * (1 - s.tailRatio);      // unparsedTail 비중

  const reasons: string[] = [];
  let level: Confidence = score >= 0.72 ? 'high' : score >= 0.45 ? 'mid' : 'low';

  // ── 하드 강등 ────────────────────────────────────────────
  const demote = (to: Confidence, why: string) => { if (rank(to) < rank(level)) { level = to; reasons.push(why); } };
  if (s.itemCount < 2)         demote('low', 'single_block');
  if (s.itemCount > 60)        demote('mid', 'too_many_items');
  if (s.tailRatio > 0.30)      demote('mid', 'large_tail');
  if (s.demotedRatio > 0.50)   demote('low', 'over_demoted');
  if (s.clauseRatio > 0.60)    demote('mid', 'clause_heavy');
  if (s.avgItemLen < 5)        demote('mid', 'fragments');
  if (s.sourceHint === 'unknown' && s.markerCoverage < 0.2) demote('mid', 'unknown_source');

  return { level, score, reasons };
}
```

`reasons`가 MEASUREMENT.md `paste_parsed.confidence_bucket` 옆에 붙어 나간다. **"왜 낮았는가"가 없으면 규칙 개선의 다음 후보를 못 고른다.**

### 9.2 신뢰도별 UI (WRITING.md·STATES.md 문안 준수)

| | `high` (≥0.72) | `mid` (0.45~0.72) | `low` (<0.45) |
|---|---|---|---|
| 레이아웃 | 결과 리스트 단독 | 결과 리스트 단독 | **2단 — 왼쪽 원문 / 오른쪽 제안** |
| 헤더 문안 | `이렇게 나눠봤어요. 틀린 데는 고치면 돼요.` | 〃 | `제가 나눈 거라 어색한 데가 있을 거예요. 합치거나 지워주세요.` |
| 주 버튼 | `[이대로 가져오기]` | `[이대로 가져오기]` | **`[원문 그대로 넣기]`** ← 주/보조가 뒤바뀐다 |
| 보조 버튼 | `[처음부터 직접 쓸래요]` | 〃 | `[이대로 가져오기]` |
| 경계 표시 | 없음 | 추론 경계(R6·R7)에만 **점선 + 왼쪽 노란 보더** | 모든 경계에 점선 |
| 인라인 버튼 | 호버 시 노출 | **상시 노출** `[위와 합치기]` `[여기서 나누기]` | 상시 노출 |
| 배지(도구·담당자) | 노출 | 노출 | **노출하지 않는다** — 경계를 못 믿는데 메타를 물으면 신뢰가 더 깎인다 |
| 로딩 | 없음 (STATES.md §붙여넣기) | 없음 | 없음 |

절대 하지 않는 것: **"실패"라는 단어를 쓰지 않는다.** `low`도 결과 화면이지 에러 화면이 아니다.
`low`에서 `[원문 그대로 넣기]`를 주 버튼으로 올리는 것이 이 표의 핵심이다. 신뢰도가 낮을 때 제품이 해야 할 일은 더 설득하는 게 아니라 **한 발 물러서는 것**이다.

---

## 10. 실패 처리와 부분 성공

### 10.1 아예 못 나눌 때 (한 덩어리)

```ts
if (segments.length <= 1 && work.trim().length >= 200) {
  return {
    items: [singleItem(orig)],              // sourceRange = [0, orig.length]
    dropped: [],
    confidence: 'low',
    ruleHits,
    failure: { reason: 'single_block' },     // → MEASUREMENT paste_parse_failed
  };
}
```

UI는 WRITING.md §에러의 문안을 그대로 쓴다 —
`붙여넣으신 글을 단계로 나누기 어려웠어요. 형식이 좀 특이한 것 같아요. 원문은 여기 그대로 둘게요.`
그리고 STATES.md의 복구 안내를 붙인다 — `줄 끝에서 Enter를 치시면 단계가 나뉘어요.`

`failure.reason`의 값은 MEASUREMENT.md가 정의한 4종과 정확히 일치시킨다: `too_short | no_delimiter | single_block | over_limit`.

- `too_short`: 비공백 20자 미만 → 파싱하지 않고 그대로 1항목
- `no_delimiter`: 줄이 1개이고 문장 종결도 연결어미도 없음
- `single_block`: 위 코드
- `over_limit`: §10.3

### 10.2 앞부분만 나눠질 때 — `unparsedTail`

꼬리가 생기는 경우는 셋이다.

```
(1) 길이 상한 초과      → 상한 이후 전부
(2) 파서 예외 발생      → 예외 시점 이후 전부 (try/catch가 부분 결과를 살린다)
(3) 시간 예산 초과      → 남은 구간 전부 (워커에서 800ms 초과 시)
```

```ts
export type ParseResult = {
  items: ParsedItem[];
  dropped: Dropped[];
  confidence: Confidence;
  ruleHits: RuleHits;
  unparsedTail?: string;
  unparsedTailRange?: Span;      // ★ 문자열만 주면 무손실 검증을 할 수 없다
  failure?: { reason: FailureReason; at?: number };
  /* ... 부록 A */
};
```

**꼬리는 자르지 않는다.** 상한을 넘겼다고 원문을 버리는 게 아니라, 상한 이후를 **그대로 문서에 한 덩어리 항목으로 넣는다.** 잘라내는 순간 무손실이 깨진다.
꼬리 절단 지점은 반드시 **줄 경계**로 스냅한다 (문장 중간에서 끊으면 사용자 눈에 파손으로 보인다).

UI 문안(WRITING.md): `앞부분만 나눌 수 있었어요. 뒤쪽은 제가 못 읽었어요. 남은 건 아래에 원문 그대로 뒀어요.`

### 10.3 크기 가드

```ts
export const LIMITS = {
  SYNC_CHARS: 8_000,      // 이하 & 200줄 이하 → 메인 스레드 동기 (STATES.md §성능: 300ms 예산)
  SYNC_LINES: 200,
  PARSE_CHARS: 20_000,    // 이 지점까지만 규칙을 돌린다
  PARSE_LINES: 2_000,
  HARD_CHARS: 200_000,    // 초과 시 파싱 자체를 시도하지 않는다
  TIME_BUDGET_MS: 800,    // 워커 내부 예산
} as const;

export function route(text: string): 'sync' | 'worker' | 'raw' {
  const lines = countLines(text);
  if (text.length > LIMITS.HARD_CHARS) return 'raw';
  if (text.length <= LIMITS.SYNC_CHARS && lines <= LIMITS.SYNC_LINES) return 'sync';
  return 'worker';
}
```

- **20,000자 초과**: 앞 20,000자(줄 경계 스냅)만 파싱하고 나머지는 `unparsedTail`. `failure.reason = 'over_limit'`.
- **200,000자 초과**: 파싱 시도 없음. 항목 1개 = 원문 전체. 문안: `글이 너무 길어서 나누지 않고 그대로 넣었어요.`
- 어느 경우에도 **원문 문자열은 op에 통째로 실려 서버에 저장된다.** 파싱은 원문 위의 뷰일 뿐이다.

### 10.4 무손실 보장 — 이 문서에서 가장 중요한 함수

```ts
// packages/paste-parse/src/lossless.ts
export class LossError extends Error {
  constructor(readonly code: 'overlap' | 'gap' | 'tail' | 'title_drift' | 'oob', readonly at: number) {
    super(`lossless violation: ${code} at ${at}`);
  }
}

export function assertLossless(orig: string, r: ParseResult): void {
  const spans: Span[] = [
    ...r.items.map(i => i.sourceRange),
    ...r.dropped.map(d => d.range),
    ...(r.unparsedTailRange ? [r.unparsedTailRange] : []),
  ].sort((a, b) => a[0] - b[0]);

  let pos = 0;
  for (const [s, e] of spans) {
    if (s < 0 || e > orig.length || s > e) throw new LossError('oob', s);
    if (s < pos) throw new LossError('overlap', s);                       // 구간이 겹치면 원문이 중복된다
    if (/\S/.test(orig.slice(pos, s))) throw new LossError('gap', pos);   // ★ 설명되지 않은 문자
    pos = e;
  }
  if (/\S/.test(orig.slice(pos))) throw new LossError('tail', pos);

  // 제목이 원문에서 유래했는가 (§13에서 LLM이 들어와도 이 검사가 그대로 막아준다)
  for (const it of r.items) {
    const raw = stripMarker(orig.slice(...it.sourceRange)).replace(/\s+/g, '');
    const ttl = it.title.replace(/\s+/g, '');
    if (ttl.length === 0) continue;
    const drift = levenshteinCapped(raw, ttl, 8) / Math.max(raw.length, 1);
    if (drift > 0.25) throw new LossError('title_drift', it.sourceRange[0]);
  }
}
```

**세 겹의 보장.**

| 층 | 무엇을 막는가 |
|---|---|
| 1. 스팬 대수 (§0.1) | 애초에 문자열을 자르지 않으므로 잃을 방법이 없다. 모든 연산이 인덱스 산술이다 |
| 2. `assertLossless` | 로직 버그로 구간이 겹치거나 빈틈이 생기면 즉시 던진다. **dev·prod 양쪽에서 실행** (O(N) 한 번, 20KB에서 <1ms) |
| 3. 원문 보존 op | 파싱 성공 여부와 무관하게 원문 전문이 `op.payload.rawText`로 저장된다. STATES.md §실행취소대로 **파싱 1회 = op 1개**이므로 `Cmd+Z` 한 번이면 원문만 남은 상태로 정확히 되돌아간다 |

그리고 **전 파이프라인을 감싸는 폴백**:

```ts
export function parse(orig: string): ParseResult {
  try {
    const r = parseInner(orig);
    assertLossless(orig, r);                       // 실패하면 아래 catch로
    return r;
  } catch (e) {
    report(e);                                     // 텔레메트리 (파싱 실패는 조용히 넘어가면 안 된다)
    return {
      items: [singleItem(orig)], dropped: [], confidence: 'low',
      ruleHits: EMPTY_HITS, failure: { reason: 'single_block' },
    };
  }
}
```

**어떤 예외도 사용자에게 "붙여넣기가 안 됐다"로 보이지 않는다.** 최악의 결과는 "안 나뉜 원문 한 덩어리"이고, 그건 실패가 아니라 §0.1이 정의한 성공의 하한이다.

### 10.5 골든 픽스처가 무손실의 회귀 테스트다

ARCHITECTURE.md §6이 `packages/graph-core/src/__fixtures__/`에 골든 픽스처 50+를 요구했다. 파서도 같은 규율을 쓴다.

```ts
// packages/paste-parse/src/__fixtures__/*.fixture.ts
test.each(FIXTURES)('%s — 무손실', (f) => {
  const r = parse(f.input);
  expect(() => assertLossless(f.input, r)).not.toThrow();
});
test.each(FIXTURES)('%s — 기대 출력', (f) => {
  expect(normalizeForCompare(parse(f.input))).toEqual(f.expected);
});
```

§11의 6개가 그 시드다. **속성 테스트도 함께 돈다** — 무작위 한국어 문장 조합 1,000건에 대해 `assertLossless`만 검증한다. 기대 출력은 없어도 무손실은 항상 참이어야 한다.

---

## 11. 골든 픽스처 6개 — 입출력 대조

아래 6개는 그대로 `packages/paste-parse/src/__fixtures__/`에 들어간다.
**6개 전부 무손실 파티션 검증(§10.4)을 통과했다** — 항목 구간 + 버림 구간 사이의 모든 빈틈이 공백 문자뿐임을 실제로 계산해 확인했다.

읽는 법:

- `sourceRange`는 **원문 문자 인덱스 `[시작, 끝)`** 이며 **마커를 포함한다** (`"1) 매월 5일에…"`의 `1) `까지). 마커 제거는 `title`에서만 일어난다.
- `dropped[]`는 **삭제가 아니라 보류**다. `tier: 'demote'`인 항목은 결과 화면에 회색으로 그대로 보인다 (§8.1).
- `toolHints`는 확정이 아니라 **배지 후보**다 (TOOLS.md §운영규칙 1).
- `assigneeHint`는 **후보 문자열**이며 저장 시 디렉터리와 대조해 `assignee_id`로 해석된다 (§7.2).
- F4 입력의 탭 문자는 `\t`로 표기했다.
- 지면상 `id`는 `F1-01` 형태로 썼다. 실제 구현은 클라이언트 발급 UUID다 (ARCHITECTURE.md §0 (1)).

### F1 · 한글/워드 SOP 매뉴얼 (번호 3단 + 표기 혼재 + 페이지 번호)

**입력** (`285자` · `sourceHint: 'word_sop'`)

```text
[거래처 신규 등록 절차]

1. 신규 거래처 등록 요청 접수
   가. 영업담당자가 메일로 사업자등록증 사본을 송부한다.
   나. 첨부파일 누락 여부를 확인한다.
2. 사업자 정보 조회
   ① 홈택스에서 사업자등록상태를 조회한다. (약 10분)
   ② 휴폐업 사업자인 경우 영업담당자에게 반려한다.
3. ERP 등록
   - 더존 ERP > 기초등록 > 거래처등록 에 입력한다.
   - 여신한도는 재무팀 승인 후 입력할 것
4. 등록 완료 통보
   완료 메일을 영업담당자에게 회신한다.

- 1 -
```

**기대 출력** (항목 11 · 버림 2 · 무손실 검증 통과)

```json
{
  "items": [
    {
      "id": "F1-01",
      "title": "신규 거래처 등록 요청 접수",
      "kind": "task",
      "depth": 0,
      "toolHints": [],
      "sourceRange": [
        16,
        34
      ]
    },
    {
      "id": "F1-02",
      "title": "영업담당자가 메일로 사업자등록증 사본을 송부한다",
      "kind": "task",
      "depth": 1,
      "toolHints": [
        "사내 메일(IMAP)"
      ],
      "assigneeHint": "영업담당자",
      "sourceRange": [
        38,
        68
      ]
    },
    {
      "id": "F1-03",
      "title": "첨부파일 누락 여부를 확인한다",
      "kind": "task",
      "depth": 1,
      "toolHints": [],
      "sourceRange": [
        72,
        92
      ]
    },
    {
      "id": "F1-04",
      "title": "사업자 정보 조회",
      "kind": "task",
      "depth": 0,
      "toolHints": [],
      "sourceRange": [
        93,
        105
      ]
    },
    {
      "id": "F1-05",
      "title": "홈택스에서 사업자등록상태를 조회한다",
      "kind": "task",
      "depth": 1,
      "toolHints": [
        "홈택스"
      ],
      "durationHint": "10분",
      "sourceRange": [
        109,
        139
      ]
    },
    {
      "id": "F1-06",
      "title": "휴폐업 사업자인 경우 영업담당자에게 반려한다",
      "kind": "branch",
      "depth": 1,
      "branchCondition": "휴폐업 사업자인 경우",
      "branchMode": "skip",
      "toolHints": [],
      "assigneeHint": "영업담당자",
      "sourceRange": [
        143,
        170
      ]
    },
    {
      "id": "F1-07",
      "title": "ERP 등록",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "더존 ERP"
      ],
      "sourceRange": [
        171,
        180
      ]
    },
    {
      "id": "F1-08",
      "title": "더존 ERP > 기초등록 > 거래처등록 에 입력한다",
      "kind": "task",
      "depth": 1,
      "toolHints": [
        "더존 ERP"
      ],
      "sourceRange": [
        184,
        215
      ]
    },
    {
      "id": "F1-09",
      "title": "여신한도는 재무팀 승인 후 입력할 것",
      "kind": "task",
      "depth": 1,
      "toolHints": [],
      "assigneeHint": "재무팀",
      "sourceRange": [
        219,
        241
      ]
    },
    {
      "id": "F1-10",
      "title": "등록 완료 통보",
      "kind": "task",
      "depth": 0,
      "toolHints": [],
      "sourceRange": [
        242,
        253
      ]
    },
    {
      "id": "F1-11",
      "title": "완료 메일을 영업담당자에게 회신한다",
      "kind": "task",
      "depth": 1,
      "toolHints": [
        "사내 메일(IMAP)"
      ],
      "assigneeHint": "영업담당자",
      "sourceRange": [
        257,
        277
      ]
    }
  ],
  "dropped": [
    {
      "range": [
        0,
        14
      ],
      "reason": "doc_title"
    },
    {
      "range": [
        279,
        284
      ],
      "reason": "page_number"
    }
  ],
  "confidence": "high",
  "docTitleHint": "거래처 신규 등록 절차"
}
```

### F2 · 카카오톡 인수인계 (타임스탬프 + 들여쓰기 0 + 문장 내 분기)

**입력** (`432자` · `sourceHint: 'kakao'`)

```text
2026년 8월 12일 오후 2:11, 김수연 : 대리님 다음주부터 제가 휴가라 인수인계 드려요 ㅠㅠ
2026년 8월 12일 오후 2:11, 김수연 : 매주 화요일 오전에 영업팀에서 주간 실적 엑셀 파일이 메일로 와요
2026년 8월 12일 오후 2:12, 김수연 : 그거 받으면 실적취합.xlsx 열어서 해당 주차 시트에 붙여넣고 피벗 새로고침 한 번 눌러주시면 돼요
2026년 8월 12일 오후 2:13, 김수연 : 숫자가 전주 대비 20% 넘게 차이나면 영업팀 박과장님한테 확인 한번 받아주세요 아니면 그냥 진행하시면 돼요
2026년 8월 12일 오후 2:14, 박정우 : 넵
2026년 8월 12일 오후 2:15, 김수연 : 다 되면 팀장님께 결재 올리고 승인 나면 공유드라이브에 올려주시면 끝이에요
2026년 8월 12일 오후 2:15, 김수연 : 감사합니다!!
```

**기대 출력** (항목 8 · 버림 10 · 무손실 검증 통과)

```json
{
  "items": [
    {
      "id": "F2-01",
      "title": "매주 화요일 오전에 영업팀에서 주간 실적 엑셀 파일이 메일로 와요",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "엑셀",
        "사내 메일(IMAP)"
      ],
      "assigneeHint": "영업팀",
      "freqHint": "매주 화요일",
      "sourceRange": [
        85,
        121
      ]
    },
    {
      "id": "F2-02",
      "title": "그거 받으면 실적취합.xlsx 열어서 해당 주차 시트에 붙여넣어요",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "엑셀"
      ],
      "sourceRange": [
        150,
        185
      ]
    },
    {
      "id": "F2-03",
      "title": "피벗 새로고침 한 번 눌러요",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "엑셀"
      ],
      "sourceRange": [
        186,
        206
      ]
    },
    {
      "id": "F2-04",
      "title": "숫자가 전주 대비 20% 넘게 차이나면",
      "kind": "branch",
      "depth": 0,
      "branchCondition": "전주 대비 20% 넘게 차이남",
      "branchMode": "xor",
      "toolHints": [],
      "sourceRange": [
        235,
        256
      ]
    },
    {
      "id": "F2-05",
      "title": "영업팀 박과장님한테 확인 한번 받아요",
      "kind": "hold",
      "depth": 1,
      "waitFor": "approval",
      "toolHints": [],
      "assigneeHint": "박과장",
      "sourceRange": [
        257,
        279
      ]
    },
    {
      "id": "F2-06",
      "title": "아니면 그냥 진행해요",
      "kind": "task",
      "depth": 1,
      "toolHints": [],
      "sourceRange": [
        280,
        295
      ]
    },
    {
      "id": "F2-07",
      "title": "다 되면 팀장님께 결재 올려요",
      "kind": "hold",
      "depth": 0,
      "waitFor": "approval",
      "toolHints": [
        "그룹웨어 전자결재"
      ],
      "assigneeHint": "팀장",
      "sourceRange": [
        354,
        370
      ]
    },
    {
      "id": "F2-08",
      "title": "승인 나면 공유드라이브에 올려요",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "구글 드라이브"
      ],
      "sourceRange": [
        371,
        395
      ]
    }
  ],
  "dropped": [
    {
      "range": [
        0,
        28
      ],
      "reason": "chat_meta"
    },
    {
      "range": [
        28,
        56
      ],
      "reason": "greeting"
    },
    {
      "range": [
        57,
        85
      ],
      "reason": "chat_meta"
    },
    {
      "range": [
        122,
        150
      ],
      "reason": "chat_meta"
    },
    {
      "range": [
        207,
        235
      ],
      "reason": "chat_meta"
    },
    {
      "range": [
        296,
        324
      ],
      "reason": "chat_meta"
    },
    {
      "range": [
        324,
        325
      ],
      "reason": "ack"
    },
    {
      "range": [
        326,
        354
      ],
      "reason": "chat_meta"
    },
    {
      "range": [
        396,
        424
      ],
      "reason": "chat_meta"
    },
    {
      "range": [
        424,
        431
      ],
      "reason": "closing"
    }
  ],
  "confidence": "mid"
}
```

### F3 · 메일 스레드 (헤더 + 서명 + 인용 + 번호 목록)

**입력** (`509자` · `sourceHint: 'email'`)

```text
보낸사람: 이지훈 <jhlee@example.co.kr>
받는사람: 총무팀 <ga@example.co.kr>
참조: 최민경
제목: RE: [요청] 8월 법인카드 사용내역 정산 건
날짜: 2026-08-14 (목) 09:32

총무팀 이지훈입니다.

법인카드 정산은 아래 순서로 진행하시면 됩니다.

1) 매월 5일에 카드사 홈페이지에서 전월 사용내역을 엑셀로 다운로드합니다.
2) 다운로드한 내역을 정산양식.xlsx에 붙여넣고 계정과목을 지정합니다.
3) 영수증이 누락된 건은 사용자에게 개별 요청 메일을 보내고 회신을 기다립니다. (보통 2~3일)
4) 전 건이 채워지면 그룹웨어에 지출결의서를 상신합니다.
5) 결재가 완료되면 더존 ERP에 전표를 입력하고 마감합니다.

감사합니다.

이지훈
총무팀 대리
(02) 1234-5678 | jhlee@example.co.kr

> -----Original Message-----
> 보낸사람: 최민경
> 총무팀 법인카드 정산 절차 좀 공유해주실 수 있을까요?
```

**기대 출력** (항목 7 · 버림 10 · 무손실 검증 통과)

```json
{
  "items": [
    {
      "id": "F3-01",
      "title": "매월 5일에 카드사 홈페이지에서 전월 사용내역을 엑셀로 다운로드합니다",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "법인카드 웹명세",
        "엑셀"
      ],
      "freqHint": "매월 5일",
      "sourceRange": [
        167,
        209
      ]
    },
    {
      "id": "F3-02",
      "title": "다운로드한 내역을 정산양식.xlsx에 붙여넣습니다",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "엑셀"
      ],
      "sourceRange": [
        210,
        238
      ]
    },
    {
      "id": "F3-03",
      "title": "계정과목을 지정합니다",
      "kind": "task",
      "depth": 0,
      "toolHints": [],
      "sourceRange": [
        239,
        251
      ]
    },
    {
      "id": "F3-04",
      "title": "영수증이 누락된 건은 사용자에게 개별 요청 메일을 보냅니다",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "사내 메일(IMAP)"
      ],
      "sourceRange": [
        252,
        286
      ]
    },
    {
      "id": "F3-05",
      "title": "회신을 기다립니다",
      "kind": "hold",
      "depth": 0,
      "waitFor": "reply",
      "toolHints": [],
      "durationHint": "2~3일",
      "sourceRange": [
        287,
        307
      ]
    },
    {
      "id": "F3-06",
      "title": "전 건이 채워지면 그룹웨어에 지출결의서를 상신합니다",
      "kind": "hold",
      "depth": 0,
      "waitFor": "approval",
      "toolHints": [
        "그룹웨어 전자결재"
      ],
      "sourceRange": [
        308,
        340
      ]
    },
    {
      "id": "F3-07",
      "title": "결재가 완료되면 더존 ERP에 전표를 입력하고 마감합니다",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "더존 ERP"
      ],
      "sourceRange": [
        341,
        376
      ]
    }
  ],
  "dropped": [
    {
      "range": [
        0,
        31
      ],
      "reason": "mail_header"
    },
    {
      "range": [
        32,
        60
      ],
      "reason": "mail_header"
    },
    {
      "range": [
        61,
        68
      ],
      "reason": "mail_header"
    },
    {
      "range": [
        69,
        99
      ],
      "reason": "mail_header"
    },
    {
      "range": [
        100,
        124
      ],
      "reason": "mail_header"
    },
    {
      "range": [
        126,
        137
      ],
      "reason": "greeting"
    },
    {
      "range": [
        139,
        165
      ],
      "reason": "lead_in"
    },
    {
      "range": [
        378,
        384
      ],
      "reason": "closing"
    },
    {
      "range": [
        386,
        433
      ],
      "reason": "signature"
    },
    {
      "range": [
        435,
        508
      ],
      "reason": "quoted"
    }
  ],
  "confidence": "high"
}
```

### F4 · 노션 체크박스 + 탭 들여쓰기

**입력** (`243자` · `sourceHint: 'notion'`)

```text
## 신입사원 온보딩 (인사팀)
- [ ] 입사 3일 전: 노트북·모니터 신청 (IT팀에 슬랙으로 요청)
- [ ] 입사 1일 전: 사원증 발급 신청 → 총무팀
- [x] 입사 당일 오전: 계정 생성 확인
\t- 그룹웨어, 슬랙, 구글 워크스페이스 3개
\t- 하나라도 안 되면 IT팀 담당자에게 바로 연락
- [ ] 입사 후 1주일 이내: 4대보험 취득신고 (반나절)
- [ ] 수습 3개월 종료 시점에 평가 요청 메일 발송하고 마무리
```

**기대 출력** (항목 7 · 버림 1 · 무손실 검증 통과)

```json
{
  "items": [
    {
      "id": "F4-01",
      "title": "입사 3일 전: 노트북·모니터 신청",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "슬랙"
      ],
      "assigneeHint": "IT팀",
      "sourceRange": [
        18,
        58
      ]
    },
    {
      "id": "F4-02",
      "title": "입사 1일 전: 사원증 발급 신청",
      "kind": "task",
      "depth": 0,
      "toolHints": [],
      "assigneeHint": "총무팀",
      "sourceRange": [
        59,
        89
      ]
    },
    {
      "id": "F4-03",
      "title": "입사 당일 오전: 계정 생성 확인",
      "kind": "task",
      "depth": 0,
      "toolHints": [],
      "sourceRange": [
        90,
        114
      ]
    },
    {
      "id": "F4-04",
      "title": "그룹웨어, 슬랙, 구글 워크스페이스 3개",
      "kind": "task",
      "depth": 1,
      "toolHints": [
        "슬랙",
        "지메일 / 구글 워크스페이스"
      ],
      "sourceRange": [
        116,
        140
      ]
    },
    {
      "id": "F4-05",
      "title": "하나라도 안 되면 IT팀 담당자에게 바로 연락",
      "kind": "branch",
      "depth": 1,
      "branchCondition": "하나라도 안 되면",
      "branchMode": "skip",
      "toolHints": [],
      "assigneeHint": "IT팀",
      "sourceRange": [
        142,
        169
      ]
    },
    {
      "id": "F4-06",
      "title": "입사 후 1주일 이내: 4대보험 취득신고",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "4대보험 정보연계센터"
      ],
      "durationHint": "반나절",
      "sourceRange": [
        170,
        204
      ]
    },
    {
      "id": "F4-07",
      "title": "수습 3개월 종료 시점에 평가 요청 메일 발송하고 마무리",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "사내 메일(IMAP)"
      ],
      "sourceRange": [
        205,
        242
      ]
    }
  ],
  "dropped": [
    {
      "range": [
        0,
        17
      ],
      "reason": "doc_title"
    }
  ],
  "confidence": "high",
  "docTitleHint": "신입사원 온보딩 (인사팀)"
}
```

### F5 · 회의록 (섹션 게이팅 + @담당자)

**입력** (`309자` · `sourceHint: 'minutes'`)

```text
[8/13(수) 재고관리 개선 정기회의]
참석: 물류팀 김철수, 구매팀 이영희, 전산팀 박민수
장소: 3층 회의실

■ 논의 내용
- 월말 재고실사 시 엑셀 대장과 ERP 수량 불일치가 반복됨
- 원인은 출고 후 ERP 반영이 하루 늦는 것으로 추정

■ 액션아이템
- @김철수 : 매월 말일 재고실사 결과를 엑셀 대장에 입력 (D+1까지)
- @이영희 : 불일치 건이 10건 이상이면 구매팀장 승인 받아 조정전표 등록, 10건 미만이면 자체 처리
- @박민수 : ERP 반영 지연 원인 확인 후 8/20까지 회신
- 다음 회의: 8/27(수) 15시
```

**기대 출력** (항목 7 · 버림 6 · 무손실 검증 통과)

```json
{
  "items": [
    {
      "id": "F5-01",
      "title": "매월 말일 재고실사 결과를 엑셀 대장에 입력",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "엑셀"
      ],
      "assigneeHint": "김철수",
      "freqHint": "매월 말일",
      "sourceRange": [
        149,
        190
      ]
    },
    {
      "id": "F5-02",
      "title": "불일치 건이 10건 이상이면",
      "kind": "branch",
      "depth": 0,
      "branchCondition": "불일치 건이 10건 이상",
      "branchMode": "xor",
      "toolHints": [],
      "assigneeHint": "이영희",
      "sourceRange": [
        191,
        215
      ]
    },
    {
      "id": "F5-03",
      "title": "구매팀장 승인 받아요",
      "kind": "hold",
      "depth": 1,
      "waitFor": "approval",
      "toolHints": [],
      "assigneeHint": "구매팀장",
      "sourceRange": [
        216,
        226
      ]
    },
    {
      "id": "F5-04",
      "title": "조정전표 등록",
      "kind": "task",
      "depth": 1,
      "toolHints": [],
      "sourceRange": [
        227,
        235
      ]
    },
    {
      "id": "F5-05",
      "title": "10건 미만이면 자체 처리",
      "kind": "task",
      "depth": 1,
      "toolHints": [],
      "sourceRange": [
        236,
        250
      ]
    },
    {
      "id": "F5-06",
      "title": "ERP 반영 지연 원인 확인",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "더존 ERP"
      ],
      "assigneeHint": "박민수",
      "sourceRange": [
        251,
        277
      ]
    },
    {
      "id": "F5-07",
      "title": "8/20까지 회신",
      "kind": "task",
      "depth": 0,
      "toolHints": [],
      "assigneeHint": "박민수",
      "sourceRange": [
        278,
        287
      ]
    }
  ],
  "dropped": [
    {
      "range": [
        0,
        22
      ],
      "reason": "doc_title"
    },
    {
      "range": [
        23,
        52
      ],
      "reason": "minutes_header"
    },
    {
      "range": [
        53,
        63
      ],
      "reason": "minutes_header"
    },
    {
      "range": [
        65,
        139
      ],
      "reason": "context_section"
    },
    {
      "range": [
        141,
        148
      ],
      "reason": "section_header"
    },
    {
      "range": [
        288,
        308
      ],
      "reason": "schedule"
    }
  ],
  "confidence": "mid"
}
```

### F6 · 한 문단 프로즈 (절 분할의 정본 케이스)

**입력** (`112자` · `sourceHint: 'prose'`)

```text
메일로 요청 받아서 엑셀에 정리하고 팀장님 컨펌 받고 ERP에 등록해요. 급한 건은 전화로 먼저 알려주고 나중에 메일로 정리해서 보내요. 한 건에 20분쯤 걸리는데 하루에 열 건 넘게 올 때도 있어요.
```

**기대 출력** (항목 7 · 버림 1 · 무손실 검증 통과)

```json
{
  "items": [
    {
      "id": "F6-01",
      "title": "메일로 요청 받아요",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "사내 메일(IMAP)"
      ],
      "sourceRange": [
        0,
        10
      ]
    },
    {
      "id": "F6-02",
      "title": "엑셀에 정리해요",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "엑셀"
      ],
      "sourceRange": [
        11,
        19
      ]
    },
    {
      "id": "F6-03",
      "title": "팀장님 컨펌 받아요",
      "kind": "hold",
      "depth": 0,
      "waitFor": "approval",
      "toolHints": [],
      "assigneeHint": "팀장",
      "sourceRange": [
        20,
        29
      ]
    },
    {
      "id": "F6-04",
      "title": "ERP에 등록해요",
      "kind": "task",
      "depth": 0,
      "toolHints": [
        "더존 ERP"
      ],
      "sourceRange": [
        30,
        40
      ]
    },
    {
      "id": "F6-05",
      "title": "급한 건은",
      "kind": "branch",
      "depth": 0,
      "branchCondition": "급한 건",
      "branchMode": "skip",
      "toolHints": [],
      "sourceRange": [
        41,
        46
      ]
    },
    {
      "id": "F6-06",
      "title": "전화로 먼저 알려줘요",
      "kind": "task",
      "depth": 1,
      "toolHints": [
        "전화"
      ],
      "sourceRange": [
        47,
        58
      ]
    },
    {
      "id": "F6-07",
      "title": "나중에 메일로 정리해서 보내요",
      "kind": "task",
      "depth": 1,
      "toolHints": [
        "사내 메일(IMAP)"
      ],
      "sourceRange": [
        59,
        76
      ]
    }
  ],
  "dropped": [
    {
      "range": [
        77,
        112
      ],
      "reason": "meta_stat"
    }
  ],
  "confidence": "mid",
  "docHints": {
    "durationHint": "20분",
    "freqHint": "하루 10건+"
  }
}
```

---

## 12. 성능

목표는 STATES.md §성능이 못 박았다 — **200줄 < 300ms 동기, 500줄+ 워커. 300ms를 넘는 순간 "붙여넣으면 바로 된다"는 마법이 깨진다.**
따라서 실제 예산은 300ms가 아니라 **60ms**로 잡는다. 남은 240ms는 React 렌더·레이아웃·ELK 초기 계산이 가져간다.

### 12.1 병목은 어디인가

프로파일 없이 예측만으로 최적화하면 안 되지만, **구조적으로 이차식이 되는 지점 세 곳**은 설계 단계에서 이미 보인다.

#### 병목 1 — 절 분할 채점의 반복 스캔 (가장 크다, O(n²))

§3.6의 `scoreClauseSplits`는 후보마다 `ctx.tools.scan(left)`와 `ctx.tools.scan(right)`를 부른다. 문단 길이 `n`, 후보 `k`개면 **O(n·k)**다. 프로즈 붙여넣기에서 `k`가 수십이 되면 그대로 터진다.

**해법: 단위마다 한 번만 스캔하고, 이후엔 이분 탐색으로 답한다.**

```ts
/** 단위(문장/발화) 진입 시 1회 스캔 → 정렬된 히트 배열 */
class HitIndex<T extends { span: Span }> {
  constructor(private hits: T[]) {}                    // span[0] 오름차순
  lastBefore(i: number): T | undefined { return this.hits[upperBound(this.hits, i) - 1]; }
  firstAfter(i: number): T | undefined { return this.hits[lowerBound(this.hits, i)]; }
}

// 채점부는 이렇게 바뀐다 — 문자열 슬라이스도 사라진다
const lTool = ctx.toolIdx.lastBefore(end);
const rTool = ctx.toolIdx.firstAfter(end);
if (lTool && rTool && lTool.id !== rTool.id) s += 0.25;
```

`text.slice(0, end)` / `text.slice(end)` 호출도 함께 사라진다. **후보마다 문자열 두 개를 새로 만들던 것이 인덱스 비교 두 번이 된다.** 이 하나가 프로즈 입력에서 가장 큰 절감이다.

#### 병목 2 — 사전 정규식·트라이의 재구축

```ts
// ✗ 나쁨: 호출마다 정규식/트라이를 다시 만든다
function scan(t: string) { const re = new RegExp(ALIASES.join('|'), 'g'); ... }

// ✓ 모듈 스코프 + 지연 초기화 + 메모이즈
let TOOL_TRIE: Trie | null = null;
export const toolTrie = () => (TOOL_TRIE ??= buildTrie(TOOL_ALIASES));   // 약 200 별칭, 1회 <1ms
```

빌드타임에 TOOLS.md → `tools.generated.ts`로 뽑아 놓는다. **런타임에 마크다운을 파싱하지 않는다.**

#### 병목 3 — `/g` 정규식의 `lastIndex` 공유

모듈 스코프 `/g` 정규식을 여러 곳에서 쓰면 `lastIndex`가 남아 **결과가 틀리고**(성능보다 이게 더 무섭다) 재시도 비용도 생긴다.

```
규칙 1. 모듈 스코프 정규식은 /g 를 붙이지 않는다. 반복이 필요하면 호출부에서 매번 리터럴을 쓰거나 String.matchAll 을 쓴다.
규칙 2. /g 가 불가피하면 진입 시 re.lastIndex = 0 을 명시한다 (§3.6 코드 참조).
규칙 3. .* / .+ / 중첩 수량자 / (a+)+ 금지. 모든 패턴은 ^ 앵커 또는 고정 길이 문자 클래스로 시작한다. → ReDoS 차단
```

### 12.2 그 밖의 절감

| 항목 | 조치 |
|---|---|
| 전처리 NFC | fast path로 배열 할당 자체를 건너뛴다 (§1.1). 입력의 99%가 여기로 빠진다 |
| 문자열 슬라이스 | 파이프라인 전체가 `Span`으로 흐른다. `slice`는 S9 제목 생성에서 **항목당 1회**만 |
| `Line[]` 할당 | 2,000줄 상한이므로 객체 2,000개. GC 부담 없음 |
| 노이즈 감지기 17개 | 전부 **줄 단위 단일 패스** 안에서 돈다. 문서를 17번 훑지 않는다 |
| `levenshteinCapped` | 상한 8로 잘라 O(n·8). 제목당 <10µs |
| `assertLossless` | 정렬 O(m log m) + 스캔 O(N). 20KB에서 1ms 미만 |

### 12.3 예산 배분 (200줄 / 12KB 기준 목표)

```
S1 전처리          2ms     S6 타입 분류       8ms
S2 소스 감지       3ms     S7 계층 추정       2ms
S3 라인 분할       4ms     S8 메타 힌트      12ms   ← 트라이 스캔
S4 노이즈          6ms     S9 후처리          5ms
S5 경계 판정      15ms     assertLossless     1ms
                                    ───────────────
                                    합계  ≈ 58ms
```

### 12.4 워커

```ts
// packages/paste-parse 는 DOM·React 무의존이므로 그대로 워커에 올라간다
const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
```

- **워밍**: 붙여넣기 textarea에 **포커스가 들어오는 순간** 워커를 생성한다. 워커 부팅(~10~30ms)이 붙여넣기 이후 지연에 포함되지 않는다.
- **왕복 1회**: `postMessage(text)` → `postMessage(result)`. Comlink를 쓰지 않는다(래핑 오버헤드 > 이득).
- **200줄 미만은 워커를 쓰지 않는다**: 부팅 + 구조화 복제 비용이 파싱보다 크다.
- **내부 시간 예산**: 워커 안에서 `TIME_BUDGET_MS = 800`을 넘기면 그 시점까지의 항목 + 나머지 `unparsedTail`로 **부분 성공**을 반환한다 (§10.2). 사용자가 무한정 기다리는 상태를 만들지 않는다.
- **취소**: 사용자가 붙여넣기를 다시 하면 이전 워커 결과를 버린다(`requestId` 대조). `terminate()`는 재부팅 비용 때문에 쓰지 않는다.

### 12.5 측정

MEASUREMENT.md의 `paste_parsed.parse_ms`를 그대로 쓴다. 추가로 세 개를 붙인다.

```ts
mark('paste_parsed', {
  parse_ms, char_len_band, line_count_band, source_hint, confidence_bucket,
  rule_hits: { newline, numbering, verb },      // ★ MEASUREMENT.md 계약 그대로
  // 추가
  rule_version: RULE_VERSION,                   // §13 A/B 비교의 축
  clause_ratio,                                 // 추론 의존도 — 규칙 개선의 1순위 지표
  demoted_ratio,                                // 과잉 제거 감시 (§8.6)
});
```

경보 임계(MEASUREMENT.md §품질과 정합): `parse_ms` p95 > 300ms **또는** `clause_ratio` p50 > 0.5 → P1.

---

## 13. 나중에 AI를 붙일 때

### 13.1 지금 그어두면 나중이 싸지는 경계선 3개

파서를 **하나의 함수**로 짜면 LLM 도입 시 전부 다시 쓴다. 지금 **세 개의 인터페이스**로 쪼개 두면 구현체 교체가 파일 하나다.

```ts
// packages/paste-parse/src/contracts.ts  ★ 이 파일이 AI 이식의 전부다

export interface Segmenter {
  readonly id: string;                 // 'rules@3' | 'llm@claude-1' | 'hybrid@1'
  segment(input: SegmentInput): Promise<Boundary[]> | Boundary[];
}
export type SegmentInput = {
  text: string;                        // 정규화된 work 문자열
  lines: readonly Line[];
  detection: Detection;
  restrictTo?: readonly Span[];        // ★ 이 구간만 다시 판단하라 (하이브리드의 핵심)
};
export type Boundary = {
  at: number;                          // work 좌표
  confidence: number;                  // 0..1
  by: string;                          // 규칙 ID 또는 'llm'
};

export interface Classifier {
  readonly id: string;
  classify(input: ClassifyInput): Promise<Verdict[]> | Verdict[];
}

export interface HintExtractor {
  readonly id: string;
  extract(input: HintInput): Hints;    // 도구·담당자·소요시간·빈도
}

export type ParsePipeline = {
  segmenter: Segmenter;
  classifier: Classifier;
  hints: HintExtractor;
  lexicon: Lexicon;                    // ★ 사전은 코드가 아니라 주입되는 데이터
};
```

**동기/비동기 양립(`Promise<T> | T`)이 의도적이다.** 규칙 구현체는 동기라서 200줄 미만에서 `await` 없이 즉시 렌더된다. 인터페이스에 `Promise`만 두면 지금 당장 300ms 예산이 마이크로태스크 한 틱만큼 손해를 본다.

**사전을 `Lexicon` 객체로 주입하는 것**이 두 번째 경계선이다. §4·§7의 모든 배열/정규식은 코드에 하드코딩되지 않고 `lexicon.verbs`, `lexicon.tools`, `lexicon.hold` 로 들어온다. 그러면
(a) 조직별 사전 오버라이드(더존 쓰는 회사 vs SAP 쓰는 회사)가 가능해지고,
(b) TOOLS.md §운영규칙 2의 **미매칭 상위 20건 큐**를 LLM이 자동 분류해 사전에 밀어 넣을 수 있고,
(c) 사전 변경이 코드 배포 없이 나간다.

### 13.2 규칙과 LLM을 경쟁시키지 않는다 — 규칙이 먼저, LLM은 저신뢰 구간만

```ts
export class HybridSegmenter implements Segmenter {
  readonly id = 'hybrid@1';
  constructor(
    private rules: Segmenter,
    private llm: Segmenter,
    private opt = { threshold: 0.6, maxRegions: 8, maxChars: 1_500, timeoutMs: 1_200 },
  ) {}

  async segment(input: SegmentInput): Promise<Boundary[]> {
    const base = await this.rules.segment(input);          // ① 규칙이 먼저 — 항상 결과가 있다

    // ② 저신뢰 구간만 골라낸다
    const weak = weakRegions(base, input, this.opt.threshold);
    if (!weak.length) return base;                          // 대부분의 문서가 여기서 끝난다

    const regions = mergeAdjacent(weak)
      .sort((a, b) => spanLen(b) - spanLen(a))
      .slice(0, this.opt.maxRegions)
      .filter(r => spanLen(r) <= this.opt.maxChars);

    // ③ 그 구간만 LLM에 보낸다 (전문을 보내지 않는다)
    let patch: Boundary[];
    try {
      patch = await withTimeout(this.llm.segment({ ...input, restrictTo: regions }), this.opt.timeoutMs);
    } catch { return base; }                                // ④ 실패·타임아웃 → 규칙 결과 그대로

    // ⑤ 검증을 통과한 패치만 병합
    const valid = patch.filter(b => isInside(b.at, regions) && Number.isInteger(b.at) && b.at > 0 && b.at < input.text.length);
    if (valid.length !== patch.length) report('llm_boundary_out_of_range', patch.length - valid.length);

    return reconcile(base, valid, regions);                 // 구간 안에서는 LLM, 밖에서는 규칙
  }
}
```

**협업 구조가 주는 것**

| | |
|---|---|
| 지연 | 규칙 결과가 먼저 그려지고(≤60ms) LLM 패치는 **나중에 도착해 부분 갱신**한다. 300ms 예산이 깨지지 않는다 |
| 비용 | 전문이 아니라 저신뢰 구간(보통 원문의 10~20%)만 토큰이 된다 |
| 프라이버시 | TRUST.md의 원칙과 정합 — **문서 전문이 외부 모델로 나가지 않는다.** 나가는 것은 규칙이 못 읽은 몇 줄뿐이고, 조직 설정으로 완전 비활성이 가능하다 |
| 안전성 | LLM이 죽어도 제품은 **오늘과 똑같이** 동작한다. 규칙이 기저선이지 폴백이 아니다 |
| 되돌리기 | 피처 플래그 하나 (`pipeline: 'rules' \| 'hybrid'`) |

### 13.3 LLM 계약 — 텍스트를 생성시키지 않는다

이게 무손실 원칙을 LLM 시대까지 끌고 가는 방법이다.

```ts
/** LLM이 반환할 수 있는 것의 전부 */
type LlmSegmentResponse = {
  splits: number[];                                   // 원문 인덱스만. 문자열 없음
};
type LlmClassifyResponse = {
  verdicts: { index: number; kind: ItemKind; branchMode?: BranchMode; waitFor?: WaitFor;
              conditionSpan?: Span }[];               // 조건도 "스팬"으로 받는다. 문장을 쓰게 하지 않는다
};
```

```
계약 1. LLM은 인덱스만 반환한다. 제목·조건·요약을 문자열로 생성하지 않는다.
계약 2. 반환 인덱스는 restrictTo 구간 안이어야 한다. 밖이면 그 항목만 버린다.
계약 3. 결과는 §10.4 assertLossless 를 그대로 통과해야 한다. title_drift 검사가
        "LLM이 원문에 없는 제목을 만들어냈다"를 자동으로 잡는다. ★ 규칙용으로 만든 검사가
        그대로 환각 방어 장치가 된다.
계약 4. 타임아웃 1.2초. 초과 시 조용히 규칙 결과.
계약 5. 캐시 키 = sha256(정규화 텍스트) + ruleVersion + promptVersion.
```

### 13.4 지금 당장 해둬야 나중에 싸지는 것 (되돌리기 비싼 순)

1. **`ParseResult.ruleVersion` / `pipelineId` 를 지금부터 기록한다.** 없으면 나중에 "LLM이 실제로 나아졌나"를 물을 때 비교군이 없다. MEASUREMENT.md의 `paste_result_edited.edit_distance_band`를 **버전별로** 쪼갤 수 있어야 한다.
2. **`Boundary.confidence`를 지금부터 채운다.** 규칙만 쓸 때는 UI 점선(§9.2)에만 쓰이지만, 이게 없으면 §13.2의 "저신뢰 구간"을 나중에 정의할 수 없다. **사후에 소급 계산할 수 없는 유일한 값이다.**
3. **골든 픽스처를 eval set으로 겸용한다.** §11의 6개가 시드고, 파일럿에서 나온 실제 붙여넣기 중 `edit_distance > 60%`인 것을 익명화해 픽스처로 승격한다. 규칙과 LLM이 **같은 세트**로 채점된다.
4. **섀도 모드를 먼저 켠다.** LLM 결과를 저장만 하고 화면에 쓰지 않는다. 규칙 대비 `edit_distance`가 낮아지는 게 확인된 뒤에 노출한다. 첫 노출 대상은 `confidence: 'low'` 문서만.
5. **사전을 데이터로 분리한다** (§13.1). 지금 코드에 박아 넣으면 조직별 오버라이드와 자동 사전 확장이 둘 다 막힌다.

### 13.5 LLM이 규칙보다 확실히 나은 지점 (우선순위)

규칙을 더 붙일지 LLM을 부를지 판단하는 기준 — **"패턴이 유한한가"**다.

| 문제 | 규칙으로 되나 | 판단 |
|---|---|---|
| 마커·표·헤더·서명 | 된다 | **규칙 유지.** LLM을 부르는 건 낭비 |
| 도구·담당자·소요시간·빈도 | 된다 (사전) | **규칙 유지** + 미매칭 큐만 LLM이 분류 |
| 절 분할 (§3.6) | 70~80%까지 | **하이브리드 1순위.** 도구 전환 같은 대리 증거로는 못 잡는 의미 경계가 남는다 |
| 부정 스코프 (`"엑셀 안 쓰고"`) | 안 된다 | **LLM 2순위** |
| 대명사 해소 (`"그거 받으면"`의 그거) | 안 된다 | **LLM 3순위** — 해소되면 계층 추정이 크게 좋아진다 |
| 암묵적 순서 (시간 표현 없이 순서가 뒤섞인 카톡) | 안 된다 | **LLM 4순위** |
| 문서 전체 요약·제목 생성 | — | **하지 않는다.** 원문 보존 원칙과 충돌 |

---

## 부록 A. 스키마 — 원안 대비 추가분

원안 `ParseResult` / `ParsedItem`에 다음을 더한다. 전부 **추가만** 하며 기존 필드의 의미를 바꾸지 않는다.

```ts
export type ParseResult = {
  items: ParsedItem[];
  confidence: 'low' | 'mid' | 'high';
  ruleHits: RuleHits;
  unparsedTail?: string;

  // ── 추가 ────────────────────────────────────────────────
  unparsedTailRange?: Span;      // 무손실 검증에 필수 (문자열만으로는 위치를 모른다)
  dropped: Dropped[];            // 단계로 만들지 않은 구간. 삭제가 아니라 보류 (§8.1)
  docTitleHint?: string;         // 첫 heading/괄호 제목 → 문서 제목 후보
  docHints?: { durationHint?: string; freqHint?: string };  // 흐름 전체에 걸린 메타 (§F6)
  failure?: { reason: FailureReason; at?: number };
  sourceHint: SourceHint;        // 텔레메트리 계약 (MEASUREMENT.md paste_attempted)
  traits: Trait[];
  ruleVersion: string;           // §13.4 (1)
  pipelineId: string;            // 'rules@3' | 'hybrid@1'
  confidenceReasons: string[];   // §9.1 — 왜 낮았는가
  unmatchedToolCandidates: string[];   // TOOLS.md 카탈로그 확장 큐 (§7.1)
};

export type ParsedItem = {
  id: string; title: string; kind: 'task' | 'branch' | 'hold';
  depth: number; branchCondition?: string;
  waitFor?: 'approval' | 'reply' | 'time' | 'resource';
  toolHints: string[]; assigneeHint?: string; durationHint?: string;
  sourceRange: Span;

  // ── 추가 ────────────────────────────────────────────────
  parentId?: string;             // depth만으로는 형제/자식 관계가 유일하게 복원되지 않는다
  branchMode?: 'xor' | 'and' | 'skip';   // PRD §4.3 items.attrs.mode 로 매핑
  freqHint?: string;             // "매주 화요일" — freqLast7d 로는 담기지 않는 원문 (§7.4)
  boundaryConfidence: number;    // 이 항목의 시작 경계 신뢰도 (§9.2 점선 · §13.4 (2))
  boundaryBy: string;            // 'R1.decimalDot' | 'R7.go' — 규칙 ID (부록 B)
  classifyRule: string;          // 'G1.alt' | 'G2.submit' | 'default'
  holdSuspect?: boolean;         // 부속절에만 대기 어휘가 있음 → 질문 연쇄가 회수 (§5.3)
  isTerminal?: boolean;          // 종결 어휘 감지 → 그래프 end 노드 연결 힌트 (§4.4)
};
```

| 추가 필드 | 없으면 무슨 일이 생기나 |
|---|---|
| `dropped` | 무손실 증명이 불가능하다. "지운 게 아니라 보류했다"는 UI도 못 만든다 |
| `unparsedTailRange` | `assertLossless`가 꼬리를 검증할 수 없다 |
| `parentId` | 카톡처럼 들여쓰기가 없는 입력에서 `depth`만으로는 트리가 유일하지 않다 |
| `branchMode` | `xor`로 단정하면 사용자가 빈 갈래를 마주한다 (§5.1) |
| `boundaryConfidence` | §9.2 점선 UI 불가 + §13.2 하이브리드의 저신뢰 구간 정의 불가. **소급 계산 불가** |
| `ruleVersion` / `pipelineId` | 규칙 개선·LLM 도입의 효과를 측정할 비교군이 없다 |

## 부록 B. 규칙 ID 표 (텔레메트리 · 디버깅 축)

`ruleHits`는 MEASUREMENT.md 계약(`{newline, numbering, verb}`)을 상위 집계로 유지하고, 내부에 세부 카운터를 둔다.

```ts
export type RuleHits = {
  // ★ MEASUREMENT.md 계약 — 이벤트로 나가는 3개
  newline: number;      // R4 + R5 로 만들어진 경계 수
  numbering: number;    // R1 + R2
  verb: number;         // R6 + R7 (동사·어미 패턴)
  // 내부 세부 (이벤트로 나가지 않음)
  detail: Partial<Record<RuleId, number>>;
};
```

| RuleId | 위치 | 하는 일 |
|---|---|---|
| `R1.*` | §3.4 | 마커 경계 (`R1.decimalDot`, `R1.checkbox`, `R1.hangulOrder` …) |
| `R1.demoted` | §3.2 | 시퀀스 검증 실패로 강등된 가짜 마커 수 — **오탐 감시의 핵심 지표** |
| `R2.tableRow` | §3.5 | 표 행 경계 |
| `R3.utterance` / `R3.merged` | §3.4 | 발화 경계 / 같은 화자 연속 병합 |
| `R4.blankBlock` | §3.4 | 빈 줄 블록 |
| `R5.line` / `R5.rejoined` | §3.3 | 줄 경계 / 워드랩 재결합 |
| `R6.sentence` | §3.4 | 문장 경계 |
| `R7.go` `R7.seo` `R7.seqA` `R7.seqB` `R7.cond` `R7.imm` | §3.6 | 절 분할 (어미별) |
| `R7.gated.*` | §3.6 | 게이트로 **탈락**한 후보 수 (`nounGo`, `quote`, `aux`, `prep`, `short`) |
| `G1.*` `G2.*` | §5.2 | 타입 분류 발화 규칙 |
| `N.*` | §8.2 | 노이즈 감지기별 제거 문자 수 |
| `P4.absorbed` `P5.merged` `P7.clamped` | §1.2 | 후처리 정리 횟수 |

`R1.demoted`와 `R7.gated.*`가 특히 중요하다. **"몇 번 잡았나"보다 "몇 번 참았나"가 미분할 편향이 제대로 작동하는지 알려준다.**

## 부록 C. 의도적으로 열어둔 문제

| # | 문제 | 지금의 처리 | 열 조건 |
|---|---|---|---|
| 1 | 부정 스코프 (`"엑셀 안 쓰고"`) | 무시. 배지 삭제 1클릭 | LLM 도입 시 §13.5 2순위 |
| 2 | 대명사 (`"그거 받으면"`) | 수령형 조건으로 흡수만 | LLM 3순위 |
| 3 | 표 안의 병합 셀 | 열 수 불일치 행은 R2를 포기하고 R5로 폴백 | 표 붙여넣기 비중이 15% 넘으면 |
| 4 | HTML 붙여넣기(`text/html` 클립보드) | 무시하고 `text/plain`만 읽는다 | 노션·구글독스 사용자 비중이 높으면. **HTML을 읽으면 계층이 공짜로 나온다 — 가장 저렴한 다음 개선** |
| 5 | 문체 통일 | 하지 않는다 (§4.5) | 사용자가 요구하면. 기본값은 계속 "안 함" |
| 6 | 중첩 분기(분기 안의 분기) | `MAX_DEPTH=2`로 클램프 | 그림 접기(collapse)가 들어간 뒤 |
| 7 | 이미지·표 캡처 붙여넣기 | 범위 밖 | OCR 도입 시 |

**4번은 지금 당장 다시 볼 가치가 있다.** 노션·구글독스·워드에서 복사하면 클립보드에 `text/html`이 함께 실려 오고, 거기엔 `<ol>`·`<ul>`·`<li>`·들여쓰기가 이미 구조로 들어 있다. §3·§6이 정규식으로 복원하려는 정보의 상당 부분이 **공짜로 주어진다.** 다만 `text/plain` 경로는 카톡·메일·PPT 때문에 어차피 필요하므로, HTML 경로는 **`Line[]`을 만드는 대체 프론트엔드**로 붙이면 된다 — S3 이후 파이프라인은 그대로 재사용된다. 이 문서의 파이프라인이 S3에서 `Line[]`으로 한 번 좁아지는 이유가 그것이다.
