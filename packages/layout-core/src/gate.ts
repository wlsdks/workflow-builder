/**
 * packages/layout-core/src/gate.ts — LAYOUT §2 · D-024 · D-105
 *
 * 구조 diff 게이트. **타이핑의 95%가 여기서 끝난다.**
 *
 * §2.2의 31행 전수표를 산문이 아니라 **데이터**로 옮겼다. 표를 사람이 관리하면
 * 반드시 썩으므로, 표의 각 행은 "이 변경이 layoutKey의 어느 성분을 건드리는가"를
 * 말하고, 게이트의 판정은 오직 그 성분 비교에서 나온다.
 *
 *   재배치 필요 ⟺ layoutKey 성분 중 하나 이상이 달라졌다
 *
 * 표와 코드가 어긋나면 test/layout.test.ts의 `게이트 표` 블록이 실패한다.
 */

import { layoutKeyOfParts, layoutKeyParts, type LayoutKeyParts } from './key.ts';
import type { LayoutInput, LayoutKey } from './types.ts';

/** layoutKey를 구성하는 성분. 'none' = 키에 도달하는 경로가 없다 */
export type GateDimension = 'none' | 'topology' | 'containers' | 'collapsed' | 'fan-out' | 'ladder' | 'options';

export type GateReason = 'initial' | 'unchanged' | GateDimension;

export type GateDecision = {
  /** 재배치(ELK 또는 폴백 재실행)가 필요한가 */
  readonly relayout: boolean;
  /** 왜. 여러 성분이 동시에 바뀌면 `dimensions`에 전부 들어간다 */
  readonly reason: GateReason;
  readonly dimensions: readonly GateDimension[];
  readonly key: LayoutKey;
  readonly prevKey: LayoutKey | null;
};

/** 성분 비교 순서 = 진단 우선순위. 위상이 바뀌면 나머지는 부차적이다 */
const ORDER: ReadonlyArray<[GateDimension, keyof LayoutKeyParts]> = [
  ['topology', 'topology'],
  ['collapsed', 'collapsed'],
  ['containers', 'containers'],
  ['fan-out', 'fanOut'],
  ['ladder', 'ladder'],
  ['options', 'options'],
];

/**
 * 재배치 필요 판정.
 *
 * `prev`가 null이면 최초 레이아웃이다 — 재배치는 필요하지만 앵커링은 하지 않는다
 * (anchor.ts가 `{ t:'fit', reason:'initial' }`로 답한다).
 */
export function needsRelayout(prev: LayoutInput | null, next: LayoutInput): GateDecision {
  const np = layoutKeyParts(next);
  const key = layoutKeyOfParts(np);

  if (prev === null) {
    return { relayout: true, reason: 'initial', dimensions: [], key, prevKey: null };
  }

  const pp = layoutKeyParts(prev);
  const prevKey = layoutKeyOfParts(pp);

  const dimensions: GateDimension[] = [];
  for (const [dim, field] of ORDER) if (pp[field] !== np[field]) dimensions.push(dim);

  if (dimensions.length === 0) {
    // 해시 충돌이 아니라면 키도 같다. 같지 않다면 성분 목록이 새고 있다는 뜻이다.
    return { relayout: false, reason: 'unchanged', dimensions: [], key, prevKey };
  }
  return { relayout: true, reason: dimensions[0]!, dimensions, key, prevKey };
}

/* ────────────────────────────────────────────────────────────────────────
 * §2.2 전수표 — 31행
 *
 *  dimension : 이 변경이 건드리는 layoutKey 성분. 'none'이면 게이트를 통과 못 한다
 *  servedBy  : 재배치가 필요할 때 무엇이 답하는가
 *                'elk'   — 워커를 깨운다
 *                'cache' — LRU 히트로 좌표를 복원한다 (L-11). jump_score가 정확히 0
 *                'none'  — 재배치 자체가 없다
 * ──────────────────────────────────────────────────────────────────────── */

export type GateRow = {
  readonly n: number;
  readonly change: string;
  readonly dimension: GateDimension;
  readonly servedBy: 'elk' | 'cache' | 'none';
  readonly why: string;
};

