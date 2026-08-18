# 패키지

전부 **순수 함수 패키지**다. React·DB·DOM·타이머를 쓰지 않고, 그 사실이 `tsconfig`의
`lib: ["ES2022"]` + `types: []`로 **타입 시스템에 의해 증명**된다. DOM 전역을 건드리는 순간
컴파일이 깨진다.

앱 계층(`apps/web`)은 아직 없다. 여기 있는 것은 **그 아래에 깔릴 계산 계층**이다.

8개 패키지, 테스트 784건.

## 데이터가 흐르는 순서

```
   붙여넣은 글 ─────────────┐
                            ▼
                    ┌───────────────┐
                    │  paste-parse  │  원문 위 스팬만 다룬다. 무손실
                    └───────┬───────┘
                            │ Item[]
   질문 연쇄·직접 입력 ─────┤
                            ▼
        ┌──────────────────────────────────────┐
        │            graph-core                │  ← 이 저장소의 심장
        │  derive(tree) ⊕ overrides            │
        │  + ops/  (op 25종 · 교환성 · 3-way)  │
        └───┬──────────┬──────────┬────────────┘
            │          │          │
   ┌────────▼───┐ ┌────▼─────┐ ┌──▼────────┐
   │ layout-core│ │ doc-gen  │ │  scoring  │
   │  좌표      │ │ 인계문서 │ │ 자동화후보│
   └────────────┘ └──────────┘ └───────────┘

   sync-protocol      op 와이어 스키마 (zod)
   analytics-schema   이벤트 스키마 (zod)
   seed               첫 화면에 넣을 실제 콘텐츠
```

## 목록

| 패키지 | 하는 일 | 런타임 deps | 테스트 |
|---|---|---|---|
| [`graph-core`](./graph-core) | 트리 → 그래프 파생, op 리듀서 | **0** | 378 |
| [`layout-core`](./layout-core) | 파생 그래프 → 좌표. 앵커링·사이클 라우팅 | graph-core | 107 |
| [`seed`](./seed) | 시드 흐름 14 · 도구 78 · 칩 42 · 접합 19 | **0** | 86 |
| [`scoring`](./scoring) | Value·Feasibility·Confidence · ECRS 12종 | **0** | 68 |
| [`paste-parse`](./paste-parse) | 붙여넣기 파싱. 한국어 절 분할 | **0** | 59 |
| [`doc-gen`](./doc-gen) | 인수인계 문서 생성 | **0** | 48 |
| [`sync-protocol`](./sync-protocol) | op 와이어 스키마 | zod | 19 |
| [`analytics-schema`](./analytics-schema) | 이벤트 스키마 | zod | 19 |

## 왜 이렇게 나눴나

**`graph-core`의 `dependencies: {}`는 영구 계약이다** (D-119). zod를 넣고 싶어진 적이 두 번
있었고 두 번 다 별도 패키지로 뺐다 — `sync-protocol`, `analytics-schema`가 그 결과다.
무언가를 넣고 싶어지면 **그건 이 패키지에 들어갈 코드가 아니다.**

**`layout-core`는 `elkjs`를 물지 않는다.** `ElkNode`를 구조적 타입으로만 취급한다.
테스트가 워커 없이 돌고, OG 이미지 라우트에 500KB가 안 들어오며, ELK를 교체할 때
건드릴 파일이 `build.ts`/`read.ts` 둘뿐이다.

## 전부 검증하기

```bash
npm install
npm test          # 784건
npm run typecheck # 순수성 증명
node scripts/gates.mjs      # 배포 차단 게이트 17종
node scripts/doc-numbers.mjs # 문서 숫자가 실제와 맞는지
```

게이트는 **자기 자신도 검사한다.** 규칙이 아무것도 못 잡으면 게이트가 스스로를 실패시킨다
(D-100). 방어하는 척하면서 아무것도 안 막는 것이 방어가 없는 것보다 나쁘기 때문이다.
