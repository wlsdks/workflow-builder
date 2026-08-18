/**
 * packages/paste-parse/src/detect.ts  (PARSING §2)
 *
 * S2 소스 유형 감지.
 *
 * **단일 라벨이 아니라 (라벨 + 특성 집합)이다.** 메일 안에 번호 목록이 있고,
 * 카톡 안에 불릿이 있다. `sourceHint`는 텔레메트리용 대표 라벨이고,
 * **실제 전처리를 움직이는 것은 `traits`**다. 그래서 "번호 목록이 들어있는 메일"이
 * 정상 동작한다 (§2.4).
 *
 * 전부 줄 단위 앵커드 정규식이다. `.*`도, 중첩 수량자도 없다 (ReDoS 차단, §12.1 규칙 3).
 */

import type { Detection, Line, SourceHint, Trait } from './types.ts';

/* ── 카카오톡 ─────────────────────────────────────────────────────────────── */
export const RE_KAKAO_PC = /^\d{4}년 \d{1,2}월 \d{1,2}일 (오전|오후) \d{1,2}:\d{2}, (.{1,30}?) : /;
export const RE_KAKAO_MOBILE = /^\[(.{1,30}?)\] \[(오전|오후) \d{1,2}:\d{2}\] /;
export const RE_KAKAO_DATE = /^-{5,}\s*\d{4}년 \d{1,2}월 \d{1,2}일 [월화수목금토일]요일\s*-{5,}$/;
export const RE_KAKAO_CSV = /^"?Date"?\s*,\s*"?User"?\s*,\s*"?Message"?/;
export const RE_KAKAO_SYS =
  /^(.{1,30}?)님이 (들어왔습니다|나갔습니다)\.?$|^삭제된 메시지입니다\.?$|^사진 \d+장$|^(이모티콘|사진|동영상|파일: )/;
export const RE_EMOTICON = /[ㅋㅎㅠㅜ]{2,}|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/* ── 메일 ────────────────────────────────────────────────────────────────── */
export const RE_MAIL_HEADER =
  /^(보낸사람|보낸 사람|받는사람|받는 사람|참조|숨은참조|제목|날짜|보낸날짜|첨부|From|To|Cc|Bcc|Subject|Sent|Date|Reply-To)\s*[:：]\s?/;
export const RE_MAIL_QUOTE = /^\s*>{1,6}\s?/;
export const RE_MAIL_ORIG = /^\s*(-{2,}\s*(Original Message|원본 메일|원본 메시지)\s*-{2,}|={5,}|_{5,})\s*$/i;
export const RE_MAIL_WROTE = /(님이 (작성|쓰|보내)|\bwrote:\s*$|다음 글을 작성했습니다)/;
export const RE_MAIL_ADDR = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
export const RE_SIGN_CLOSE =
  /^\s*(감사합니다|고맙습니다|수고하세요|수고하십시오|드림|올림|배상|Best regards|Thanks|Regards)[.!,~\s]*$/;
export const RE_SIGN_CONTACT = /(?:^|\s)(?:\(?0\d{1,2}\)?[-\s]?\d{3,4}[-\s]?\d{4}|010[-\s]?\d{4}[-\s]?\d{4})(?:\s|$)/;
export const RE_SIGN_TITLE =
  /^\s*[가-힣]{1,6}(팀|부|실|본부|센터|그룹|파트)?\s*(사원|주임|대리|과장|차장|부장|팀장|실장|이사|상무|전무|대표|매니저|담당)\s*$/;

/* ── 워드/한글 SOP ────────────────────────────────────────────────────────── */
export const RE_NUM_ANY =
  /^\s*(?:\(?\d{1,3}[.)]|\d{1,2}(?:[.\-]\d{1,2}){1,3}\.?|[①-⑳]|[가-하][.)]|[㉠-㉿]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ][.)]|[a-zA-Z][.)])\s+/;
export const RE_HWP_DEPTH = /^\s*(?:[가-하][.)]|[①-⑳]|[㉠-㉿])\s+/;
export const RE_PAGE_NUM = /^\s*[-–—‹«[(]?\s*(?:page\s*)?\d{1,4}\s*(?:\/\s*\d{1,4})?\s*[-–—›»\])]?\s*$/i;

/* ── 표/엑셀 ─────────────────────────────────────────────────────────────── */
export const RE_MD_TABLE = /^\s*\|.+\|\s*$/;

