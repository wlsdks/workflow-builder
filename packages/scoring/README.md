# @workflow/scoring

> 단계 → 자동화·제거 후보

PRD §4.8 스코어링 · Feasibility 6요소 · ECRS 12종 · 금지 출력 가드. 순수 함수, 런타임 의존성 0.

| | |
|---|---|
| 명세 | [`docs/ANALYTICS-ENGINE.md`](../../docs/ANALYTICS-ENGINE.md) |
| 런타임 의존성 | **없음** |
| 소스 | 3213줄 |
| 테스트 | 68건 |

```bash
npm test          # 골든 픽스처 + 불변식
npm run typecheck # 순수성이 타입으로 증명된다
```

이 패키지의 규칙과 그 근거는 명세 문서에 있다. 코드에서 명세와 갈라진 자리는
전부 주석으로 이유를 남겼고, 테스트가 그 판단을 고정한다.
