# @workflow/analytics-schema

> 이벤트 스키마

MEASUREMENT §2 이벤트 택소노미의 zod .strict() 정본. 금지 속성은 '검사'되는 것이 아니라 '존재하지 않는다'.

| | |
|---|---|
| 명세 | [`docs/MEASUREMENT.md`](../../docs/MEASUREMENT.md) |
| 런타임 의존성 | `zod` |
| 소스 | 853줄 |
| 테스트 | 19건 |

```bash
npm test          # 골든 픽스처 + 불변식
npm run typecheck # 순수성이 타입으로 증명된다
```

이 패키지의 규칙과 그 근거는 명세 문서에 있다. 코드에서 명세와 갈라진 자리는
전부 주석으로 이유를 남겼고, 테스트가 그 판단을 고정한다.
