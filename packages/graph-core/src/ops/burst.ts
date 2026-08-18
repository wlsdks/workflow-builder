/**
 * packages/graph-core/src/ops/burst.ts
 *
 * SYNC.md §1.2 / D-109 — `set_title`은 글자마다가 아니라 **타이핑 버스트 단위**로 만든다.
 *
 * 이 파일은 **경계 판정만** 한다. 실제 타이머·이벤트 리스너·큐 적재는 런타임
 * (`packages/sync-client`)의 일이다. 순수하게 떼어 두는 이유:
 *   - 한국어 IME 회귀 테스트를 브라우저 없이 돌릴 수 있어야 한다
 *   - 서버 재생·시뮬레이션이 같은 판정을 써야 한다
 *   - graph-core는 시계를 만들지 않는다 (결정성 계약) — `idleMs`는 **입력**이다
 *
 * 근거 4개 (§1.2):
 *   1. 조합 중(`composing`) op을 만들면 `ㅎ`·`하`·`한`이 각각 op이 되어
 *      초성만 담긴 op이 서버 로그에 영구히 남는다
 *   2. 200자 = 200 op × 200바이트 = 40KB. 버스트 단위면 문장당 1~3개, 200배 절감
 *   3. op 로그의 소비자가 사람이다 (감사·"무엇이 달라졌는지 보기"·AI diff 검토)
 *   4. char 단위 병합은 어차피 set_title이 못 한다 — 3-way merge(§2.5)가 200배 싸다
 */

import type { Op } from './types.ts';
import { isStructuralOp } from './types.ts';

/** 800ms 디바운스보다 짧아야 한다 — 큐가 op을 기다리게 하면 안 된다 */
export const TITLE_IDLE_MS = 500;

export type BurstEnd =
  | 'idle' // 500ms 무입력
  | 'composition' // compositionend — IME 조합이 끝난 경계는 항상 안전한 커밋 지점
  | 'blur' // 포커스 이탈
  | 'structural' // 구조 op이 뒤따름 → 반드시 구조 op보다 먼저 큐에 넣는다
  | 'boundary' // 공백·문장부호 입력 후 (undo 라벨을 자연스럽게 만든다)
  | 'flush'; // visibilitychange / 탭 핸드오버 / 수동 저장

export type BurstSignal =
  | {
      kind: 'input';
      /** 마지막 입력 이후 경과 ms. 런타임이 주입한다 */
      idleMs: number;
      /** IME 조합 중인가. **조합 중에는 어떤 경계도 만들지 않는다** */
      composing: boolean;
      /** 방금 들어온 문자(마지막 1자). 없으면 '' */
      lastChar: string;
    }
  | { kind: 'compositionend' }
  | { kind: 'blur' }
  | { kind: 'structural'; op: Op }
  | { kind: 'flush' };

/**
 * 문장 경계로 취급하는 문자.
 * 한국어 본문에서 실제로 쓰이는 것만 넣는다 — 너무 넓으면 버스트가 잘게 쪼개진다.
 */
const BOUNDARY_CHARS = new Set([' ', '\t', '.', ',', '?', '!', ';', ':', '·', '、', '。', '，', '？']);

/**
 * 이 신호가 열린 버스트를 닫는가. 닫지 않으면 null.
 *
 * **조합 중(`composing`)에는 무엇도 닫지 않는다.** ARCHITECTURE §3의
 * "조합 중 아무것도 트리거하지 않는다"와 op 생성은 같은 게이트를 써야 한다.
 */
export function burstEnd(signal: BurstSignal): BurstEnd | null {
  switch (signal.kind) {
    case 'compositionend':
      return 'composition';
    case 'blur':
      return 'blur';
    case 'flush':
      return 'flush';
    case 'structural':
      // 어떤 구조 op이든 큐에 넣기 전에 열린 버스트를 먼저 닫는다.
      // 이게 없으면 두 op의 순서가 뒤바뀌어 **직전에 친 글자가 새 줄에 딸려간다**
      return isStructuralOp(signal.op) ? 'structural' : null;
    case 'input': {
      if (signal.composing) return null;
      if (signal.idleMs >= TITLE_IDLE_MS) return 'idle';
      if (signal.lastChar !== '' && BOUNDARY_CHARS.has(signal.lastChar)) return 'boundary';
      return null;
    }
  }
}

/**
 * 버스트가 닫힐 때 만들 op. 값이 그대로면 op을 만들지 않는다(null).
 * `from`은 **버스트가 열릴 때 화면에 있던 값**이어야 한다 (D-110).
 */
export function titleBurstOp(itemId: string, from: string, to: string): Op | null {
  if (from === to) return null;
  return { type: 'set_title', id: itemId, from, to };
}