/* ── 노션/구글독스 ────────────────────────────────────────────────────────── */
export const RE_CHECKBOX = /^\s*[-*+]\s*\[\s*[ xX✓]\s*\]\s+/;
export const RE_BULLET = /^\s*[-*+•‣◦▪▫·※○●□■◇◆–—]\s+/;
export const RE_MD_HEADING = /^\s*#{1,6}\s+\S/;
export const RE_NOTION_TOGGLE = /^\s*[▸▾▶▼]\s+/;
export const RE_CALLOUT = /^\s*[💡⚠️📌❗✅]\s*/u;

/* ── 회의록 ──────────────────────────────────────────────────────────────── */
export const RE_MINUTES_SEC =
  /^\s*[■□▶◆●※]?\s*(액션\s?아이템|Action\s?Items?|실행\s?항목|후속\s?조치|To-?Do|할\s?일|결정\s?사항|논의\s?(내용|사항)|안건|공유\s?사항|이슈)\s*[:：]?\s*$/i;
export const RE_MINUTES_HEAD = /^\s*(일시|장소|참석(자)?|배석|불참|작성자|회의명|주관)\s*[:：]/;
export const RE_MENTION_LINE = /@([가-힣]{2,4}|[A-Za-z][A-Za-z0-9._-]{1,20})/;

/* ── PPT 도형 ────────────────────────────────────────────────────────────── */
export { RE_NOUN_END } from './lexicon/verbs.ts';
import { RE_NOUN_END } from './lexicon/verbs.ts';

/* ── 통계 도구 ───────────────────────────────────────────────────────────── */
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
}

export function modal(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
}

/**
 * 각 감지기는 **독립적으로** 0..1을 반환하고, 최댓값이 임계(0.35)를 넘으면 그 라벨을 쓴다.
 * `prose`와 `unknown`은 폴백이다.
 */
