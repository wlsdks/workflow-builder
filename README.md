# workflow-builder

> 가칭 · 이름 후보는 [PRD §5.4](./docs/PRD.md) (유력: **Preflow**)

**직원은 "설명하지 않아도 되는 업무 문서"를 얻고, 회사는 "직원이 직접 만든 자동화 백로그"를 얻는다.**

n8n·Zapier를 열기 전에 필요한 것 — 비개발자가 자기 업무 흐름을 적으면 다이어그램이 자동 생성되고, 어디를 자동화(혹은 **제거**)할지 드러나는 도구.

---

## 어디부터 읽을까

문서가 26개 37,000줄이다. **다 읽지 마라.** 온 이유에 맞는 경로만 따라가면 된다.

### 개발자가 아니라면 — [report/기획서.pdf](./report/기획서.pdf)

**저장소를 열지 마라.** A4 24쪽짜리 기획서 한 편이 처음부터 끝까지 읽도록 쓰여 있다 —
무슨 문제인가 → 그래서 뭘 하려는가 → 화면이 어떻게 생겼나 → 왜 그렇게 정했나 →
어떻게 실패하나 → 지금 어디까지 왔나. **개발 용어 없이, 실제 화면 그림과 함께.**
경영진·HR·협업 상대에게 건넬 것은 이것 하나다. ([만드는 법](./report/README.md))

### 처음이라면 — 10분

**[docs/OVERVIEW.md](./docs/OVERVIEW.md)** 한 장이면 무슨 제품인지, 왜 이렇게 만들었는지, 어떻게 죽는지 다 나온다.

### "왜 이렇게 정했나"가 궁금하면 — 30분

| | |
|---|---|
| [DECISIONS.md](./docs/DECISIONS.md) | **결정 79건.** 각 항목에 *"뒤집는 조건"*이 붙어 있다 — 그게 비어 있는 결정은 무엇을 가정하는지 모른다는 뜻이므로 |
| [TRUST.md](./docs/TRUST.md) | 이 제품의 헌법. **"부서별로 좀 보면 안 되나" 응답 스크립트**가 여기 있다 |

### 개발을 시작한다면 — 순서대로

```
1. ROADMAP.md      스파이크 6건 → 첫 주 시간표. 여기서 시작한다
2. SCHEMA.md       DB. 여기가 신뢰 약속을 강제하는 곳
3. GRAPH-CORE.md   이미 구현돼 있다. 읽고 테스트를 돌려봐라
4. EDITOR.md       M1 최대 미지수
5. SYNC.md         되돌리기 가장 비싼 영역
6. LAYOUT.md       "마법의 순간"의 실체
```

### 디자인을 한다면

`DESIGN.md` → `COMPONENTS.md` → `SCREENS.md` → `WRITING.md` → `ACCESSIBILITY.md`

**`WRITING.md`를 건너뛰지 마라.** 이 제품에서 문구는 장식이 아니라 생존 조건이다.

### 도입·영업이라면

`PRD §5`(경쟁·포지셔닝) → `SEED-CONTENT.md`(시드 14개·자동화 후보) → `MEASUREMENT.md §6`(파일럿) → `SECURITY.md`(보안 실사 대응)

---

## 문서 전체

<details>
<summary><b>무엇을 왜 만드는가</b> — 4개</summary>

| | |
|---|---|
| [OVERVIEW.md](./docs/OVERVIEW.md) | **10분 요약.** 여기서 시작 |
| [PRD.md](./docs/PRD.md) | 문제 정의, 사용자, 핵심 설계, 경쟁·포지셔닝, 로드맵, 지표, 리스크 |
| [DECISIONS.md](./docs/DECISIONS.md) | 결정 79건 + 기각 23건. 무엇을 왜 정했고 **어떤 신호가 오면 다시 열지** |
| [TRUST.md](./docs/TRUST.md) | 신뢰 헌장 — 절대 원칙 4개, 아키텍처 강제, 관리자 요구 응답 스크립트 |

</details>

<details>
<summary><b>어떻게 보이고 들리는가</b> — 5개</summary>

| | |
|---|---|
| [DESIGN.md](./docs/DESIGN.md) | 원칙 5개, 톤앤매너, 컬러(**대비 실측 검증**), 한글 타이포, 다이어그램 스펙, 모션 |
| [COMPONENTS.md](./docs/COMPONENTS.md) | 컴포넌트 16개, `tailwind.config`, `globals.css`, 아이콘·포커스 |
| [SCREENS.md](./docs/SCREENS.md) | 화면 7개 와이어프레임, 상태 전이, 반응형, **첫 60초 시나리오** |
| [WRITING.md](./docs/WRITING.md) | **금지어 41개**, 용어 확정표, 마이크로카피 전량, 인사팀 공지문 |
| [ACCESSIBILITY.md](./docs/ACCESSIBILITY.md) | 키보드 맵, **캔버스 접근성 정본 설계**, 한국어 IME, 40~50대 배려 |

