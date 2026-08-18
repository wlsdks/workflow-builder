# graph-core 명세 — `derive()` / `validate()` / 골든 픽스처

> **`caseShare` 추가 (2026-08-18)** — 갈래 비중을 명시할 수 있다. 없으면 종전대로 균등 분할.
> 실측: CS-01 구조(5갈래, 실제 45/26/17/10/2%)에서 균등 분할은 실접촉시간을 **37.3% 과대 계산**한다.
> 구현 함정 하나 — **갈래 컨테이너는 노드가 되지 않는다.** 엣지가 갈래 안 첫 단계를 직접 가리키므로
> `e.target`이 아니라 `e.caseItemId`로 원본 아이템을 찾아야 한다. `e.target`으로 읽으면 언제나
> `undefined`가 나오고 **조용히 균등 분할로 되돌아간다.** 테스트가 이 실수를 고정한다.

> 최종 갱신: 2026-08-17 · 상태: v1.0 (구현 완료 · 골든 픽스처 36건 + 테스트 57건 통과)
> 구현: [`packages/graph-core/`](../packages/graph-core) · 관련 결정: D-030 · D-031 · D-033 · D-038

```
graph = derive(tree) ⊕ overrides
```

이 문서는 **산문 명세**이고, 진짜 명세는
[`src/__fixtures__/golden.ts`](../packages/graph-core/src/__fixtures__/golden.ts)의
픽스처 36건이다. 둘이 어긋나면 픽스처가 이긴다.

**검증 상태**

```
$ node --test "packages/graph-core/test/*.test.ts"
ℹ tests 57   ℹ suites 7   ℹ pass 57   ℹ fail 0

$ tsc --noEmit -p tsconfig.json        # lib에 DOM 없음, types: []
(에러 없음)                              → 순수성이 타입 시스템으로 증명됨
```

---

## 0. 이 문서가 존재하는 이유

ARCHITECTURE §8이 지목한 **최대 리스크 1번**이 여기 있다.

> **변환 규칙의 의미론적 모호성** — "갈래의 마지막 단계"가 중첩 분기·빈 갈래·조기
> 종료에서 애매. 의도와 그림이 어긋나면 신뢰가 즉시 무너짐

그래서 이 문서의 무게중심은 §1의 알고리즘이 아니라 **§3의 애매 케이스 표**다.
16개 케이스 각각에 대해 "무엇을 하는가"와 **"왜 그쪽을 골랐는가"**가 적혀 있고,
전부 골든 픽스처로 고정되어 있다.

---

## 1. `derive()` 완전 명세

### 1.1 시그니처

```ts
export function derive(
  items: readonly Item[],
  edges: readonly Edge[],
  options: DeriveOptions = {},
): DerivedGraph;
```

**계약 4가지**

| | |
|---|---|
| 전역 함수(total) | 어떤 입력에도 예외를 던지지 않는다. 반환하지 않는 경로가 없다 |
| 순수 | `Date.now()` · `Math.random()` · 전역 상태 없음. 입력을 변형하지 않는다 |
| 결정적 | **입력 배열의 순서에 의존하지 않는다.** Yjs 병합 후 재계산에서 결정적 |
| 무상태 | 캐시·메모이제이션 없음. 이전 호출을 기억하지 않는다 |

세 번째가 특히 중요하다. `items`가 어떤 순서로 오든 같은 그래프가 나와야 한다 —
안 그러면 같은 문서가 사람마다 다르게 그려진다. 테스트로 강제한다
(`입력 배열 순서에 의존하지 않는다`, 36개 픽스처 전부 역순 입력으로 재검증).

### 1.2 입력 전처리 — 전부 "복구"다

[`src/preprocess.ts`](../packages/graph-core/src/preprocess.ts). 어떤 입력도 거절하지 않는다.

| # | 단계 | 이상 입력 처리 | 진단 코드 |
|---|---|---|---|
| 1 | 중복 ID 제거 | `(sortKey, id)` 최소 행만 남긴다 (입력 순서 무관) | `duplicate-item-id` |
| 2 | tombstone 제거 | `deletedAt != null` 행 제외 | — |
| 3 | 예약 ID 침범 | `start`/`end`/`join:`/`fork:` 와 충돌하는 항목은 트리에서 제외 | `reserved-item-id` |
| 4 | 부모 해석 | 없는/삭제된 부모 → **루트로 승격** (내용을 버리지 않는다) | `orphan-parent` |
| 5 | 부모 사이클 | 사이클 내 **최소 ID**를 루트로 절단 (결정적) | `parent-cycle` |
| 6 | 형제 정렬 | `sortKey` 바이트 비교(`COLLATE "C"`), 동률은 `id`로 tie-break | `duplicate-sort-key` |
| 7 | 역할 부여 | 아래 교대 규칙 | — |

> **`localeCompare`를 쓰지 않는다.** Postgres 기본 collation(`en_US.UTF-8`)은 바이트
> 순서가 아니고, JS의 `localeCompare`도 아니다. `sort_key`에 `COLLATE "C"`를 붙이고
> JS에서는 `<` 연산자(UTF-16 코드 유닛 순서)를 쓴다. base62 문자 집합에서 둘은 동일하다.
> 이걸 틀리면 **정렬이 조용히 어긋난다** — 가장 나쁜 종류의 버그다.

### 1.3 역할 = 위치. kind가 아니다

데이터 모델에는 "갈래(case)"라는 타입이 없다. 노드 타입은 3개로 고정이기 때문이다(D-005).
그래서 역할을 **위치의 교대 규칙**으로 정의한다.

```
isCase(x) ⟺ parent(x) ≠ null ∧ parent(x).kind = 'branch' ∧ ¬isCase(parent(x))
```

읽으면 이렇다.

- 분기의 자식 = **갈래**
- 갈래의 자식 = **본문 단계**
- 본문 단계가 분기면 → 그 자식이 다시 갈래

이 한 줄이 §3 A1(중첩 분기)을 특별 취급 없이 해결한다. 그리고 갈래 컨테이너의
`kind`가 `'branch'`든 `'task'`든 결과가 같아서, 에디터·파서·AI가 무엇을 넣든
견딘다.

**갈래는 노드가 되지 않는다.** 조건 라벨은 엣지 라벨로 나간다 (DESIGN §6.4의 pill).

### 1.4 알고리즘

핵심 자료구조는 하나뿐이다.

```ts
type Tail = { from: NodeId; reason: EdgeReason; label?: string; caseItemId?: string };

type Compiled = {
  head: NodeId | null;   // 들어오는 엣지가 붙을 노드
  tails: Tail[];         // 열린 끝. 다음이 붙으면 여기서 나간다
  fallbackFrom?: NodeId; // 불변식: tails가 비면 반드시 설정된다
};
```

**"갈래의 마지막 단계"의 정확한 정의가 `tails`다.** 단수형 "마지막 단계"가 애매했던
이유는 그게 실제로는 **집합**이기 때문이다. 중첩 분기의 tails는 안쪽 갈래들의 tails
합집합이고, 몇 겹이든 같은 규칙이 적용된다.

`fallbackFrom` 불변식이 §3 A7을 보장한다 — **어떤 경우에도 고립된 노드가 생기지 않는다.**

```
compileSequence(list)                        // 규칙 (a)
  prev = null
  for p in list:
    cur = compileStep(p)
    if prev.tails ≠ ∅ : prev.tails 각각 → cur.head
    else if prev.fallbackFrom: fallbackFrom → cur.head  (reason 'fallthrough')
    prev = cur
  return { head: 첫 head, tails: prev.tails, fallbackFrom: prev.fallbackFrom }

compileStep(p)
  p.kind = 'branch' → compileBranch(p)
  else               → 노드 생성; 자식이 있으면 하위 시퀀스로 이어붙임 (reason 'subtree')

compileBranch(b)                             // 규칙 (b)(c)
  cases = ∅        → 일반 단계로 강등              (A8)
  mode = 'and' ∧ |cases| ≥ 2 → join:{b} 실체화     (§6)
  그 외 (xor / skip / 단일 and):
    각 갈래에 대해
      본문이 비면      → 라벨 붙은 통과 tail        (A2)
      joinBehavior='end' → 본문 tails를 end로       (A7 부분)
      아니면            → 본문 tails를 바깥 tails로
    mode='skip'이면 → 암묵적 else tail 추가         (A12)

루트
  head = null → start → end
  else        → start → head ; tails → end
```

오버레이는 **파생이 끝난 뒤** 적용한다. 순서가 고정되어 있다.

