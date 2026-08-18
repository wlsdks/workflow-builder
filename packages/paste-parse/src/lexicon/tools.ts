/**
 * packages/paste-parse/src/lexicon/tools.ts  (PARSING §7.1 · TOOLS.md A. 도구 카탈로그)
 *
 * TOOLS.md의 48종 × 동의어를 그대로 데이터로 옮긴 것. 런타임에 마크다운을 파싱하지
 * 않는다(§12.1 병목 2) — 실제 제품에서는 이 파일이 빌드타임에 생성된다.
 *
 * 오탐을 막는 4중 장치 (§7.1)
 *   1. 최장일치      — `구글시트`가 있으면 `시트`로 매칭하지 않는다
 *   2. 조사 경계      — `엑셀런트`는 `엑셀`로 매칭되지 않는다
 *   3. 동음이의 문맥   — 아래 AMBIGUOUS 표. 가장 많은 오탐을 잡는다
 *   4. 확정하지 않음   — toolHints는 항상 "후보"다. 배지 클릭 1회로 확정된다
 */

import type { Span, ToolHit } from '../types.ts';

export type ToolEntry = { id: string; display: string; aliases: readonly string[] };

export const TOOL_CATALOG: readonly ToolEntry[] = [
  // ── 커뮤니케이션 ──────────────────────────────────────────────────────────
  { id: 'kakaotalk', display: '카카오톡', aliases: ['카카오톡', '카톡', '단톡방', '카톡방', 'KakaoTalk'] },
  { id: 'kakao_alimtalk', display: '카카오 알림톡', aliases: ['카카오 알림톡', '알림톡', '비즈메시지', '친구톡'] },
  { id: 'slack', display: '슬랙', aliases: ['슬랙', 'Slack', '슬렉'] },
  { id: 'naverworks', display: '네이버웍스', aliases: ['네이버웍스', '라인웍스', '웍스'] },
  { id: 'jandi', display: '잔디', aliases: ['잔디', 'JANDI', '잔디 토픽'] },
  { id: 'msteams', display: 'MS 팀즈', aliases: ['MS 팀즈', 'Teams', '팀즈'] },
  { id: 'phone', display: '전화', aliases: ['전화', '유선', '통화'] },
  { id: 'sms', display: '문자(SMS)', aliases: ['문자(SMS)', 'SMS', 'LMS'] },

  // ── 메일 ─────────────────────────────────────────────────────────────────
  { id: 'outlook', display: '아웃룩', aliases: ['아웃룩', 'Outlook', 'MS 메일'] },
  { id: 'gmail', display: '지메일 / 구글 워크스페이스', aliases: ['지메일', 'Gmail', '구글 메일', 'G메일', '구글 워크스페이스', '워크스페이스'] },
  { id: 'email_imap', display: '사내 메일(IMAP)', aliases: ['사내 메일', '회사메일', '회사 메일', '다음스마트워크', '메일플러그', '메일'] },

  // ── 문서 · 스프레드시트 ───────────────────────────────────────────────────
  { id: 'excel', display: '엑셀', aliases: ['엑셀', '액셀', 'Excel', 'xlsx', 'xls'] },
  { id: 'gsheets', display: '구글시트', aliases: ['구글시트', '구글 시트', '구글 스프레드시트', '지시트', '스프레드시트', '시트'] },
  { id: 'hwp', display: '한글(HWP)', aliases: ['한글(HWP)', '아래아한글', 'hwp', '한컴'] },
  { id: 'word', display: '워드', aliases: ['워드', 'Word', 'docx'] },
  { id: 'ppt', display: '파워포인트', aliases: ['파워포인트', 'PPT', '피피티', '장표'] },
  { id: 'notion', display: '노션', aliases: ['노션', 'Notion', '노션 DB'] },
  { id: 'gdrive', display: '구글 드라이브', aliases: ['구글 드라이브', '구글드라이브', '공유드라이브', '공유 드라이브', '지드라이브', '드라이브'] },
  { id: 'dropbox', display: '드롭박스 / 원드라이브', aliases: ['드롭박스', '드박', 'OneDrive', '원드라이브'] },
  { id: 'figma', display: '피그마', aliases: ['피그마', 'Figma'] },

  // ── 그룹웨어 · 전자결재 ───────────────────────────────────────────────────
  //   ★ '그룹웨어'는 별칭에 넣지 않는다. TOOLS.md의 동의어 목록에 없고,
  //     넣는 순간 "그룹웨어, 슬랙, 구글 워크스페이스" 같은 나열에서 오탐이 난다.
  { id: 'approval', display: '그룹웨어 전자결재', aliases: ['그룹웨어 전자결재', '전자결재', '결재올리기', '결재', '상신', '품의'] },
  { id: 'wehago', display: '더존 위하고', aliases: ['더존 위하고', 'WEHAGO', '위하고'] },
  { id: 'daouoffice', display: '다우오피스', aliases: ['다우오피스', '다우'] },
  { id: 'hiworks', display: '하이웍스', aliases: ['하이웍스', 'Hiworks'] },
  { id: 'flow', display: '플로우', aliases: ['플로우'] },

  // ── ERP · 회계 ───────────────────────────────────────────────────────────
  { id: 'douzone_erp', display: '더존 ERP', aliases: ['더존 ERP', '더존', 'iCUBE', '아이큐브', 'SmartA', 'ERP'] },
  { id: 'k_system', display: '영림원 K-System', aliases: ['영림원 K-System', '영림원', 'K시스템'] },
  { id: 'ecount', display: '이카운트 ERP', aliases: ['이카운트 ERP', '이카운트', 'ECOUNT'] },
  { id: 'sap', display: 'SAP', aliases: ['SAP ERP', 'SAP', 'S/4'] },
  { id: 'gyeongnara', display: '경리나라', aliases: ['경리나라', '웹케시 경리나라'] },

  // ── 세무 · 4대보험 · 전자세금계산서 ────────────────────────────────────────
  { id: 'hometax', display: '홈택스', aliases: ['홈택스', '국세청'] },
  { id: 'barobill', display: '바로빌', aliases: ['바로빌'] },
  { id: 'smartbill', display: '스마트빌', aliases: ['스마트빌', '비즈니스온'] },
  { id: 'insurance4', display: '4대보험 정보연계센터', aliases: ['4대보험 정보연계센터', '4대보험', '사대보험', '취득신고'] },
  { id: 'wetax', display: '위택스 / 이택스', aliases: ['위택스', '이택스', '지방세'] },

  // ── 은행 · 카드 · 결제 ────────────────────────────────────────────────────
  { id: 'ibank', display: '기업 인터넷뱅킹', aliases: ['기업 인터넷뱅킹', '법인뱅킹', '인터넷뱅킹', '인뱅', '펌뱅킹'] },
  { id: 'corp_card', display: '법인카드 웹명세', aliases: ['법인카드 웹명세', '법인카드', '카드 명세', '카드명세', '카드사'] },
  { id: 'creditfn', display: '여신금융협회 카드매출', aliases: ['여신금융협회 카드매출', '여신협회'] },
  { id: 'pg', display: 'PG (토스페이먼츠/이니시스/KCP)', aliases: ['토스페이먼츠', '이니시스', 'KCP', '결제대행'] },

  // ── 인사 · 근태 · 채용 ────────────────────────────────────────────────────
  { id: 'flex', display: 'flex', aliases: ['플렉스'] },
  { id: 'shiftee', display: '시프티', aliases: ['시프티', 'Shiftee'] },
  { id: 'albam', display: '알밤', aliases: ['알밤 출퇴근', '알밤'] },
  { id: 'newploy', display: '뉴플로이', aliases: ['뉴플로이'] },
  { id: 'saramin', display: '사람인', aliases: ['사람인', 'saramin'] },
  { id: 'jobkorea', display: '잡코리아', aliases: ['잡코리아', '잡코'] },
  { id: 'wanted', display: '원티드', aliases: ['원티드', 'wanted'] },
  { id: 'greeting', display: '그리팅', aliases: ['그리팅'] },

  // ── 영업 · CRM · CS ──────────────────────────────────────────────────────
  { id: 'salesforce', display: '세일즈포스', aliases: ['세일즈포스', 'Salesforce', 'SFDC'] },
  { id: 'hubspot', display: '허브스팟', aliases: ['허브스팟', 'HubSpot'] },
  { id: 'remember', display: '리멤버', aliases: ['리멤버', '명함앱'] },
  { id: 'sales_ledger', display: '영업관리 대장(엑셀)', aliases: ['영업관리 대장', '영업대장', '견적대장', '파이프라인 시트'] },
  { id: 'channeltalk', display: '채널톡', aliases: ['채널톡', 'channel.io'] },
  { id: 'zendesk', display: '젠데스크', aliases: ['젠데스크', 'Zendesk'] },
  { id: 'happytalk', display: '해피톡', aliases: ['해피톡', 'happytalk'] },
  { id: 'callcenter', display: '콜센터/ARS', aliases: ['콜센터', 'ARS', '대표번호'] },

  // ── 이커머스 · 물류 ───────────────────────────────────────────────────────
  { id: 'smartstore', display: '스마트스토어', aliases: ['스마트스토어', '네이버 스토어', '스토어팜'] },
  { id: 'coupang', display: '쿠팡 윙', aliases: ['쿠팡 윙', '쿠팡', 'WING'] },
  { id: 'cafe24', display: '카페24', aliases: ['카페24', 'cafe24'] },
  { id: 'ezadmin', display: '이지어드민', aliases: ['이지어드민', 'ezadmin'] },
  { id: 'sabangnet', display: '사방넷 / 플레이오토', aliases: ['사방넷', '플레이오토', '플오'] },
  { id: 'courier', display: '택배사 시스템', aliases: ['CJ대한통운', '롯데택배', '한진택배', '우체국택배', '택배사', '송장'] },

  // ── 마케팅 ───────────────────────────────────────────────────────────────
  { id: 'meta_biz', display: '메타 비즈니스', aliases: ['메타 비즈니스', '페이스북 광고', '인스타 광고'] },
  { id: 'naver_ad', display: '네이버 검색광고', aliases: ['네이버 검색광고', '네이버 광고', '파워링크'] },
  { id: 'google_ads', display: '구글애즈', aliases: ['구글애즈', 'Google Ads'] },
  { id: 'ga4', display: 'GA4', aliases: ['GA4', '구글 애널리틱스'] },
];