</details>

<details>
<summary><b>실제로 어떻게 동작하는가</b> — 7개</summary>

| | |
|---|---|
| [GRAPH-CORE.md](./docs/GRAPH-CORE.md) | `derive()` 명세 — **모호성 16종 확정 규칙**, 사이클, AND/XOR 계산식. [구현 있음](./packages/graph-core) |
| [PARSING.md](./docs/PARSING.md) | 붙여넣기 파싱 — 한국어 연결어미 절 분할, **무손실 3중 방어** |
| [EDITOR.md](./docs/EDITOR.md) | BlockNote 커스텀 스키마, 어댑터, **IME 구현 + CDP 회귀 테스트** |
| [SYNC.md](./docs/SYNC.md) | op 정의, **교환성 17×16 표**, 3-way merge, 멀티탭, 오프라인 |
| [LAYOUT.md](./docs/LAYOUT.md) | **앵커링 대수적 증명**, 사이클 사이드레일, `layoutKey`, 내보내기 |
| [ASSEMBLY.md](./docs/ASSEMBLY.md) | 조직 조립 — 접합 소켓, 한국어 유사도, **불일치 13종**, 바이럴 루프 |
| [HANDOVER.md](./docs/HANDOVER.md) | 인수인계 문서 생성 — **결핍을 질문으로 뒤집기**, 묶음 앞 8쪽 |

</details>

<details>
<summary><b>어떻게 견디는가</b> — 5개</summary>

| | |
|---|---|
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 스택, 데이터 모델, 에디터 선택, 성능, 인증 |
| [SCHEMA.md](./docs/SCHEMA.md) | 전체 Drizzle 스키마, **RLS 우회 16종 차단**, k-익명 뷰 통합 |
| [STATES.md](./docs/STATES.md) | 자동 저장·오프라인 전 상태, **스피너 없는 로딩**, 에러 바운더리 |
| [SECURITY.md](./docs/SECURITY.md) | 데이터 등급, 국내 법령, 암호화 판단, 사고 대응, **AI 선긋기** |
| [POLICY.md](./docs/POLICY.md) | 권한·공유·알림·콘텐츠·소유권·분쟁·요금, **직원용 약속 카드** |

</details>

<details>
<summary><b>어떻게 시작하는가</b> — 5개</summary>

| | |
|---|---|
| [ROADMAP.md](./docs/ROADMAP.md) | 일정 재추정, **스파이크 6건**, 배포 차단 46종, 첫 주 시간표 |
| [SEED-CONTENT.md](./docs/SEED-CONTENT.md) | 시드 워크플로 14개, **접합 지도**, 칩 42개, 자동화·제거 후보 |
| [TOOLS.md](./docs/TOOLS.md) | 도구 카탈로그(동의어·자동화 연결성), 예외 프롬프트 뱅크 |
| [MEASUREMENT.md](./docs/MEASUREMENT.md) | 이벤트 택소노미, k-익명성 SQL, 퍼널 3종, **파일럿 A/B** |
| [ANALYTICS-ENGINE.md](./docs/ANALYTICS-ENGINE.md) | 특징 추출, Feasibility 6요소, **ECRS 12종**, n8n export |

</details>

---

## 코드

**[packages/](./packages)** — 순수 함수 패키지 8개, 테스트 784건. 데이터가 흐르는 순서와 왜 이렇게 나눴는지는 [패키지 지도](./packages/README.md)에 있다.

| | 하는 일 | deps | 테스트 |
|---|---|---|---|
| [`graph-core`](./packages/graph-core) | 트리 → 그래프 파생, op 리듀서 | **0** | 378 |
| [`layout-core`](./packages/layout-core) | 파생 그래프 → 좌표. 앵커링·사이클 라우팅 | graph-core | 107 |
| [`seed`](./packages/seed) | 시드 흐름 14 · 도구 78 · 칩 42 · 접합 19 | **0** | 86 |
| [`scoring`](./packages/scoring) | Value·Feasibility · ECRS 12종 | **0** | 68 |
| [`paste-parse`](./packages/paste-parse) | 붙여넣기 파싱. 한국어 절 분할 | **0** | 59 |
| [`doc-gen`](./packages/doc-gen) | 인수인계 문서 생성 | **0** | 48 |
| [`sync-protocol`](./packages/sync-protocol) | op 와이어 스키마 | zod | 19 |
| [`analytics-schema`](./packages/analytics-schema) | 이벤트 스키마 | zod | 19 |