```
1) suppressed  : (source, target)이 일치하는 파생 엣지 제거
2) explicit    : 엔드포인트 해석 → 추가. 파생 엣지와 중복이면 명시가 이긴다
```

이 순서여야 "자동 연결을 끄고 내가 그린 걸 넣는다"가 한 번에 성립한다.

### 1.5 출력

```ts
type DerivedGraph = {
  nodes: readonly DerivedNode[];      // 정규 순서 (start → 문서 pre-order → end)
  edges: readonly DerivedEdge[];      // ★ 이 배열 순서가 곧 ELK model order
  byId / outgoing / incoming;         // 인덱스
  acyclic: { topoOrder; backEdgeIds }; // ELK에 넘길 DAG (§5)
  metrics: Metrics;                   // §7
  diagnostics: readonly Diagnostic[]; // §4 — 오류가 아니다
  topologyHash: string;               // 구조만. 제목·시간·확률 제외 → 레이아웃 게이트
  contentHash: string;                // 라벨·메타 포함 → 렌더 게이트
};
```

**`edges` 배열의 순서는 그냥 정렬이 아니다.** `elk.layered.considerModelOrder`가
이 순서를 갈래의 좌우 배치로 쓴다. 정렬 키는

```
1차: source의 정규 순서
2차: 갈래 항목의 문서 순서   ← ★ target 순서가 아니다
3차: target의 정규 순서
4차: edge id
```

2차 키가 target이면, 빈 갈래(본문 없는 갈래)처럼 target이 훨씬 뒤 노드가 되는 경우
**사용자가 첫 번째로 쓴 갈래가 화면 오른쪽 끝으로 밀린다.** DESIGN §6.5의
"정상 경로를 항상 최좌측"이 이 한 줄에 걸려 있다 (픽스처 08).

### 1.6 시간 복잡도

| 단계 | 복잡도 |
|---|---|
| 전처리 | **O(n log n)** — 형제 정렬만이 로그 항 |
| 컴파일 | O(n) — 항목당 정확히 1회 방문 |
| 오버레이 | O(m·d) 최악, 실무에선 O(m + d) (m = edges 행, d = 파생 엣지) |
| 사이클 | O(V + E) DFS + back edge당 BFS 1회 → **O(B·(V+E))**, B = back edge 수 |
| 메트릭 | O(V + E) — 위상 정렬 1회 + 전향 DP 1회 + 후향 DP 1회 |
| **전체** | **O(n log n + B·(V+E))** — B ≤ 5인 실무 범위에서 사실상 O(n log n) |

공간 O(n).

**실측** (Node 24, 20회 평균)

| items | 노드 | 엣지 | 시간 |
|---|---|---|---|
| 50 | 46 | 50 | 0.27 ms |
| 205 | 183 | 199 | 0.64 ms |
| 504 | 448 | 487 | **1.54 ms** |
| 2000 | 1771 | 1925 | 5.75 ms |

ELK 한 번이 50~1500ms다. **파생은 레이아웃의 1000분의 1이다** — 이 숫자가 §8의
"증분화하지 않는다"를 결정한다.

---

## 2. 자동 생성 노드의 결정적 ID

[`src/ids.ts`](../packages/graph-core/src/ids.ts)

```ts
START_ID = 'start'
END_ID   = 'end'
joinNodeId(branchItemId) = `join:${branchItemId}`
forkNodeId(branchItemId) = `fork:${branchItemId}`   // 별칭 전용, 노드를 만들지 않는다
derivedEdgeId(reason, src, tgt, caseItemId?)
  = `e:${reason}:${src}->${tgt}` (+ `#${caseItemId}`)