export const GATE_TABLE: readonly GateRow[] = [
  { n: 1, change: '제목 타이핑', dimension: 'none', servedBy: 'none',
    why: '노드 폭 고정(D-023)이라 글자 수가 기하에 도달하는 경로 자체가 없다' },
  { n: 2, change: '담당자 지정/변경', dimension: 'none', servedBy: 'none',
    why: '메타 스트립은 24px 고정 예약이라 높이 불변' },
  { n: 3, change: '소요시간·도구·자동화 칩', dimension: 'none', servedBy: 'none',
    why: '위와 동일' },
  { n: 4, change: '짜증 플래그 토글', dimension: 'none', servedBy: 'none',
    why: '렌즈 전용(D-025). 기본 렌즈에선 DOM도 안 바뀐다' },
  { n: 5, change: 'reworkRate 입력', dimension: 'none', servedBy: 'none',
    why: 'topologyHash에서 의도적 제외. 확률은 메트릭이지 위상이 아니다' },
  { n: 6, change: '확인(confirm_item)', dimension: 'none', servedBy: 'none',
    why: '신선도 채도만' },
  { n: 7, change: '갈래 조건 라벨(caseLabel) 편집', dimension: 'none', servedBy: 'none',
    why: 'L-01. 라벨을 ELK에 안 넘기므로 기하 무관. 넘겼다면 "조건 타이핑 = 재배치"가 됐을 것' },
  { n: 8, change: '순서 이동(reorder_item)', dimension: 'topology', servedBy: 'elk',
    why: 'source>target이 바뀐다' },
  { n: 9, change: '단계 삽입/삭제', dimension: 'topology', servedBy: 'elk',
    why: '노드 집합이 바뀐다' },
  { n: 10, change: 'kind 변경 (task↔branch↔hold)', dimension: 'topology', servedBy: 'elk',
    why: 'id|kind에 포함' },
  { n: 11, change: 'mode xor↔and', dimension: 'topology', servedBy: 'elk',
    why: 'branchMode + join 노드 생성/삭제' },
  { n: 12, change: 'joinBehavior continue↔end', dimension: 'topology', servedBy: 'elk',
    why: '엣지 reason이 case-join↔end로' },
  { n: 13, change: '명시 엣지 추가/삭제/억제', dimension: 'topology', servedBy: 'elk',
    why: '엣지 집합' },
  { n: 14, change: '들여쓰기(부모 변경)', dimension: 'topology', servedBy: 'elk',
    why: 'reason이 sequence→subtree로 바뀌어 대부분 포착' },
  { n: 15, change: '들여쓰기인데 파생 엣지가 완전히 동일한 경우', dimension: 'containers', servedBy: 'elk',
    why: 'containerHash. 명시 그룹 소속이 바뀌면 ELK 컨테이너 구조가 바뀐다' },
  { n: 16, change: '그룹 접기 / 펼치기', dimension: 'collapsed', servedBy: 'cache',
    why: 'collapsedHash. 접힌 서브트리가 단일 노드로 축약되므로 완전히 다른 그래프' },
  { n: 17, change: '자동 그룹(부서 구간) 멤버십 변경', dimension: 'none', servedBy: 'none',
    why: 'L-02. 자동 그룹은 ELK 컨테이너가 아니라 오버레이다' },
  { n: 18, change: '위 자동 그룹이 접혀 있을 때 멤버십 변경', dimension: 'collapsed', servedBy: 'elk',
    why: 'collapsedHash에 그룹의 멤버 목록까지 넣는다 (§7.4)' },
  { n: 19, change: '갈래 4개→5개 (팬아웃 스택 진입)', dimension: 'topology', servedBy: 'elk',
    why: '노드 추가로 이미 다름. fanOutStack 플래그를 따로 넣어 5→4 복귀를 확실히 한다' },
  { n: 20, change: '렌즈 전환', dimension: 'none', servedBy: 'none',
    why: 'L-07. LayoutInput에 lens 필드가 타입상 존재하지 않는다' },
  { n: 21, change: '줌 티어 전환', dimension: 'none', servedBy: 'none',
    why: '동일. LayoutInput에 zoom이 없다' },
  { n: 22, change: '노드 선택 / 호버 / 인스펙터', dimension: 'none', servedBy: 'none',
    why: '보더 1.5px 고정 + inset box-shadow → 박스 크기 불변' },
  { n: 23, change: '뷰포트/패널 리사이즈', dimension: 'none', servedBy: 'none',
    why: 'ELK 좌표는 뷰포트 독립이다. 리사이즈에 재배치를 거는 게 흔한 실수' },
  { n: 24, change: '폰트 로드 완료', dimension: 'none', servedBy: 'none',
    why: '노드 크기 고정' },
  { n: 25, change: '글자 크기 설정 변경', dimension: 'none', servedBy: 'none',
    why: 'line-clamp만 바뀐다' },
  { n: 26, change: '다크모드 / 테마', dimension: 'none', servedBy: 'none', why: '색만' },
  { n: 27, change: 'ELK 옵션 또는 elkjs 버전 변경', dimension: 'options', servedBy: 'elk',
    why: 'optionsHash' },
  { n: 28, change: '성능 사다리 단계 변경', dimension: 'ladder', servedBy: 'elk',
    why: 'ladder를 키에 포함. 다음 재배치부터 적용' },
  { n: 29, change: 'undo로 이전 위상 복귀', dimension: 'topology', servedBy: 'cache',
    why: 'L-11. LRU 캐시 히트 → 좌표 그대로 복원 → jump_score가 정확히 0' },
  { n: 30, change: '내보내기 실행', dimension: 'none', servedBy: 'none',
    why: '화면 좌표를 그대로 재사용 (§12.6)' },
  { n: 31, change: '문서 최초 로드', dimension: 'none', servedBy: 'cache',
    why: '좌표 스냅샷 키가 맞으면 ELK 미실행 (§1.6). 키가 다르면 topology 성분이 잡는다' },
];

/** 표의 계약: 재배치 필요 ⟺ layoutKey 성분이 바뀐다 */
export function rowExpectsRelayout(row: GateRow): boolean {
  return row.dimension !== 'none';
}
