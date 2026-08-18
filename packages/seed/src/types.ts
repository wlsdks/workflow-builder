/**
 * packages/seed/src/types.ts
 *
 * 시드 콘텐츠의 타입. `docs/SEED-CONTENT.md`와 `docs/TOOLS.md`의 산문을
 * **타입 검사되는 데이터**로 옮기기 위한 최소 스키마다.
 *
 * 설계 원칙 두 개.
 *   1) 흐름의 본체는 graph-core의 `Item`/`Edge` 그대로다. 시드용 별도 그래프
 *      표현을 만들지 않는다 — 만드는 순간 두 표현이 갈라지고, 시드가 실제
 *      제품에서 열리지 않는 날이 온다.
 *   2) 문서가 *주장한* 숫자(`claims`)를 데이터에 같이 넣는다. 그래야 테스트가
 *      `derive()`의 실제 계산과 대조해서 **문서가 틀렸다고 말할 수 있다.**
 *
 * graph-core는 devDependency이고 여기서는 `import type`만 쓴다 → 런타임 의존 0.
 */

import type { Edge, Item } from '@workflow/graph-core';

/* ────────────────────────────────────────────────────────────────────────────
 * 1. 조직 — 부서와 역할
 * ──────────────────────────────────────────────────────────────────────────── */

/** 온보딩 칩이 놓이는 7개 부서 + 흐름에만 등장하는 경영진 */
export type DeptId = 'hr' | 'fin' | 'sal' | 'cs' | 'ga' | 'mkt' | 'ops' | 'exec';

/** 칩이 실제로 걸리는 7부서 (경영진은 칩을 갖지 않는다) */
export type ChipDeptId = Exclude<DeptId, 'exec'>;

export type Dept = {
  id: DeptId;
  /** 화면 표기. "부서"라는 단어를 붙이지 않는다 */
  name: string;
};

/**
 * 담당자는 `assigneeId` FK다 (SEED-CONTENT §E 주의사항 1).
 * 시드가 자유 텍스트 담당자로 들어가면 디렉터리 조인이 처음부터 깨진다.
 */
export type Role = {
  /** `items.assigneeId`에 그대로 들어가는 값 */
  id: string;
  /** 직원이 부르는 호칭 */
  name: string;
  deptId: DeptId;
};

/* ────────────────────────────────────────────────────────────────────────────
 * 2. 도구 카탈로그
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 연결성.
 *   high(상) = 공개 API + n8n 기성 노드
 *   mid(중)  = API·웹훅은 있으나 커스텀 HTTP 필요 또는 파일 기반
 *   low(하)  = API 없음 · 수기 · 오프라인
 */
export type Connectivity = 'high' | 'mid' | 'low';

export type ToolCategory =
  | 'comm'
  | 'mail'
  | 'doc'
  | 'groupware'
  | 'erp'
  | 'tax'
  | 'bank'
  | 'hr'
  | 'crm'
  | 'commerce'
  | 'marketing'
  | 'project'
  | 'offline';

/**
 * n8n 매핑. 기성 노드가 있으면 노드 타입 문자열, HTTP Request로만 되면 'http',
 * 붙일 수 있는 게 없으면 null.
 */
export type N8nMapping = { kind: 'node'; nodeType: string } | { kind: 'http' } | { kind: 'none' };

export type ToolEntry = {
  /** `items.toolIds`에 들어가는 값. 안정적이어야 한다 — 이름은 바뀌어도 ID는 안 바뀐다 */
  id: string;
  /** 표시명 */
  name: string;
  /**
   * 정규화 사전(alias). 본문에서 이 문자열이 감지되면 배지가 뜬다.
   * **두 도구가 같은 동의어를 가지면 사전이 모호해진다** → 테스트가 막는다.
   */
  aliases: readonly string[];
  connectivity: Connectivity;
  category: ToolCategory;
  n8n: N8nMapping;
  /** 왜 이 연결성인가. 화면에 그대로 나가지 않는다 — 판단 근거 보존용 */
  rationale?: string;
  /**
   * 이 도구가 붙은 단계의 Feasibility 상한. 공동인증서가 0.5로 캡한다.
   * (TOOLS.md — "이 단계가 있으면 Feasibility 상한이 0.5로 캡됨")
   */
  feasibilityCap?: number;
  /**
   * "도구를 바꾸면 상이 됨" 선행 개선 제안 (TOOLS.md 운영 규칙 3).
   * 연결성 '하'를 자동화 후보에서 배제하는 대신 이걸 따로 출력한다.
   */
  upgrade?: { toolId: string; note: string };
  /**
   * TOOLS.md 표에 있던 행인가, 시드를 만들며 필요해서 넣은 행인가.
   * 'seed-extension'은 카탈로그 확장 큐로 올라가야 하는 것들이다.
   */
  source: 'TOOLS.md' | 'seed-extension';
};