```

### 불변식 3개

**I1. ID는 `items.id`(클라이언트 발급 UUID)와 고정 리터럴로만 구성된다.**
인덱스·깊이·정렬키·제목·해시·타임스탬프가 ID에 들어가지 않는다.

**I2. 따라서 트리의 어느 부분이 바뀌어도 무관한 노드의 ID는 바뀌지 않는다.**
형제를 삽입·삭제·이동해도 `sortKey`만 바뀌고 ID에는 닿지 않는다. 갈래를 추가하거나
전부 지웠다 다시 만들어도 `join:{b}`는 그대로다 (테스트: `AND 합류 노드 ID는
갈래 편집과 무관하게 분기 항목 ID에서만 나온다`).

**I3. 예약 네임스페이스와 사용자 UUID는 충돌할 수 없다.** UUID에는 `:`가 없고
`'start'`/`'end'`와 같을 수 없다. 그럼에도 마이그레이션·수기 시드·AI 생성 데이터를
위해 방어적으로 검사하고, 충돌하면 그 **항목을** 제외한다 — 예약 ID가 사용자 데이터에
밀려나면 start/end/join의 결정성이 통째로 무너지기 때문이다 (픽스처 29).

### 왜 fork 노드를 만들지 않는가

**분기 항목 자체가 AND-split이다.** 사용자가 "동시에 진행"이라고 쓴 그 카드가 곧
fork다. 노드를 하나 더 만들면 사용자는 "내가 안 쓴 상자가 왜 생겼지"만 얻는다.
`fork:{b}`는 익스포터·역투영이 "분기점"을 지칭할 수 있게 하는 **정규 별칭**으로만
존재하고, 항상 분기 항목 노드로 해석된다.

### 왜 XOR에는 join 노드를 만들지 않는가

XOR 합류는 **동기화가 아니다.** 그냥 "여러 길이 같은 곳으로 간다"이고, 그것은
"그 노드에 들어오는 엣지가 여럿"으로 이미 완전히 표현된다. 노드를 만들면
비개발자 화면에 의미 없는 상자가 하나 늘 뿐이다.

AND는 다르다. **"모두 끝나야 다음"이라는 동기화 지점이 없으면 `max(각 갈래)`를
계산할 자리가 없다.** 그래서 AND에만 join을 실체화한다 — 그림 때문이 아니라 숫자 때문이다.

`join:{b}`는 실체화 여부와 무관하게 **항상 합법 주소**다. 실체화되지 않았으면
분기 노드로 해석하고 진단을 남긴다 (픽스처 33).

---

## 3. 애매한 경우 16건 — 확정 규칙과 근거

**이 표가 이 문서의 핵심이다.** 각 행은 골든 픽스처 1건 이상으로 고정되어 있다.

관통하는 원칙 3개를 먼저 적는다. 개별 판단은 전부 여기서 파생됐다.

> **P1. 내용을 버리지 않는다.** 위치 오류는 되돌릴 수 있고 내용 손실은 되돌릴 수 없다.
> **P2. 연결된 그래프를 만든다.** 떠 있는 노드는 사용자에게 "고장"으로 읽히고, 그 판단은 되돌릴 수 없다.
> **P3. 조용한 실패보다 시끄러운 복구.** 단, "시끄러움"은 오류 표시가 아니라 **엣지 호버 설명**이다.

| # | 상황 | 확정 규칙 | 근거 | 픽스처 |
|---|---|---|---|---|
| **A1** | **중첩 분기** (갈래 안에 또 갈래) | "갈래의 마지막 단계"는 단수가 아니라 **열린 끝의 집합(tails)**이다. 중첩 분기의 tails = 안쪽 갈래들의 tails 합집합. 재귀적으로 동일 규칙 | 단수형 정의가 애매했던 이유가 바로 이것이다. 집합으로 정의하면 깊이에 무관하게 규칙이 하나로 유지된다. 역할 교대 규칙(§1.3)이 "어디까지가 갈래인가"를 위치만으로 결정해준다 | 11, 13, 36 |
| **A2** | **빈 갈래** (조건만 적고 단계 없음) | 노드를 만들지 않는다. **조건 라벨이 붙은 통과 엣지**가 분기 → 합류점으로 간다 | 빈 상자를 그리면 사용자는 "내가 뭘 빠뜨렸다"고 읽는다. 실제로는 "그 경우엔 아무것도 안 한다"가 **완결된 의미**다. 다이어그램이 그 의미를 그대로 보여줘야 한다 | 08 |
| **A3** | **갈래가 1개뿐인 분기** | 위상을 유지한다. "라벨 붙은 사슬"이 된다. `note` 진단만 | (1) 두 번째 갈래를 지금 쓰는 중일 수 있다 (2) 노드를 없애면 그 ID가 사라져 코멘트·좌표·접기 상태가 날아간다 (3) 조건 라벨은 정보다 | 09, 15, 18 |
| **A4** | **갈래의 마지막이 또 다른 분기** | 안쪽 분기의 **모든** 열린 끝이 바깥 합류점으로 간다 | A1과 같은 규칙의 다른 얼굴. tails가 집합이라는 정의가 여기서 값을 한다 | 13 |
| **A5** | **갈래의 마지막이 `hold`** | 특별 취급하지 않는다. hold도 그냥 단계다 | "승인 대기 뒤에는 승인/반려 두 갈래가 있어야 한다"는 것은 BPMN의 사고방식이다. 사용자가 반려 경로를 안 적었다면 그 사람 업무에 반려가 드물거나 별도 흐름이다. **없는 갈래를 지어내지 않는다.** 반려를 끌어내는 건 문법이 아니라 질문의 일이다(PRD §4.6) | 12, 36 |
| **A6** | **분기가 문서의 마지막 형제** (합류할 다음 형제 없음) | 갈래의 tails가 `end`로 간다. **`end`가 곧 합류점이다** | 자동 생성 종료 노드를 두는 이유의 절반이 이것이다. 특수 케이스를 만들지 않고 같은 코드 경로로 처리된다 | 05, 17, 19 |
| **A7** | **`joinBehavior`가 갈래마다 다름** | 갈래별로 독립 적용. `continue`는 합류, `end`는 `end`로. **한 분기 안에 공존하는 것이 정상이다** | 실무에서 가장 흔한 모양이다 — "통과 → 계속 / 반려 → 여기서 끝". 분기 단위 플래그였다면 이 흔한 케이스를 못 그린다 | 06 |
| **A7′** | **모든 갈래가 `end`인데 뒤에 형제가 있음** | 고립시키지 않는다. **분기 노드에서 직접 잇는다**(reason `fallthrough`) + `repaired` 진단 + 호버 설명 | 두 의도가 충돌하는 상황이다. 문서를 위에서 아래로 읽는 사람에게 "분기 뒤에 적은 것"은 "그 다음에 일어나는 것"이다. **P2에 따라 연결된 쪽을 택한다.** 떠 있는 노드는 "고장"으로 읽히고 그 판단은 되돌릴 수 없다 | 07 |
| **A8** | **분기에 자식이 없음** | 일반 단계로 강등해 이어붙인다. **노드는 남긴다** | 분기를 만든 직후 0.5초 동안 반드시 이 상태를 지난다. 그 순간 그림이 끊기면 "이 도구 이상하다"가 된다. 노드를 지우면 방금 만든 것이 사라져 보인다 | 10 |
| **A9** | **루트에 단계가 1개** | `시작 → 단계 → 끝`. 특수 처리 없음 | DESIGN §6.8 — "단계 1개여도 완결된 작은 문서로 보인다" | 02 |
| **A10** | **모든 단계가 tombstone** | 빈 문서와 **완전히 같은 그래프**(`start → end`) | "지웠는데 뭔가 남아 보이는" 상태를 만들지 않는다. 두 픽스처가 같은 결과를 내는지 테스트가 확인한다 | 01, 25 |
| **A11** | **`mode:'and'`인데 갈래가 1개** | 합류 노드를 만들지 않는다. XOR과 같은 모양 | 동기화할 대상이 없다. `max(단일) = sum(단일)`이라 **숫자도 동일하다.** 노드를 만들면 사용자는 "왜 여기 이상한 게 생겼지"만 얻는다 | 15 |
| **A11′** | **AND 갈래 중 일부만 `end`** | **`end`를 무시하고 합류시킨다** + `repaired` 진단 + 호버 설명 | 그대로 두면 합류 노드가 오지 않을 토큰을 영원히 기다리는 **교착**이 된다. 교착은 그림으로 안 보이고 숫자(리드타임 ∞)로만 터진다 — 가장 나쁜 조용한 실패다. 단 **전부** `end`면 교착이 아니므로 존중한다(합류 → `end`) | 16, 17 |
| **A12** | **`mode:'skip'`의 정확한 의미** | **skip = XOR + 암묵적 "해당 없음" 경로.** 건너뛰는 대상은 **그 분기에 매달린 갈래들**이다 | "분기 뒤의 형제를 건너뛴다"는 해석도 가능하지만 (a) 트리에 표현할 자리가 없고 (b) 사용자가 "건너뛰기"를 그렇게 쓰지 않는다. XOR과의 유일한 차이는 갈래 확률의 합이 1이 되도록 else가 자동으로 하나 붙는 것 — 그래서 갈래 1개짜리 skip의 기대 리드타임이 정확히 절반이 된다 | 18, 19 |
| **A13** | **명시적 엣지가 self-loop** | **유지한다.** 길이 1인 사이클 | "될 때까지 반복"은 실무 패턴이지 버그가 아니다. 캔버스는 별도 엣지가 아니라 노드 우상단 `↻` 배지로 렌더한다 — ELK layered의 self-loop 라우팅이 지저분하고 260×76 카드 옆에서 소음이 된다. `reworkRate`가 있으면 그 노드에만 `1/(1−p)`가 곱해진다 | 20 |
| **A14** | **명시적 엣지가 dangling** | 그래프에서 제외. **DB 행은 지우지 않는다** | tombstone 삭제라 복원이 가능하다. 행을 지우면 "삭제 취소"가 연결까지 되살리지 못한다. 오버라이드는 파생 결과와 무관하게 살아 있어야 한다 | 21 |
| **A15** | **`suppressed`가 파생되지 않은 엣지를 억제** | no-op. **행은 유지한다** | 순서를 되돌리면 그 파생 엣지가 다시 생기고, 그때 억제가 발효되어야 한다. 억제 행을 GC하면 "되돌리기 → 다시 되돌리기"에서 사용자의 결정이 증발한다. 사용자가 명시적으로 "정리"를 누를 때만 청소 후보로 제시 | 23 |
| **A16** | **사이클 (A→B→C→A)** | **정상이고 필수 기능.** 막지 않는다. §5 전체 | 재작업 루프가 자동화 ROI 1위다. 이건 이 제품이 프로세스 마이닝 대비 갖는 유일한 관측 우위이기도 하다 | 20, 24, 36 |

**추가로 확정한 3건** (질문 목록에는 없지만 실제로 온다)

| # | 상황 | 확정 규칙 | 근거 | 픽스처 |
|---|---|---|---|---|
| A17 | `task`/`hold`에 자식이 있음 | 평탄화가 아니라 **하위 시퀀스로 이어붙인다**(reason `subtree`) | 붙여넣기 파서·AI 초안·타 도구 아웃라인이 실제로 이 모양이다. "분기가 아닌 들여쓰기"의 가장 자연스러운 의미는 "그 안에서 이 순서로"다. D-004로 Tab을 분기 문법에서 뺐기 때문에 이 해석이 안전해졌다 | 28 |
| A18 | 명시적 엣지가 파생 엣지와 중복 | **명시가 이긴다.** 위상은 그대로 | 호버 문구가 "자동으로 이어졌어요"가 아니라 "직접 이으신 연결이에요"여야 한다. 사용자가 그은 선을 시스템이 그은 것처럼 설명하면 신뢰가 깨진다 | 33 |
| A19 | `sortKey` 충돌 | `id` 오름차순 tie-break | jittered fractional index에서도 약 1/47,000 확률로 온다. 입력 배열 순서에 의존하면 같은 문서가 사람마다 다르게 그려지고, Yjs 병합 후 재계산에서 특히 위험하다 | 35 |

---

## 4. `validate()` 명세

[`src/validate.ts`](../packages/graph-core/src/validate.ts)

```ts
export function validate(graph: DerivedGraph, options?: ValidateOptions): ValidationReport;
```

### 4.1 이 함수는 판정하지 않는다

BPMN이 비개발자에게 실패한 이유 중 하나가 well-formedness 검증과 오류 표시였다.

> **비개발자는 자기 그림이 문법 오류로 지적당하는 순간 손을 뗀다.**

그래서 이 제품에는 **"검증 실패"라는 상태가 없다.**

- `derive()`는 어떤 입력에도 그래프를 반환한다
- 모든 이상은 **컴파일 시점에 복구**된다
- `validate()`는 그 복구 내역을 **조회**할 뿐이다

`DiagnosticSeverity`에 `'error'`가 **타입 레벨에 존재하지 않는다.** 있는 것은
`'repaired'`(자동 복구함)와 `'note'`(관찰만 함) 둘뿐이고, 테스트가 이를 강제한다.

### 4.2 진단의 소비자는 셋뿐

| # | 소비자 | 무엇을 보나 |
|---|---|---|
| 1 | **캔버스 엣지 호버** | `userMessage !== null`인 진단 + 모든 엣지의 `reason` 설명 |
| 2 | CI 골든 픽스처 | 기대한 복구가 기대한 코드로 일어났는지 |
| 3 | AI 초안 검증기 | 생성된 아웃라인이 사람 손을 타기 전 서버에서 자기점검 |

**UI로 나가는 경로는 1번뿐이고, 그것도 오류가 아니라 설명이다.**
토스트·인라인 밑줄·저장 차단·빨간 배지로 가는 코드 경로를 만들지 않는다.
`Diagnostic.userMessage`가 `null`이면 그 진단이 사용자에게 도달하는 경로가
**존재하지 않는다** — 타입이 그것을 명시한다.

그리고 `validate()`는 **모든 엣지가 "왜 생겼는가"에 답할 수 있음**을 보장한다
(테스트로 강제). 자동 그래프의 오해석은 수동 드로잉보다 위험하기 때문이다(PRD §4.4).

### 4.3 복구 전략 — 케이스별 전체 목록

| 진단 코드 | 심각도 | 복구 | 사용자에게 |
|---|---|---|---|
| `duplicate-item-id` | repaired | `(sortKey, id)` 최소 행만 남김 | 표시 안 함 |
| `reserved-item-id` | repaired | 트리에서 제외 | 표시 안 함 |
| `orphan-parent` | repaired | 루트로 승격 | 표시 안 함 |
| `parent-cycle` | repaired | 최소 ID를 루트로 절단 | 표시 안 함 |
| `duplicate-sort-key` | note | id로 tie-break | 표시 안 함 |
| `branch-without-case` | repaired | 일반 단계로 강등, 노드 유지 | 표시 안 함 |
| `branch-single-case` | note | 그대로 | 표시 안 함 |
| `empty-case` | repaired | 라벨 붙은 통과 엣지 | 표시 안 함 |
| `and-single-case` | repaired | 합류 노드 미생성 | 표시 안 함 |
| `and-case-end-ignored` | repaired | 해당 갈래도 합류 | **엣지 호버**: "동시에 진행하는 갈래라, 이 갈래도 모두 끝나는 지점에서 합쳐요." |
| `all-cases-end-with-successor` | repaired | 분기 → 다음 형제 직결 | **엣지 호버**: "갈래가 모두 '여기서 끝'이라, 이 단계로 오는 길은 갈래를 타지 않는 경우로 그렸어요." |
| `task-with-children` | repaired | 하위 시퀀스로 연결 | 표시 안 함 |
| `dangling-edge` | repaired | 그래프에서 제외, 행 유지 | 표시 안 함 |
| `self-loop` | note | 유지 | **노드 호버**: "이 단계는 조건이 맞을 때까지 반복해요." |
| `suppress-noop` | note | 행 유지 | 표시 안 함 |
| `explicit-duplicates-derived` | note | 명시 우선 | 호버 문구가 "직접 이으신 연결이에요"로 바뀜 |
| `edge-into-start` / `edge-out-of-end` | repaired | 무시 | 표시 안 함 |
| `join-alias-unmaterialized` | repaired | 분기 노드로 해석 | 표시 안 함 |
| `cycle` | note | 유지 | **엣지 호버**: "되돌아가는 흐름이에요." |
| `unreachable-node` | note | 그대로 둠 | 표시 안 함 |
| `rework-rate-clamped` | repaired | p ≤ 0.95로 절단 | 표시 안 함 |
| `wait-estimated` | note | waitFor 기본값 사용 | 요약 카드의 **"대략"** 표기로만 |
| `duration-missing` / `assignee-missing` | note | — | 해당 렌즈·요약 항목을 **숨긴다** (0으로 표시하지 않는다) |

마지막 줄이 중요하다. 데이터가 없으면 **0을 지어내지 않고 항목을 숨긴다.**
"대기시간 0시간"은 거짓이고, 거짓 숫자 하나가 제품 신뢰도 전체를 깎는다.

### 4.4 의도적으로 검증하지 않는 것

| 하지 않는 검사 | 왜 안 하는가 |
|---|---|
| soundness / 적정성 (Petri net) | 사용자가 이해할 수 없고, 위반해도 그림은 멀쩡히 읽힌다 |
| 단일 진입·단일 출구 (SESE) | 자연어로 적은 업무는 원래 SESE가 아니다 |
| 교착·라이브락 | AND 갈래의 `end`는 이미 컴파일에서 무해화됨 (A11′) |
| 사이클 금지 | 사이클은 **핵심 기능**이다 (§5) |
| 도달 불가 노드 | 복구로 없앤다. 남으면 사용자가 명시적으로 억제한 결과이므로 **의도로 존중**한다 |
| 메타데이터 누락 | "모르겠어요"는 1급 선택지다(PRD §4.5). 안 채운 것을 결함으로 부르면 그 사람은 안 돌아온다 |
| 제목 길이·명명 규칙 | 남의 업무 표현을 교정하지 않는다 |
| 단계 수 상한 | 500단계는 성능 문제이지 사용자 잘못이 아니다 (접기로 해결, D-037) |
| 갈래 수 상한 | 레이아웃이 팬아웃 스택으로 대응한다 (DESIGN §6.5) |
| 시간 총합의 현실성 | 총량 정산은 사용자가 **스스로 재배분하는 장치**이지 검증기가 아니다 (PRD §4.7) |

---

## 5. 사이클 처리

[`src/cycles.ts`](../packages/graph-core/src/cycles.ts)

사용자가 "반려되면 3번으로 돌아감"을 만들면 사이클이 생긴다. **정상이고 필수 기능이다.**
문제는 두 곳에서만 생기고, 둘 다 graph-core에서 끝낸다. 다운스트림(레이아웃·메트릭·
익스포터)은 **항상 DAG만 본다.**

### 5.1 레이아웃 — 우리가 직접, 결정적으로 끊는다

```
1. 정규 DFS (시작점 = start, 그다음 정규 순서 / out-edge는 §1.5 순서로 정렬)
2. 스택 위 노드를 가리키는 엣지 = back edge
3. back edge를 제거한 그래프 = DAG → topoOrder
4. ELK에는 back edge를 source/target 뒤집어서 넘기고 reversedForLayout: true
5. React Flow는 화살표 머리를 원래 방향에 그린다 (markerStart ↔ markerEnd 교체)
```

```ts
export function toLayoutEdges(edges): Array<{ id; sources; targets; reversedForLayout }>;
```

**ELK 자체의 `cycleBreaking`에 맡기지 않는 이유**: ELK의 휴리스틱은 입력 순서에
민감해서 같은 문서가 다른 순서로 들어오면 다른 엣지를 뒤집는다 → 노드가 통째로
재배치된다 → **레이아웃 점프**. D-024가 막으려는 바로 그것이다.
`elk.layered.cycleBreaking.strategy: 'MODEL_ORDER'`를 이중 안전장치로 함께 켠다.

결정성의 근거는 두 가지뿐이다 — 시작점 순서가 고정이고, 각 노드의 out-edge 순서가
고정이다. 그래서 같은 입력이면 **항상 같은 엣지가 back edge**가 된다.

### 5.2 사이클 열거 — back edge 하나 = 루프 하나

Johnson의 모든 기본 사이클 열거는 여기서 과잉이다. 사용자는 "반려되면 3번으로"라는
**엣지 하나**를 그었고, 그 엣지가 닫는 사이클이 정확히 그가 의도한 루프다.

```
back edge (u→v) 에 대해 DAG에서 v ⇝ u 최단 경로 → 그 사이클
DFS 트리 경로가 항상 존재하므로 실패하지 않는다. O(V+E) per back edge
```

`maxCycles`(기본 32)로 상한을 둔다.

### 5.3 리드타임 — 무한 루프를 기하분포로 유한화

반려율 `p`인 루프를 **1회 실행 + 기하분포 재시도**로 본다.

```
E[루프 통과 총 횟수]  = Σ_{k≥0} p^k = 1 / (1 − p)
E[추가 반복 횟수]     = p / (1 − p)
```

- 중첩 루프는 **곱해진다** (안쪽 루프가 바깥 루프마다 다시 돌므로)
- `p`는 `maxReworkRate`(기본 **0.95**)로 절단 → 기대 추가 반복 19회에서 발산 차단
- `p`가 없으면 **1로 둔다.** 지어내지 않는다 (`expectedExtraPasses: null`)

절단이 필요한 이유는 수학이 아니라 데이터다. 자기보고에서 "반려율 100%"는 오기(誤記)이고,
그 한 칸이 문서 전체의 리드타임을 `∞`로 만들면 요약 카드가 통째로 무의미해진다.

**픽스처 24 실측**

```
1. 요청 작성 (1h)  →  2. 검토 (1h)  →  3. 승인 판정 (1h, 반려율 30%)
                                              │
   └──────────────────── ↺ ────────────────────┘

