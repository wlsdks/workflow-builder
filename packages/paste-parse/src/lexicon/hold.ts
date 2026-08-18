/**
 * packages/paste-parse/src/lexicon/hold.ts  (PARSING §4.3)
 *
 * `waitFor` 우선순위: approval > resource > reply > time.
 * `time`이 마지막인 이유 — `까지`는 대기 신호이기도 하지만 **마감이 있는 작업**이기도 하다.
 * `8/20까지 회신`은 task고, `8/20까지 기다린다`는 hold다. §5.2의 주 서술어 규칙이 이걸 가른다.
 */

import type { WaitFor } from '../types.ts';

export const HOLD = {
  /** 대기 동사 — 주 서술어일 때만 hold로 인정 (§5.2) */
  verb: /(?:기다리|대기|보류|홀드|계류|묵히|멈추|중단하|지켜보)(?:다|고|는|며|면서|면|자|기|ㅁ|어요|습니다|세요|시|겠|립니다|려요)/,

  /** 수동 수신 표현 */
  passive: /(?:올\s?때까지|올\s?때|올\s?것|도착할\s?때까지|받을\s?때까지|나올\s?때까지|될\s?때까지|나면|떨어지면)/,

  target: {
    approval:
      /(?:결재|전자결재|상신|기안|품의|승인|재가|전결|컨펌|confirm|사인|서명|결재선|결재\s?올리|올려|사장님\s?보고|윗선)/,
    reply: /(?:회신|답변|답장|응답|리플|피드백|연락(?:을)?\s?기다|답\s?오|답이\s?오|확인\s?회신)/,
    time: /(?:까지|마감|기한|월말|말일|월초|익일|다음\s?영업일|영업일|정시|매달\s?\d{1,2}일|D\+\d|\d{1,2}시(?:까지)?)/,
    resource:
      /(?:입고|도착|배송|자료(?:가)?\s?와|파일(?:이)?\s?오|발행(?:되면|될)|세금계산서|원본|서류(?:가)?\s?오|재고(?:가)?\s?들어)/,
  },

  /** ★ hold가 아닌 것 — 내가 하는 행위 */
  activeNotHold:
    /(?:회신(?:합니다|해요|한다|하기|할\s?것|드립니다)|답변(?:합니다|해요|한다)|보고(?:합니다|해요|한다)|올립니다|제출(?:합니다|해요))\s*$/,
} as const;

/** approval > resource > reply > time — 순서가 곧 우선순위다 */
export function pickWaitTarget(t: string): WaitFor | null {
  if (HOLD.target.approval.test(t)) return 'approval';
  if (HOLD.target.resource.test(t)) return 'resource';
  if (HOLD.target.reply.test(t)) return 'reply';
  if (HOLD.target.time.test(t)) return 'time';
  return null;
}