export function detect(lines: readonly Line[], work: string): Detection {
  const n = lines.length;
  const nonEmpty = lines.filter((l) => l.text.trim().length > 0);
  const m = Math.max(1, nonEmpty.length);
  const ratio = (p: (l: Line) => boolean) => nonEmpty.filter(p).length / m;
  const head = nonEmpty.slice(0, 40);
  const traits = new Set<Trait>();

  // 대화: 타임스탬프+화자가 붙은 줄의 비율
  const chatR = ratio((l) => RE_KAKAO_PC.test(l.text) || RE_KAKAO_MOBILE.test(l.text));
  const kakao =
    clamp01(chatR * 1.6) +
    (head.some((l) => RE_KAKAO_DATE.test(l.text) || RE_KAKAO_CSV.test(l.text)) ? 0.3 : 0) +
    (ratio((l) => RE_EMOTICON.test(l.text)) > 0.15 ? 0.1 : 0);
  if (chatR > 0.2) {
    traits.add('timestamped');
    traits.add('speakered');
  }
  if (ratio((l) => RE_EMOTICON.test(l.text)) > 0.1) traits.add('emoticon');

  // 메일: 헤더는 "앞쪽 10줄 안에 2종 이상"일 때만 인정한다. 본문 중간의 "제목:"은 헤더가 아니다
  const headerHits = new Set(
    nonEmpty
      .slice(0, 10)
      .map((l) => RE_MAIL_HEADER.exec(l.text)?.[1])
      .filter((x): x is string => x != null),
  );
  const quoteR = ratio((l) => RE_MAIL_QUOTE.test(l.text));
  const email =
    (headerHits.size >= 2 ? 0.55 : headerHits.size === 1 ? 0.2 : 0) +
    clamp01(quoteR * 2) * 0.25 +
    (nonEmpty.some((l) => RE_MAIL_ORIG.test(l.text) || RE_MAIL_WROTE.test(l.text)) ? 0.25 : 0);
  if (headerHits.size >= 2) traits.add('mail_headered');
  if (quoteR > 0.05) traits.add('quoted');
  if (nonEmpty.some((l) => RE_SIGN_CLOSE.test(l.text) || RE_SIGN_CONTACT.test(l.text) || RE_SIGN_TITLE.test(l.text)))
    traits.add('signed');

  // 표: "탭이 있는 줄의 비율"이 아니라 "열 개수가 일정한가"가 핵심이다
  const tabCounts = nonEmpty.filter((l) => l.text.includes('\t')).map((l) => l.text.split('\t').length);
  const tabCols = modal(tabCounts);
  const tabConsistent = tabCounts.length >= 2 ? tabCounts.filter((c) => c === tabCols).length / tabCounts.length : 0;
  const mdTableR = ratio((l) => RE_MD_TABLE.test(l.text));
  const table =
    tabCounts.length / m >= 0.6 && tabConsistent >= 0.8 ? 0.5 + 0.4 * tabConsistent : mdTableR > 0.6 ? 0.8 : 0;
  if (table > 0.35) traits.add('tabbed');

  // 노션/독스
  const cbR = ratio((l) => RE_CHECKBOX.test(l.text));
  const buR = ratio((l) => RE_BULLET.test(l.text) && !RE_CHECKBOX.test(l.text));
  const hdR = ratio((l) => RE_MD_HEADING.test(l.text));
  const notion = clamp01(cbR * 2) * 0.6 + clamp01(buR * 1.4) * 0.4 + (hdR > 0 ? 0.15 : 0);
  if (cbR > 0.1) traits.add('checkbox');
  if (buR > 0.15) traits.add('bulleted');
  if (hdR > 0) traits.add('heading');

  // 워드/한글 SOP: 번호 밀도 + 한국 문서 특유 2·3단 마커 + 들여쓰기
  const numR = ratio((l) => RE_NUM_ANY.test(l.text));
  const indR = ratio((l) => l.indentWidth > 0);
  const word =
    clamp01(numR * 1.5) * 0.6 + (nonEmpty.some((l) => RE_HWP_DEPTH.test(l.text)) ? 0.25 : 0) + clamp01(indR) * 0.15;
  if (numR > 0.2) traits.add('numbered');
  if (indR > 0.2) traits.add('indented');

  // 회의록
  const mentionR = ratio((l) => RE_MENTION_LINE.test(l.text));
  const minutes =
    (nonEmpty.some((l) => RE_MINUTES_SEC.test(l.text)) ? 0.5 : 0) +
    (head.filter((l) => RE_MINUTES_HEAD.test(l.text)).length >= 2 ? 0.3 : 0) +
    (mentionR > 0.15 ? 0.2 : 0);
  if (nonEmpty.some((l) => RE_MINUTES_SEC.test(l.text))) traits.add('sectioned');
  if (mentionR > 0.1) traits.add('mentioned');

  // PPT 도형: 짧고 · 종결부호 없고 · 명사형으로 끝나고 · 마커 없음
  const med = median(nonEmpty.map((l) => l.text.trim().length));
  const nounEndR = ratio((l) => RE_NOUN_END.test(l.text.trim()));
  const ppt =
    med <= 18 && m >= 3 && numR < 0.1 && buR < 0.2
      ? 0.3 + 0.4 * nounEndR + 0.2 * ratio((l) => !/[.!?]$/.test(l.text.trim()))
      : 0;
  if (med <= 18) traits.add('short_lines');
  if (nounEndR > 0.5) traits.add('noun_ended');

  // 프로즈: 줄이 거의 없고 글자가 많다
  const prose = m <= 3 && work.trim().length >= 40 && numR === 0 && buR === 0 ? 0.6 : 0;

  // 워드랩: 종결 없이 끊긴 줄이 많고 줄 길이가 균일하다 → §3.3에서 되붙인다
  const modalWidth = median(nonEmpty.map((l) => l.text.length));
  if (
    m >= 5 &&
    ratio((l) => !/[.!?…]$|[다요음함임까죠네](?:[.!?])?$/.test(l.text.trim())) > 0.5 &&
    stdev(nonEmpty.map((l) => l.text.length)) / Math.max(1, modalWidth) < 0.15
  ) {
    traits.add('wrapped');
  }

  const scored: [SourceHint, number][] = [
    ['kakao', kakao], ['email', email], ['table', table], ['notion', notion],
    ['word_sop', word], ['minutes', minutes], ['ppt', ppt], ['prose', prose],
  ];
  scored.sort((a, b) => b[1] - a[1]);
  const top = scored[0]!;
  const [hint, certainty] = top[1] >= 0.35 ? top : (['unknown', 0.1] as [SourceHint, number]);

  return {
    hint,
    certainty: clamp01(certainty),
    traits,
    meta: { lineCount: n, charLen: work.length, modalWidth, tabCols: table > 0.35 ? tabCols : null },
  };
}