통과 횟수 = 1/(1−0.3) = 1.4286
실접촉시간 = 3h × 1.4286 = 4.2857h      ← 재작업이 43%를 더 먹는다
기대 리드타임 = 4.2857h
```

이 43%가 "재작업 루프가 자동화 ROI 1위"라는 주장의 숫자다.

---

## 6. 병렬(AND) 의미론

### 6.1 fork/join

| | |
|---|---|
| **fork** | 노드를 만들지 않는다. **분기 항목 자체가 fork다** |
| **join** | `join:{branchItemId}`를 **실체화한다** (갈래 2개 이상일 때만) |

join을 만드는 이유는 그림이 아니라 숫자다. "모두 끝나야 다음"이라는 동기화 지점이
없으면 `max(각 갈래)`를 계산할 자리가 없다.

### 6.2 세 개의 다른 질문, 세 개의 다른 답

하나로 뭉뚱그리면 전부 틀린다.

| 질문 | XOR 합성 | AND 합성 | 필드 |
|---|---|---|---|
| 얼마나 걸리나 (달력 시간) | 확률 가중 | **max** | `leadTimeH` |
| 최악은 | max | max | `criticalPathH` |
| 사람이 몇 시간 붙어 있나 | 확률 가중 | **sum** | `touchH` |

**AND에서 lead=max, touch=sum이 갈리는 지점이 정확히 이 제품의 주장이다** (D-005).

### 6.3 계산식

**리드타임 (후향 DP, DAG 위에서)**

```
T(v) = lead(v)·passes(v) + agg{ T(w) : v→w, back edge 제외 }

  agg = max_w T(w)                     v가 AND 분기일 때
      = Σ_w share'(v→w)·T(w)           그 외 (share'는 forward 엣지로 재정규화)