앱 계층(`apps/web`)은 아직 없다. 위는 **그 아래에 깔릴 계산 계층**이다.

```bash
npm install
npm test                 # 784건
npm run typecheck        # 순수성이 타입으로 증명된다
node scripts/gates.mjs   # 배포 차단 게이트 17종
```

---

## 이 저장소를 읽을 때 알아두면 좋은 것

**결정에는 "뒤집는 조건"이 붙어 있다.** 79건 전부. 비어 있으면 그건 위험 신호로 취급한다 — 무엇을 가정하는지 모른다는 뜻이므로.

**"안 하겠다"를 정책이 아니라 구조로 만든다.** 반복해서 나타나는 설계 패턴이다.

| 약속 | 구조적 강제 | 지금 |
|---|---|---|
| 이벤트에 값이 안 담긴다 | zod `.strict()` — 그 필드가 스키마에 **없다** | ✅ [`analytics-schema`](./packages/analytics-schema) |
| 비공개 노트는 안 나간다 | 렌더 트리에 있으면 **빌드 실패** | ✅ [`doc-gen`](./packages/doc-gen) |
| `graph-core`에 의존성이 안 붙는다 | `dependencies: {}` + eslint + `types: []` | ✅ [게이트](./scripts/gates.mjs) |
| 관리자는 개인 문서를 못 본다 | `resolveDocumentAccess()`가 `org_members`를 인자로도 안 받는다 | ⬜ **서버 없음** |
| 매칭은 원문을 보지 않는다 | `SocketFeature` 타입에 원문 필드가 없다 | ⬜ **미착수** |
| 조직 RAG로 검색 우회 불가 | 인덱스를 스키마에 안 만든다 | ⬜ **DB 없음** |

> ⬜ 세 줄은 **아직 설계일 뿐 코드가 아니다.** 그 코드를 담을 서버·DB 계층이 없다.
> 게이트에 규칙(`no-org-members-in-doc-access`)은 이미 넣어뒀지만, 지킬 대상이 생기기 전까지
> 그 규칙은 **아무것도 막고 있지 않다.**

정책 문서는 잊히지만 타입에 없는 필드는 6개월 뒤에도 없다 — **그 타입을 실제로 썼을 때의 이야기다.**

**게이트를 만들 때는 게이트가 살아 있는지 검증하는 테스트를 함께 넣는다** (D-100). 같은 실패를 세 번 겪고 세운 원칙이다 — 규칙이 존재하고, 초록이고, 아무것도 안 막는 상태가 방어가 없는 것보다 나쁘다.

---

## 상태

**기획 완료 · 계산 계층 구현 완료 · 앱 계층 착수 전.**

| | |
|---|---|
| 문서 | 26개 · 37,372줄 |
| 코드 | 8패키지 · 32,160줄 · 테스트 784건 |
| 결정 | 79건 채택 · 23건 기각 |
| 없는 것 | **`apps/web` 전체.** 사용자가 실제로 쓸 수 있는 화면은 아직 없다 |

지금 돌아가는 것은 계산 계층뿐이다 — 트리를 그래프로 파생하고, 붙여넣은 글을 단계로 쪼개고,
좌표를 계산하고, 인수인계 문서를 만들고, 자동화 후보를 점수화한다. 전부 함수 호출로만 확인된다.

### 이 문서들이 어떻게 만들어졌는지

**사람 저자 1명 + Claude.** 21개의 서로 다른 **역할 관점**으로 나눠 검토를 반복했다 —
PM · 조직 도입 · UX 리서치 · BPM · 시장 분석 · 아키텍처 · 비주얼 디자인 · 정보 시각화 ·
UX 라이팅 · 화면 설계 · 컴포넌트 · 시드 콘텐츠 · 접근성 · 애널리틱스 · 파싱 ·
그래프 알고리즘 · 문서 생성 · 엔티티 레졸루션 · 보안 거버넌스 · 제품 정책 · 실행 계획.

**외부 전문가가 개별적으로 검토한 것이 아니다.** 각 관점에 독립 컨텍스트를 주고 서로의
결론을 모른 채 판단하게 한 뒤, 충돌 지점을 사람이 판정했다. 그 판정 근거가
[DECISIONS.md](./docs/DECISIONS.md) 79건이다.

이 방식의 한계도 적어둔다 — **관점이 아무리 많아도 같은 모델의 같은 편향을 공유한다.**
그래서 검증 가능한 것은 전부 코드로 옮겼다. 명세가 틀렸다는 것을 **구현이 반증한 사례**가
지금까지 24건이고, 전부 테스트로 고정돼 있다(`git log` 참조). 이건 관점을 늘려서가 아니라
**실행해봐서** 나온 것들이다.