/* ────────────────────────────────────────────────────────────────────────────
 * 3. 부서별 업무명 칩
 * ──────────────────────────────────────────────────────────────────────────── */

export type Chip = {
  /** 직원이 0.5초 안에 "아 맞다 그거"가 나와야 하는 문구 */
  label: string;
  /** 이 칩을 누르면 열리는 시드 흐름. 없으면 빈 문서에서 시작 */
  workflowId?: string;
};

export type DeptChips = {
  deptId: ChipDeptId;
  deptName: string;
  /** 정확히 6개 */
  chips: readonly Chip[];
};

/* ────────────────────────────────────────────────────────────────────────────
 * 4. 예외 프롬프트 뱅크
 * ──────────────────────────────────────────────────────────────────────────── */

export type PromptScope =
  /** 모든 단계 (문서 1개당 최대 1회) */
  | { kind: 'common' }
  /** 단계 타입별 */
  | { kind: 'task' }
  | { kind: 'branch'; mode: 'xor' | 'and' | 'skip' | 'any' }
  | { kind: 'hold'; waitFor: 'approval' | 'reply' | 'time' | 'resource' }
  /** 도구별. toolIds 중 하나라도 걸리면 */
  | { kind: 'tool'; toolIds: readonly string[] }
  /** 흐름 완성 직후, 전체 1회 최대 2문항 */
  | { kind: 'completion' };

export type ExceptionPrompt = {
  id: string;
  /** 인라인 각주 입력란의 질문. **절대 모달로 띄우지 않는다** */
  text: string;
  scope: PromptScope;
  /** 언제 노출되는가 (사람이 읽는 조건 서술) */
  trigger?: string;
  /** 답이 흘러들어가는 필드 */
  writesTo?: string;
  /** 특정 답에 대한 재질문. "0이요" → "정말 한 번도요?" */
  followUp?: { when: string; text: string };
};

/* ────────────────────────────────────────────────────────────────────────────
 * 5. 시드 업무 흐름
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 예외 경로. 지금은 각주 텍스트지만, 사용자가 "승격"을 누르면 명시 엣지가 된다
 * (SEED-CONTENT §E 스키마 매핑).
 */
export type ExceptionPath = {
  /** "10번 중 3번" — **존재가 아니라 빈도로 적는다** */
  frequency: string;
  /** 무슨 일이 벌어지는가 */
  what: string;
  /** 그래서 어디로 가는가 */
  then: string;
  /** 이 각주가 달린 단계 */
  atItemId?: string;
};

/**
 * 문서가 주장한 숫자. **테스트가 이것과 `derive()`의 실제 계산을 대조한다.**
 * 어긋나면 문서가 틀린 것이고, 그 목록이 이 작업의 가장 값진 산출물이다.
 */
export type SeedClaims = {
  /** SEED-CONTENT §A 표의 "단계" 열. 문서의 번호 행 수다 */
  numberedRows: number;
  /** "인계" 열 */
  handoffs: string;
  /** "대기 비중" 열. 미기재는 null */
  waitRatio: number | null;
  /** "도구" 열 */
  toolKinds: number;
};

export type SeedWorkflow = {
  /** 'FIN-01' */
  id: string;
  /** 직원이 실제로 쓰는 말투의 제목 */
  title: string;
  deptId: DeptId;
  /** 한 줄 설명. 미리보기 상단에 붙는다 */
  summary: string;
  /**
   * 인터뷰 대상자 역할. `createdBy`로 들어간다.
   * *"회사가 만든 문서"가 아니라 "우리 팀 ○○님이 적은 문서"* (§E 주의사항 2)
   */
  interviewedRole: string;
  items: readonly Item[];
  edges: readonly Edge[];
  exceptions: readonly ExceptionPath[];
  /** "드러나는 것" — 미리보기 하단에 붙는 관찰 문장들 */
  observations: readonly string[];
  claims: SeedClaims;
};

/* ────────────────────────────────────────────────────────────────────────────
 * 6. 접합 지도
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 접합의 한쪽 끝.
 * 시드 14개 밖을 가리키는 접합이 실재한다("FIN(급여)", "전 부서 문서") —
 * 그것도 사실이므로 지우지 않고 external로 표현한다. **고아 단계는 데이터다.**
 */
export type SeamRef =
  | { kind: 'seed'; workflowId: string; itemIds: readonly string[] }
  | { kind: 'external'; label: string };

export type Seam = {
  /** 'J-01' */
  id: string;
  upstream: SeamRef;
  downstream: readonly SeamRef[];
  /** 조인 키 = 산출물. 매칭 신호 ① */
  artifact: string;
  /** 상류와 하류가 서로 다르게 알고 있는 것 */
  mismatch: string;
  /** 이 접합이 킥오프 데모에서 특별히 중요한 이유 */
  highlight?: string;
};

/** 킥오프 데모용 체인 */
export type SeamChain = {
  id: string;
  name: string;
  /** 흐름 ID 순서 */
  workflowIds: readonly string[];
  note: string;
};