T(end) = 0
기대 리드타임 = T(start)
```

**AND에서 max가 왜 이중 계산을 안 하는가** — 합류 이후 구간이 각 갈래의 `T`에
공통으로 들어 있기 때문이다.

```
T(갈래i의 head) = 갈래i_내부 + T(join)
max_i( 갈래i_내부 + T(join) ) = max_i(갈래i_내부) + T(join)      ✓
```

XOR도 같은 이유로 정확하다 — `Σ w_i (갈래i_내부 + T(다음)) = Σ w_i·갈래i_내부 + T(다음)`
(`Σ w_i = 1`이므로).

**최장 경로 (critical path)**

```
C(v) = lead(v)·passes(v) + max{ C(w) : v→w, back edge 제외 }
criticalPathH = C(start)
criticalPath  = C를 최대화하는 경로 (동률은 정규 순서 낮은 쪽)
```

**실접촉시간**

```
touchH        = Σ_v  reachProb(v) · passes(v) · touch(v)       ← 기대값
touchAllPathsH = Σ_v            passes(v) · touch(v)           ← 모든 갈래가 다 돌 때
```

**도달 확률 (전향 DP)**

```
reachProb(start) = 1
reachProb(v) = Σ_{u→v}   reachProb(u)·share(u→v)      일반 노드
             = max_{u→v} reachProb(u)·share(u→v)      ★ AND 합류 노드
```

합류 노드가 **합이 아니라 max**인 것이 핵심이다. AND 갈래 k개가 모두 도달한다는 것이
확률 k배를 뜻하지 않는다. 이 한 줄을 빼면 **병렬 뒤의 모든 구간이 k배로 부푼다.**

**엣지 확률 share**

```
AND 분기        : 모든 나가는 엣지 share = 1     (전부 실행된다)
XOR / skip      : 균등 1/k
reworkRate가 있는 노드: back edge에 p, 나머지에 (1−p)를 균등 배분
```

마지막 줄 덕분에 "반려율 30%"가 **갈래 확률로 직접 쓰인다.** 사용자가 이미 적은
숫자를 재사용하는 것이지, 새 질문을 만들지 않는다.

### 6.4 과대 계산이 얼마나 큰가 — 픽스처 30 vs 31

같은 5시간짜리 그림이 AND냐 XOR이냐에 따라 이렇게 갈린다.

```
◇ 갈래 A: 반나절(4h) / 갈래 B: 1시간(1h)

                        AND         XOR       AND/XOR 미구분(합산)
기대 리드타임            4h         2.5h            5h
최악 리드타임            4h          4h             5h
기대 실접촉시간          5h         2.5h            5h
```

**AND를 순차로 합산하면 리드타임이 25% 과대**(4h → 5h),
**XOR을 합산하면 100% 과대**(2.5h → 5h)다. 갈래가 늘수록 오차가 누적되고,
이 숫자가 자동화 후보 랭킹을 만든다. 시각화가 틀리는 게 아니라 **숫자가 틀린다.**

---

## 7. 파생 메트릭

[`src/metrics.ts`](../packages/graph-core/src/metrics.ts)

모든 시간 지표는 `Measure = { value, coverage }`로 나온다.
`coverage`는 계산에 쓰인 노드 중 **실제 데이터가 있던 비율**이다.
데이터가 없으면 0을 지어내지 않고 coverage로 정직하게 말한다.

| 지표 | 정의 / 계산식 |
|---|---|
| **단계 수** `stepCount` | `task + hold` 노드 수. **분기는 세지 않는다** — 사용자가 "단계"라고 부르는 것은 자기가 하는 일이지 갈림길이 아니다. `branchCount`/`caseCount`/`nodeCount`는 별도 필드 |
| **관여 인원 수** `peopleCount` | forward-fill된 담당자(`effectiveAssigneeId`)의 서로 다른 값 개수. null 제외 |
| **도구 수** `toolCount` | 전 단계 `toolIds`의 합집합 크기 (카탈로그 FK이므로 정규화 불필요, D-009) |
| **부서 간 인계** `handoffCount` / `crossDepartmentHandoffCount` | 아래 §7.1 |
| **대기시간 총합** `waitH` | `Σ_v reachProb(v)·passes(v)·wait(v)`, hold 노드만. `wait(v) = attrs.avgWaitH ?? DEFAULT_WAIT_HOURS[waitFor]` |
| **대기 비중** `waitRatio` | `waitH.value / leadTimeH.value`. 리드타임 0이면 `null` |
| **실접촉시간** `touchH` / `touchAllPathsH` | §6.3. `durationBand` → 시간은 `BAND_HOURS` |
| **기대 리드타임** `leadTimeH` | §6.3 후향 DP |
| **최장 경로** `criticalPathH` / `criticalPath` | §6.3. 경로는 노드 ID 배열 |
| **도구 전환 횟수** `toolSwitchCount` | §7.2 |
| **사이클** `cycles` / `cycleCount` | §5.2. 각 사이클에 `reworkRate`, `expectedExtraPasses = p/(1−p)`, `clamped` |
| **노드별 중간값** `perNode` | `reachProbability` / `expectedPasses` / `touchH` / `waitH` / `leadH` / `remainingLeadH` / `remainingCriticalH` — 렌즈·인스펙터·디버깅용 |

### 7.1 부서 간 인계 — 담당자 forward-fill

**`assigneeId === null`은 "모름"이 아니라 "앞 단계와 같음"이다.**

근거는 UX에 있다. 메타데이터 카드는 담당자를 전원 "나"로 미리 채우고
**바뀌는 지점만** 지정하게 한다(PRD §4.5, *"여기부터 다른 사람인가요?"*).
그러면 빈 값의 정확한 의미가 "앞과 같음"이 된다.

```
1. 위상 순서로 effectiveAssigneeId를 흘려보낸다
     eff(v) = v.assigneeId ?? (선행 노드들의 eff가 모두 같으면 그 값, 아니면 null)
2. 합성 노드(start/end/join)를 축약한 "단계 사이" 엣지 집합을 만든다
     → 합류 노드에서 인계가 끊기지 않는다
