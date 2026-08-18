# @workflow/layout-core

> 파생 그래프 → 좌표

순수 기하. LayoutInput → 좌표. React·DOM·타이머·워커·elkjs 런타임 의존 없음.

| | |
|---|---|
| 명세 | [`docs/LAYOUT.md`](../../docs/LAYOUT.md) |
| 런타임 의존성 | `@workflow/graph-core` |
| 소스 | 2360줄 |
| 테스트 | 107건 |

```bash
npm test          # 골든 픽스처 + 불변식
npm run typecheck # 순수성이 타입으로 증명된다
```

이 패키지의 규칙과 그 근거는 명세 문서에 있다. 코드에서 명세와 갈라진 자리는
전부 주석으로 이유를 남겼고, 테스트가 그 판단을 고정한다.
