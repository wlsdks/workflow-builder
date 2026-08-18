/**
 * packages/paste-parse/src/lexicon/endings.ts  (PARSING §4.6)
 *
 * **표에 없으면 원문을 그대로 둔다. 추측하지 않는다.**
 *
 * 문체는 통일하지 않는다(§4.5). 바꾸는 것은 딱 하나 —
 * **절 분할로 잘려서 연결어미로 끝나버린 제목**뿐이고, 그것도 문서의 지배 문체로만 맞춘다.
 */

import type { Style } from './verbs.ts';

export const ENDING_FIX: readonly [RegExp, Record<Style, string>][] = [
  // ── 청유·의뢰형 꼬리 (카톡·메일 실무에서 압도적으로 흔하다) ──────────────
  //   "눌러주시면 돼요" → "눌러요" / "올려주시면 끝이에요" → "올려요"
  //   길이가 긴 패턴이 먼저 와야 짧은 패턴에 먹히지 않는다.
  [/주시면\s*(?:돼요|됩니다|된다|끝이에요|끝입니다|끝)$/, { haeyo: '요', hamnida: '습니다', plain: '는다', noun: '기' }],
  [/하시면\s*(?:돼요|됩니다|된다|끝이에요|끝입니다|끝)$/, { haeyo: '해요', hamnida: '합니다', plain: '한다', noun: '하기' }],
  [/해\s?주세요$|해\s?주시겠어요$/, { haeyo: '해요', hamnida: '합니다', plain: '한다', noun: '하기' }],
  [/주세요$|주시겠어요$/, { haeyo: '요', hamnida: '습니다', plain: '는다', noun: '기' }],

  // ── 명사+하/되 (압도적 다수) ──────────────────────────────────────────────
  [/하고$/, { haeyo: '해요', hamnida: '합니다', plain: '한다', noun: '하기' }],
  [/하여$|해서$/, { haeyo: '해요', hamnida: '합니다', plain: '한다', noun: '하기' }],
  [/하며$|하면서$/, { haeyo: '해요', hamnida: '합니다', plain: '한다', noun: '하기' }],
  [/한\s*(?:뒤|후|다음)에?$/, { haeyo: '해요', hamnida: '합니다', plain: '한다', noun: '하기' }],
  [/되고$|되어$|돼서$/, { haeyo: '돼요', hamnida: '됩니다', plain: '된다', noun: '되기' }],

  // ── 빈출 불규칙 — 개별 등재 (규칙 활용보다 먼저 봐야 한다) ─────────────────
  [/^(.*)받고$/, { haeyo: '$1받아요', hamnida: '$1받습니다', plain: '$1받는다', noun: '$1받기' }],
  [/^(.*)받아$/, { haeyo: '$1받아요', hamnida: '$1받습니다', plain: '$1받는다', noun: '$1받기' }],
  [/^(.*)보내고$/, { haeyo: '$1보내요', hamnida: '$1보냅니다', plain: '$1보낸다', noun: '$1보내기' }],
  [/^(.*)붙여넣고$/, { haeyo: '$1붙여넣어요', hamnida: '$1붙여넣습니다', plain: '$1붙여넣는다', noun: '$1붙여넣기' }],
  [/^(.*)넣고$/, { haeyo: '$1넣어요', hamnida: '$1넣습니다', plain: '$1넣는다', noun: '$1넣기' }],
  [/^(.*)올리고$/, { haeyo: '$1올려요', hamnida: '$1올립니다', plain: '$1올린다', noun: '$1올리기' }],
  [/^(.*)내리고$/, { haeyo: '$1내려요', hamnida: '$1내립니다', plain: '$1내린다', noun: '$1내리기' }],
  [/^(.*)적고$/, { haeyo: '$1적어요', hamnida: '$1적습니다', plain: '$1적는다', noun: '$1적기' }],
  [/^(.*)쓰고$/, { haeyo: '$1써요', hamnida: '$1씁니다', plain: '$1쓴다', noun: '$1쓰기' }],
  [/^(.*)주고$/, { haeyo: '$1줘요', hamnida: '$1줍니다', plain: '$1준다', noun: '$1주기' }],
  [/^(.*)만들고$/, { haeyo: '$1만들어요', hamnida: '$1만듭니다', plain: '$1만든다', noun: '$1만들기' }],
  [/^(.*)열고$/, { haeyo: '$1열어요', hamnida: '$1엽니다', plain: '$1연다', noun: '$1열기' }],
  [/^(.*)닫고$/, { haeyo: '$1닫아요', hamnida: '$1닫습니다', plain: '$1닫는다', noun: '$1닫기' }],
  [/^(.*)찍고$/, { haeyo: '$1찍어요', hamnida: '$1찍습니다', plain: '$1찍는다', noun: '$1찍기' }],
  [/^(.*)누르고$/, { haeyo: '$1눌러요', hamnida: '$1누릅니다', plain: '$1누른다', noun: '$1누르기' }],
  [/^(.*)뽑고$/, { haeyo: '$1뽑아요', hamnida: '$1뽑습니다', plain: '$1뽑는다', noun: '$1뽑기' }],
  [/^(.*)나누고$/, { haeyo: '$1나눠요', hamnida: '$1나눕니다', plain: '$1나눈다', noun: '$1나누기' }],
  [/^(.*)합치고$/, { haeyo: '$1합쳐요', hamnida: '$1합칩니다', plain: '$1합친다', noun: '$1합치기' }],
  [/^(.*)알리고$/, { haeyo: '$1알려요', hamnida: '$1알립니다', plain: '$1알린다', noun: '$1알리기' }],
  [/^(.*)옮기고$/, { haeyo: '$1옮겨요', hamnida: '$1옮깁니다', plain: '$1옮긴다', noun: '$1옮기기' }],
  [/^(.*)바꾸고$/, { haeyo: '$1바꿔요', hamnida: '$1바꿉니다', plain: '$1바꾼다', noun: '$1바꾸기' }],
  [/^(.*)찾고$/, { haeyo: '$1찾아요', hamnida: '$1찾습니다', plain: '$1찾는다', noun: '$1찾기' }],
  [/^(.*)끝내고$/, { haeyo: '$1끝내요', hamnida: '$1끝냅니다', plain: '$1끝낸다', noun: '$1끝내기' }],

  // ── 규칙 활용 (어간 + 아/어 계열) — 접미만 갈아끼우면 맞는다 ───────────────
  [/아서$/, { haeyo: '아요', hamnida: '습니다', plain: '는다', noun: '기' }],
  [/어서$/, { haeyo: '어요', hamnida: '습니다', plain: '는다', noun: '기' }],
];

export function fixEnding(title: string, style: Style): string {
  const t = title.replace(/[,·\s]+$/, '');
  for (const [re, rep] of ENDING_FIX) if (re.test(t)) return t.replace(re, rep[style]);
  // 폴백 1: -고로 끝나면 명사형으로 (어간 + 기)
  if (/[가-힣]고$/.test(t)) return t.slice(0, -1) + '기';
  // 폴백 2: 손대지 않는다 ★
  //   **어색한 제목보다 틀린 제목이 훨씬 비싸다.** 그리고 어떤 경우에도 sourceRange가
  //   원문을 가리키고 있으므로 사용자는 언제든 원문을 되살릴 수 있다.
  return t;
}