3. 인계 = eff(u) ≠ eff(v) 이고 둘 다 null이 아닌 지점
4. 부서 간 인계 = directory[eff(u)].deptId ≠ directory[eff(v)].deptId
```

선행이 여럿이고 서로 다르면 `null`이다 — **모른다고 말하는 편이 아무나 찍는 것보다 낫다.**

`directory`는 `DeriveOptions`로 주입한다. graph-core는 조직도를 모른다.

### 7.2 도구 전환 횟수

```
전환 = 단계 사이 엣지 (u,v) 중
       tools(u) ≠ ∅ ∧ tools(v) ≠ ∅ ∧ tools(u) ∩ tools(v) = ∅
```

교집합이 있으면 전환이 아니다 — 같은 도구를 계속 쓰고 있으면 컨텍스트 스위치가 없다.
DESIGN §6.3의 도구 렌즈("같은 도구 노드끼리 hover 시 연결 하이라이트 → 도구 전환
횟수가 눈에 보임")가 이 정의와 정확히 같은 것을 센다.

---

## 8. 증분 계산

[`src/incremental.ts`](../packages/graph-core/src/incremental.ts)

### 8.1 결론: `derive()`는 증분화하지 않는다

500항목 기준 전체 재계산이 **1.5ms**다. ELK 한 번이 50~1500ms다.
**1000분의 1짜리를 최적화하는 것은 최적화가 아니라 버그 표면 확대다.**

증분 파생은 (a) 부분 그래프의 tails/join 전파를 다시 구현해야 하고 (b) 캐시와 진실이
어긋나는 split brain을 만들며 (c) 골든 픽스처를 두 배로 늘린다.
**파생 엣지를 저장하지 않기로 한 이유(D-030)와 정확히 같은 이유로 파생 결과도
증분하지 않는다.**

증분화가 실제로 필요한 것은 그 아래 셋이다.

| | 비용 | 게이트 |
|---|---|---|
| ELK 레이아웃 | 50~1500ms | `topologyHash` |
| React Flow 렌더 | 노드당 DOM 15~30개 | `contentHash` + `changedNodeIds()` |
| 요약 카드 | O(V+E)지만 매 키 입력에 깜빡이면 안 됨 | `recomputeScope(ops).metrics` |

### 8.2 op → 재계산 범위

● = 다시 계산 / ○ = 건드리지 않음

| op | 위상 | 라벨 | 메트릭 | 사이클 | 비고 |
|---|:--:|:--:|:--:|:--:|---|
| `insert_item` | ● | ● | ● | ○ | 갈래 안에 넣으면 join 재배선 |
| `delete_item` | ● | ● | ● | ● | 루프의 끝점을 지우면 사이클이 사라진다 |
| `restore_item` | ● | ● | ● | ● | dangling 엣지가 되살아난다 |
| `move_item` | ● | ● | ● | ● | 가장 광범위. 역할(step ↔ case)이 바뀐다 |
| `reorder_item` | ● | ○ | ● | ○ | 형제 순서 = 사슬 순서 |
| **`set_title`** | ○ | ● | ○ | ○ | **타이핑의 95%가 여기서 걸러진다** |
| `set_kind` | ● | ● | ● | ● | task ↔ branch는 자식의 역할을 뒤집는다 |
| `set_attr{mode}` | ● | ● | ● | ○ | xor ↔ and는 join 노드 생성/삭제 |
| `set_attr{joinBehavior}` | ● | ○ | ● | ○ | continue ↔ end |
| `set_attr{caseLabel}` | ○ | ● | ○ | ○ | 엣지 라벨만 |
| `set_attr{reworkRate}` | ○ | ○ | ● | ○ | 확률. **위상 해시에 안 들어간다** |
| `set_attr{avgWaitH, timeoutH, waitFor}` | ○ | ● | ● | ○ | |
| `set_assignee` | ○ | ● | ● | ○ | 인계 지점 재계산 |
| `set_duration` | ○ | ● | ● | ○ | |
| `set_tools` | ○ | ● | ● | ○ | 도구 전환 횟수 |
| `toggle_pain` | ○ | ● | ○ | ○ | 짜증 렌즈 전용 (D-025) |
| `confirm_item` | ○ | ● | ○ | ○ | 신선도 채도만 |
| `add_edge` / `remove_edge` | ● | ● | ● | ● | |
| `suppress_edge` / `unsuppress_edge` | ● | ● | ● | ● | 유일한 진입로를 끊을 수 있다 |

**이 표는 보수적 상한이다.** 실제 게이트는 표가 아니라 해시다.

```ts
if (prev.topologyHash === next.topologyHash) { /* ELK를 아예 돌리지 않는다 */ }
```

표는 "해시를 계산하기 전에 스킵할 수 있는가"를 정하는 1차 필터일 뿐이다.
그래서 `topologyHash`에 무엇이 **안 들어가는지**가 설계의 핵심이다 —
제목·담당자·소요시간·도구·짜증·`reworkRate`가 전부 빠져 있다.
하나라도 들어가면 게이트가 무의미해진다. 테스트가 이를 고정한다.

---

## 9. 골든 픽스처 36건

[`src/__fixtures__/golden.ts`](../packages/graph-core/src/__fixtures__/golden.ts) ·
[`test/golden.test.ts`](../packages/graph-core/test/golden.test.ts)

각 픽스처는 **ASCII 다이어그램 주석 + 기대 노드/엣지/진단/메트릭**으로 구성된다.
스냅샷 파일(`.snap`)을 쓰지 않는 이유는 하나다 — **스냅샷은 아무도 안 읽는다.**
기대값을 사람이 손으로 적고 다이어그램과 나란히 둬야, 리뷰에서
"규칙이 바뀐 것"과 "규칙이 깨진 것"을 구분할 수 있다.

엣지 표기: `source -reason(label)-> target` · `=>`는 명시적 엣지 · `↺`는 back edge.

| # | 픽스처 | 고정하는 것 |
|---|---|---|
| 01 | 빈 문서 | A10 · `start → end` |
| 02 | 루트에 단계 1개 | A9 |
| 03 | 형제 3단계 순차 연결 | 규칙 (a) |
| 04 | XOR 2갈래 · 둘 다 이어짐 · 다음 형제 있음 | 규칙 (b)(c) 기본형 |
| 05 | 분기가 마지막 형제 | A6 |
| 06 | 갈래마다 joinBehavior가 다름 | A7 |
| 07 | 모든 갈래가 end + 뒤에 형제 | **A7′ fallthrough** |
| 08 | 빈 갈래 | **A2 + 갈래 좌우 순서** |
| 09 | 갈래가 1개뿐인 분기 | A3 |
| 10 | 분기에 자식 없음 | A8 |
| 11 | 중첩 분기 | **A1** |
| 12 | 갈래의 마지막이 hold | A5 |
| 13 | 갈래의 마지막이 또 다른 분기 | A4 |
| 14 | AND 2갈래 → 합류 노드 실체화 | §6 |
| 15 | AND 갈래 1개 | A11 |
| 16 | AND 일부만 end | **A11′ 교착 회피** |
| 17 | AND 전부 end | A11′ 예외 |
| 18 | skip 1갈래 + 다음 형제 | **A12** |
| 19 | skip이 마지막 형제 | A12 × A6 |
| 20 | self-loop | A13 |
| 21 | dangling 엣지 | A14 |
| 22 | suppressed가 파생 엣지를 억제 | 규칙 (d) |
| 23 | suppressed가 아무것도 억제 못 함 | A15 |
| 24 | 사이클 A→B→C→A | **A16 · §5 계산** |
| 25 | 전부 tombstone | A10 (01과 동일 결과) |
| 26 | 고아 항목 | 전처리 복구 |
| 27 | 부모 사이클 | 전처리 복구 |
| 28 | task에 하위 항목 | A17 |
| 29 | 예약 ID 충돌 | §2 I3 |
| 30 | **AND 리드타임 = max, 실접촉 = sum** | §6 핵심 |
| 31 | **같은 모양 XOR = 확률 가중** | §6 대조군 |
| 32 | 담당자 forward-fill + 부서 간 인계 | §7.1 |
| 33 | 명시 = 파생 중복 + join 별칭 | A18 · §2 |
| 34 | 대기시간 총합과 비중 | §7 |
| 35 | sortKey 충돌 tie-break | A19 |
| 36 | 통합 (중첩 + AND + hold + 루프 + 오버라이드) | 회귀 방지 |

### 픽스처 외 테스트 21건

```
순수하다 — 같은 입력이면 같은 출력, 입력을 변형하지 않는다   (36 픽스처 전부)
입력 배열 순서에 의존하지 않는다                            (36 픽스처 전부 역순)
back edge를 빼면 DAG다 — 모든 노드가 위상 정렬에 들어간다
start는 들어오는 엣지가 없고 end는 나가는 엣지가 없다
모든 항목 노드 ID는 항목 ID 그대로다 (위치에서 유도하지 않는다)
모든 엣지가 "왜 생겼는가"에 답할 수 있다
진단에 error 심각도가 존재하지 않는다
제목만 바뀌면 topologyHash가 변하지 않는다
reworkRate가 바뀌어도 topologyHash가 변하지 않는다
순서가 바뀌면 topologyHash가 변한다
무관한 형제를 추가해도 다른 노드의 ID가 바뀌지 않는다
AND 합류 노드 ID는 갈래 편집과 무관하게 분기 항목 ID에서만 나온다
```

여기에 §8·§10·§11의 스모크 9건이 더해진다 — `recomputeScope`의 범위표,
`toN8n`의 "매핑 못 한 것 목록"(5종 사유 전부), 역투영의 거절 코드와 자식 승격 순서.

그리고 §8·§10·§11의 스모크 테스트 9건이 함께 돈다 — `recomputeScope`의 범위표,
`toN8n`의 "매핑 못 한 것 목록", 역투영의 거절 코드와 자식 승격 순서.

---

## 10. `toN8n()` 스케치

[`src/export/n8n.ts`](../packages/graph-core/src/export/n8n.ts)

```ts
export function toN8n(graph: DerivedGraph, options: ToN8nOptions): N8nExportResult;

