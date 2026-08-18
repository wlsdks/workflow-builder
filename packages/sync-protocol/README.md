# @workflow/sync-protocol

> op 와이어 스키마

op 와이어 스키마. graph-core의 Op 타입과 1:1 (D-119 — zod는 graph-core에 들어가지 않는다).

| | |
|---|---|
| 명세 | [`docs/SYNC.md`](../../docs/SYNC.md) |
| 런타임 의존성 | `zod` |
| 소스 | 506줄 |
| 테스트 | 19건 |

```bash
npm test          # 골든 픽스처 + 불변식
npm run typecheck # 순수성이 타입으로 증명된다
```

이 패키지의 규칙과 그 근거는 명세 문서에 있다. 코드에서 명세와 갈라진 자리는
전부 주석으로 이유를 남겼고, 테스트가 그 판단을 고정한다.
