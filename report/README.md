# 기획서 (읽는 문서)

`docs/`는 **만드는 사람**을 위한 명세 26편이다. 여기 있는 건 다르다 —
경영진·HR·협업 상대가 **처음부터 끝까지 한 번에 읽는** 15쪽짜리 문서다.

| 파일 | 무엇 |
|---|---|
| `기획서.pdf` | 배포용. A4 15쪽, 쪽번호·목차 포함 |
| `plan.html` | 원본. 화면(라이트/다크)과 인쇄를 같은 파일이 담당한다 |
| `print.mjs` | CDP로 PDF를 뽑는다 |
| `paginate.mjs` | 목차 쪽번호를 실제 PDF에서 읽어 되쓴다 |

## 다시 뽑기

```bash
cd report
node print.mjs    "$PWD/plan.html" "$PWD/기획서.pdf"   # 1차
node paginate.mjs "$PWD/plan.html" "$PWD/기획서.pdf"   # 목차 쪽번호 확정
node print.mjs    "$PWD/plan.html" "$PWD/기획서.pdf"   # 2차 — 이게 최종본
```

**왜 두 번 뽑나.** 목차 쪽번호는 조판 전에 알 수 없다. 손으로 적으면
문단 한 줄만 늘어도 조용히 틀린다 — 이 저장소가 `scripts/doc-numbers.mjs`로
막고 있는 것과 정확히 같은 종류의 거짓말이다. 그래서 1차 PDF에서
`pdftotext`로 각 절이 실제로 시작하는 쪽을 읽어 HTML에 되쓰고 다시 뽑는다.
찾지 못하면 **에러로 죽는다.** 빈칸으로 넘어가지 않는다.

## 필요한 것

- Chrome (`/Applications/Google Chrome.app`) — 헤드리스로 CDP 인쇄
- `pdftotext` · `pdfinfo` (poppler) — 쪽번호 확정용

Chrome CLI의 `--print-to-pdf`는 머리말/꼬리말 템플릿을 받지 못해서
쪽번호를 넣을 수 없다. 그래서 CLI 대신 CDP `Page.printToPDF`를 쓴다.

## 문서 안의 숫자

`docs/`의 주장과 같은 값이어야 한다 — 문서 26개 · 패키지 8개 ·
테스트 784건 · 결정 79건. 이 값들이 바뀌면 `npm run verify`가 `docs/`는
잡지만 **이 PDF는 잡지 못한다.** 갱신은 수동이다.