type ToN8nOptions = {
  name: string;
  trigger: { kind: 'manual' } | { kind: 'schedule'; cron } | { kind: 'webhook'; path };
  toolCatalog?: Record<string, { n8nNodeType: string | null }>;  // tools.n8n_node_type
  positions?: Record<NodeId, { x: number; y: number }>;
};

type N8nExportResult = {
  workflow: N8nWorkflow;          // active: false 고정
  unmapped: readonly UnmappedItem[];
  coverage: number;               // 매핑된 단계 / 전체 단계
  notes: readonly string[];       // 스티키 노트로 나가는 구조적 손실
};
```

로드맵상 M5+지만 **인터페이스는 지금 잡는다.** `tools.n8n_node_type` 컬럼 자리를
지금 잡아두지 않으면 3개월 뒤 익스포터가 전부 퍼지 문자열 매칭이 되기 때문이다(D-009).

### 가장 중요한 한 줄

> **우리 그래프는 제어 흐름이고 n8n 워크플로는 데이터 파이프라인이다.**

우리에겐 페이로드 스키마가 없다. 어떤 단계가 무엇을 입력받아 무엇을 내보내는지
모델에 **존재하지 않는다.** 따라서 export 결과는 **절대 실행 가능한 워크플로가 아니다.**
골격 + 스티키 노트다. `active: false`로 고정하고, UI에서도 "n8n으로 내보내기"가 아니라
**"자동화팀에 넘길 초안 만들기"**로 부른다.

### 매핑 가능

| 우리 개념 | n8n | 손실 |
|---|---|---|
| 순차 연결 | `connections.main[0]` | 없음 |
| XOR 분기 (갈래 2) | `n8n-nodes-base.if` | 조건식 |
| XOR 분기 (갈래 3+) | `n8n-nodes-base.switch` (rules) | 조건식 |
| skip 분기 | `if` (true = 갈래 / false = 통과) | 조건식 |
| AND fan-out | 한 출력 → 여러 연결 | **동시성** |
| AND 합류 | `n8n-nodes-base.merge` (`numberInputs`) | 없음 |
| `hold` `waitFor:'time'` | `n8n-nodes-base.wait` (timeInterval, `avgWaitH`) | 없음 |
| `hold` `waitFor:'approval'` | `wait` (`resume: 'webhook'`) | 승인 UI |
| 도구가 카탈로그에 매핑된 작업 | 해당 노드 타입 (파라미터 비움) | 파라미터 |
| `start` | 트리거 노드 (호출자가 지정) | 트리거 조건 |
| 사이클 (재작업 루프) | 역방향 connection (n8n은 순환 허용) | 종료 조건 |

갈래의 **출력 인덱스 = 갈래 순서**다. 사용자가 쓴 순서가 곧 정상 경로 우선이고,
DESIGN §6.5의 좌우 배치 규칙과 같은 근거를 쓴다.

### 매핑 불가 — 정직하게 목록으로 내보낸다

| `UnmappedReason` | 내용 |
|---|---|
| `condition-unknown` | **"단순 문의라면"은 자연어다.** n8n 조건은 `{{$json.x}}` 표현식이다. **자동 변환을 시도하지 않는다** — 그럴듯하게 틀린 조건이 빈 조건보다 위험하다 |
| `human-task` | 승인·전화·오프라인 확인. Wait + webhook 껍데기만 나간다 |
| `no-tool-binding` | 도구가 없거나 `n8n_node_type`이 비어 있음 → `noOp` + `disabled: true` |
| `no-data-model` | **단계 사이에 무엇이 흐르는지 우리 모델에 없다.** 전 노드의 입출력 매핑이 비어 있다 |
| `parallel-semantics` | **n8n은 브랜치를 순차 실행한다(동시성 없음).** 우리 리드타임 `max` 가정이 실행 시점엔 성립하지 않는다. 경고가 아니라 **명세에 반드시 적어야 할 사실** |
| `loop-condition` | 확률적 루프는 n8n에 없다. 반복을 멈출 조건이 비어 있다 |
| `timeout-escalation` | `hold.timeoutH` 후 에스컬레이션은 n8n Wait 노드로 표현할 수 없다 |

추가로 **자격증명·권한·에러 처리·재시도**는 전부 사람 몫이다.

`coverage`는 이 정직함을 숫자로 만든 것이다. "80% 매핑됐습니다"가 아니라
"매핑 못 한 12건은 이것들입니다"를 보여주는 것이 이 함수의 실제 산출물이다.

---

## 11. 역투영 (양방향 편집 대비)

[`src/project/back.ts`](../packages/graph-core/src/project/back.ts)

```ts
export function canApplyCanvasEdit(graph, edit): true | Rejection;
export function projectCanvasEdit(ctx: ProjectContext, edit): Projection | Rejection;