/**
 * 일반명사와 충돌하는 별칭 — 근처(±20자)에 단서가 있어야 인정한다.
 * 이 표 하나가 도구 오탐의 대부분을 잡는다.
 */
export const AMBIGUOUS: Record<string, RegExp> = {
  시트: /구글|스프레드|공유\s?시트|시트에\s?(?:입력|정리|기록)/,
  드라이브: /구글|원|공유|G\s?드라이브|드라이브에\s?(?:올리|업로드|저장)/,
  카드: /법인|명세|매출|카드사|승인내역/,
  폼: /구글\s?폼|설문|응답/,
  보드: /화이트|칸반|잔디|트렐로/,
  플로우: /flow|협업|메신저|채널/,
  위하고: /더존|ERP|회계|전표/,
  전화: /(?:전화(?:로|를|해|드려|받|걸|주)|통화|유선)/,
  노션: /(?:노션)/,
  잔디: /(?:잔디\s?(?:토픽|방|에|으로|로)|JANDI)/,
  알밤: /출퇴근|근태|알밤\s?(?:앱|에|으로)/,
  메일: /(?:메일(?:로|을|를|이|은|함|서버|주소)|이메일|회신|발송|보내|받)/,
};

/** 한글에는 단어 경계가 없다 → 앞뒤 문자를 직접 검사한다 */
const RE_BEFORE_OK = /(?:^|[\s,.·:;()[\]{}"'「『/\-–—>|\t])$/;
const RE_AFTER_OK =
  /^(?:에서|에게|한테|으로|에|은|는|이|가|을|를|로|와|과|도|만|의|랑|이랑|하고|부터|까지|나|든|든지|처럼|보다|같이)?(?:$|[\s,.·:;()[\]{}"'」』/\-–—<|\t\n])/;

type TrieNode = { next: Map<string, TrieNode>; hit?: { id: string; display: string; alias: string } };

function buildTrie(entries: readonly ToolEntry[]): TrieNode {
  const root: TrieNode = { next: new Map() };
  for (const e of entries) {
    for (const alias of e.aliases) {
      let node = root;
      for (const ch of alias.toLowerCase()) {
        let nx = node.next.get(ch);
        if (!nx) {
          nx = { next: new Map() };
          node.next.set(ch, nx);
        }
        node = nx;
      }
      // 먼저 등재된 쪽이 이긴다 (카탈로그 순서 = 우선순위)
      if (!node.hit) node.hit = { id: e.id, display: e.display, alias };
    }
  }
  return root;
}

// §12.1 병목 2 — 모듈 스코프 + 지연 초기화. 호출마다 다시 만들지 않는다
let TOOL_TRIE: TrieNode | null = null;
const trie = (): TrieNode => (TOOL_TRIE ??= buildTrie(TOOL_CATALOG));

/** 도구스러운데 카탈로그에 없는 토큰 — TOOLS.md §운영규칙 2의 확장 큐를 채우는 유일한 경로 */
const RE_TOOL_CANDIDATE = /[A-Za-z][A-Za-z0-9.]{2,}|[가-힣]{2,6}(?=(?:에|에서)\s*(?:입력|등록|정리|올리))/g;

export class ToolScanner {
  scan(text: string, offset = 0): ToolHit[] {
    const hits: ToolHit[] = [];
    const lower = text.toLowerCase();
    for (let i = 0; i < text.length; ) {
      // ── 1. 최장일치 ──────────────────────────────────────────────────────
      let node = trie();
      let best: { id: string; display: string; alias: string; end: number } | null = null;
      for (let j = i; j < text.length; j++) {
        const nx = node.next.get(lower[j]!);
        if (!nx) break;
        node = nx;
        if (node.hit) best = { ...node.hit, end: j + 1 };
      }
      if (!best) {
        i++;
        continue;
      }
      // ── 2. 조사 경계 ─────────────────────────────────────────────────────
      if (!RE_BEFORE_OK.test(text.slice(Math.max(0, i - 1), i)) || !RE_AFTER_OK.test(text.slice(best.end, best.end + 4))) {
        i++;
        continue;
      }
      // ── 3. 동음이의 문맥 요구 ─────────────────────────────────────────────
      const ctx = AMBIGUOUS[best.alias];
      if (ctx && !ctx.test(text.slice(Math.max(0, i - 20), best.end + 20))) {
        i = best.end;
        continue;
      }
      const span: Span = [i + offset, best.end + offset];
      hits.push({ id: best.id, display: best.display, span });
      i = best.end; // 겹침 방지
    }
    return hits;
  }

  /** 미매칭 수집 — 부정 문맥은 처리하지 않는다 (§7.1 마지막 문단, 부록 C 1) */
  unmatched(text: string, hits: readonly ToolHit[], offset = 0): string[] {
    const out: string[] = [];
    const re = new RegExp(RE_TOOL_CANDIDATE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const s = m.index + offset;
      const e = s + m[0].length;
      if (hits.some((h) => h.span[0] < e && s < h.span[1])) continue;
      out.push(m[0]);
    }
    return out;
  }
}

export const toolScanner = new ToolScanner();