type ProjectContext = {
  graph; items;
  keyBetween: (a: string | null, b: string | null) => string;  // fractional-indexing 주입
  newId: () => string;                                         // 난수는 graph-core 밖에서
};
```

### 지배 규칙

> **캔버스에서 그은 연결은 절대 구조가 되지 않는다. 항상 오버라이드다.**

임의 그래프에는 정규적(canonical) 아웃라인이 없다(D-030). 캔버스에서 엣지 하나를
그었다고 왼쪽 아웃라인을 재배열하면, 사용자는 **자기가 건드리지도 않은 문장이 통째로
움직이는 것**을 본다. 비개발자 제품에서 이건 치명적이다.

그래서 역투영은 두 갈래뿐이다.

| 캔버스 조작 | 트리 연산 |
|---|---|
| 노드 드래그로 순서 변경 | `reorder_item` (형제 `sortKey` 재발급) |
| 노드를 다른 갈래/루트로 이동 | `move_item` — **부모가 바뀌면 역할이 바뀐다** (§1.3) |
| 두 노드 사이에 노드 추가 | `insert_item` (형제 삽입) |
| 노드 삭제 | `delete_item` + 자식 승격 (아래) |
| **임의의 엣지 긋기** | **`add_edge` (explicit) — 구조를 건드리지 않는다** |
| **파생 엣지 끊기** | **`suppress_edge`** |
| 명시적 엣지 끊기 | `remove_edge` |
| 타입 변경 / 제목 변경 | `set_kind` / `set_title` |

**노드 삭제의 자식 승격 정책** — 분기를 지우면 갈래가 통째로 사라진다. 내용 손실이
가장 큰 조작이므로, **갈래 본문을 분기가 있던 자리로 순서대로 승격**한다.
갈래 조건 라벨은 잃는다(조건문이 사라졌으니 붙일 데가 없다).
이 조작만은 되돌리기 토스트를 띄운다.

### 트리로 사상 불가능한 조작 — 목록과 막는 방법

| 해보고 싶은 것 | 왜 불가능한가 | 어떻게 막는가 |
|---|---|---|
| `start`/`end`/`join` 노드 이동·삭제 | 저장되지 않는 **계산 결과**다 | 드래그 핸들·삭제 메뉴를 렌더하지 않음 |
| 한 단계에 부모를 둘 이상 주기 | 트리의 부모는 1개 | 두 번째 부모는 `add_edge`로 자동 강등 (구조가 아님) |
| 아무 데도 연결 안 된 노드 만들기 | 아웃라인의 모든 줄은 어딘가의 형제 | 캔버스에 "빈 공간 더블클릭 → 노드 생성"을 **두지 않는다** |
| 파생 엣지의 방향 뒤집기 | 방향은 `sortKey` 순서의 결과 | 엣지 끝점 드래그 비활성 |
| 서로 다른 분기의 갈래를 하나로 합치기 | 갈래는 특정 분기의 자식 | 드롭존을 같은 분기 안으로만 |
| 합류 지점 한가운데에 단계 끼우기 | 트리 위치가 유일하지 않다 | `ambiguous-insert-point` + "어느 갈래 뒤에 넣을지 정해지지 않습니다" |
| 자기 자신의 하위로 옮기기 | 트리에는 사이클이 없다 | `cycle-in-tree` |
| 노드 자유 배치 (수동 좌표) | 가능하지만 **트리와 무관** | `layout_overrides` 테이블로 분리 — 트리 op이 아니다 |

마지막 줄이 중요하다. **수동 좌표는 역투영 대상이 아니다.** 그래프 구조와 무관한
별도 저장소로 빼야 나중에 "자동 배치로 되돌리기"가 한 번의 `DELETE`가 된다.

### 오류를 띄우지 않는 방법: 사후 검증이 아니라 사전 어포던스

`canApplyCanvasEdit()`는 드래그가 **끝난 뒤** 검사하는 함수가 아니다.
드래그가 **시작될 때** 모든 후보 드롭존에 대해 미리 돌려서 **합법인 곳에만 고스트
슬롯을 그린다.** 불법인 곳에는 드롭 자체가 안 된다.

→ 사용자는 거절 메시지를 볼 일이 없다. 못 하는 동작은 애초에 시도되지 않는다.
§4의 "오류를 표시하지 않는다"를 캔버스에서 구현하는 방식이다.

---

## 12. 패키지 구조와 의존성 규칙

### 12.1 파일 구조

```
packages/graph-core/
  package.json           dependencies: {} ← ★ 영원히 비어 있다
  tsconfig.json          src 전용. lib에 DOM 없음, types: []
  tsconfig.test.json     test만 Node 전역을 본다
  eslint.config.js       금지 import / 금지 전역 / 금지 프로퍼티
  src/
    index.ts             ★ 공개 API 배럴. 여기 없는 것은 내부 구현
    types.ts             입력층(Item/Edge) + 파생층(DerivedGraph) + 진단 + 메트릭
    ids.ts               결정적 ID 규칙 (§2)
    util.ts              hash32 / clamp / round — 의존성 없음
    preprocess.ts        행 배열 → 정렬된 트리 + 역할 부여 (§1.2, §1.3)
    derive.ts            컴파일 + 오버레이 + 조립 (§1.4)
    cycles.ts            back edge 판정 · 위상 정렬 · 사이클 열거 · toLayoutEdges (§5)
    metrics.ts           확률/시간 DP · 인계 추론 (§6, §7)
    validate.ts          진단 조회 + 엣지 호버 문구 (§4)
    format.ts            결정적 텍스트 덤프 (픽스처·디버깅)
    incremental.ts       op → 재계산 범위 · 레이아웃/렌더 게이트 (§8)
    export/n8n.ts        toN8n (§10)
    project/back.ts      역투영 (§11)
    analytics/schema.ts  이벤트 zod .strict() 스키마 (MEASUREMENT §2) ← 예정 자리
    __fixtures__/
      builder.ts         픽스처용 아웃라인 빌더
      golden.ts          ★ 골든 픽스처 36건 (§9)
  test/
    golden.test.ts       node:test. 픽스처 36 + 불변식 12 + 스모크 9 = 57건
```

### 12.2 공개 API

`src/index.ts`에 있는 것만 공개다. 앱 코드가 `@workflow/graph-core/src/...`를 직접
import 하면 ESLint가 막는다.

```
derive · validate · EDGE_REASON_COPY
toLayoutEdges · BAND_HOURS · DEFAULT_WAIT_HOURS
START_ID · END_ID · JOIN_PREFIX · FORK_PREFIX
joinNodeId · forkNodeId · isSyntheticId · isReservedId · derivedEdgeId
compareSortKey
formatGraph · formatNodes · formatEdges · formatDiagnostics
recomputeScope · OP_SCOPE · needsLayout · changedNodeIds
toN8n · projectCanvasEdit · canApplyCanvasEdit
+ 모든 타입
```

### 12.3 금지 import — 3중 방어

"React를 import 하지 말자"는 합의는 6개월이면 깨진다. 어느 날 누가
`import { useMemo }`를 넣고, 그 순간 이 패키지는 RSC·웹워커·서버 익스포터에서
못 쓰게 된다. **규칙을 사람의 기억에 두지 않는다.**

| 층 | 수단 | 막는 것 |
|---|---|---|
| 1 | `tsconfig.json`의 `lib: ["ES2022"]` (**DOM 없음**) + `types: []` | `document` · `window` · `localStorage` · Node 전역 → **컴파일 에러** |
| 2 | `eslint.config.js`의 `no-restricted-imports` | `react` · `react-dom` · `@xyflow/*` · `elkjs` · `drizzle-orm` · `pg` · `next` · `zustand` · `immer` · `node:*` · `@blocknote/*` |
| 3 | `package.json`의 `dependencies: {}` | 애초에 설치되어 있지 않다 |

추가로 **결정성 계약**을 린트로 강제한다.

```
Math.random  → 금지. 난수는 derive()의 결정성을 깬다. ID는 호출자가 발급한다
Date.now     → 금지. 현재 시각은 순수 함수의 입력이 아니다. 필요하면 옵션으로 주입
process      → 금지. 런타임 환경을 모른다
```

1층이 실제로 작동하는지는 CI가 증명한다.

```
$ tsc --noEmit -p tsconfig.json     # src만, DOM/Node 타입 없음
(에러 없음)
```

이 명령이 통과한다는 것 자체가 **"이 패키지는 브라우저·워커·엣지·RSC 어디서나
같은 결과를 낸다"**의 증명이다.

### 12.4 이 패키지에 들어가지 않는 것

| | 왜 |
|---|---|
| ELK 호출 | 좌표는 앱 레이어의 일. graph-core는 `toLayoutEdges()`까지만 |
| React Flow 노드/엣지 변환 | 렌더 관심사 |
| Drizzle 쿼리 | 순수 값만 받는다 |
| 조직도 조회 | `DeriveOptions.directory`로 주입 |
| 도구 카탈로그 조회 | `ToN8nOptions.toolCatalog`으로 주입 |
| UUID 발급 | `ProjectContext.newId`로 주입 |
| fractional index 발급 | `ProjectContext.keyBetween`으로 주입 |
| UI 문구 | `DeriveOptions.labels` / `EDGE_REASON_COPY` 오버라이드 (WRITING.md 소관) |

**런타임 의존성이 하나라도 생기고 싶어지면, 그것은 이 패키지에 들어갈 코드가 아니다.**

---

## 13. 미해결 · 다음에 결정할 것

| # | 항목 | 언제 |
|---|---|---|
| 1 | **갈래별 확률 필드** — 지금은 XOR을 균등 1/k로 본다. `reworkRate`만이 예외. 실무에서 "80%는 단순 문의"가 흔하다면 `attrs.probability`를 추가한다 | 파일럿 데이터로 판단. 메타 카드 질문이 하나 늘어나는 비용과 비교 |
| 2 | **`hold.timeoutH` 후 에스컬레이션 경로** — 지금은 숫자만 저장하고 그래프에 반영하지 않는다 | `waitFor:'approval'` 사용률이 높으면 (D-005의 뒤집는 조건과 함께) |
| 3 | **접기(collapse)와 메트릭** — 접힌 그룹의 요약 노드가 보여줄 숫자를 `perNode`에서 어떻게 합성할지 | M1 캔버스 구현 시 |
| 4 | **조직 프로세스 조립** (PRD §4.9) — 여러 문서의 그래프를 핸드오프로 잇는 `assemble()` | M4 |
| 5 | `analytics/schema.ts` — MEASUREMENT §2의 zod strict 스키마를 이 패키지에 둘지, 별도 패키지로 뺄지 | 수집 프록시 구현 시 |
