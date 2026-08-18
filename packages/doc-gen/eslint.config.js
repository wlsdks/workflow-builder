/**
 * packages/doc-gen/eslint.config.js
 *
 * graph-core와 같은 3중 방어를 doc-gen에도 건다.
 *   1) tsconfig  — `lib`에 DOM 없음 + `types: []`  → 전역 접근이 컴파일 에러
 *   2) eslint    — 아래 규칙                        → import·전역·비결정성이 린트 에러
 *   3) package.json — dependencies가 영구히 비어 있음
 *
 * 그리고 이 패키지에만 있는 규칙이 하나 더 있다 — **`Date.now()` 금지.**
 * 문서에 찍히는 날짜는 전부 호출자가 준 것이어야 한다. 엔진이 오늘 날짜를
 * 읽는 순간 D-063("엔진은 숫자를 새로 만들지 않는다")이 깨지고,
 * 잘못된 마감일 하나가 가산세를 만든다 (§10.4).
 */

export default [
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'react/*'], message: 'doc-gen은 순수 함수 패키지다.' },
            { group: ['@xyflow/*', 'elkjs', 'elkjs/*'], message: '문서 생성기는 레이아웃을 모른다.' },
            { group: ['drizzle-orm', 'drizzle-orm/*', 'pg', 'postgres'], message: 'DB 접근 금지. 순수 값만 받는다.' },
            { group: ['next', 'next/*', 'zustand', 'immer'], message: '프레임워크·상태관리 의존 금지.' },
            { group: ['node:*', 'fs', 'path', 'crypto'], message: 'Node 전역 금지. 브라우저·워커·엣지에서도 돌아야 한다.' },
            { group: ['@workflow/graph-core'], message: 'graph-core는 peer/dev다. 값으로 import 하지 않고 타입만 구조적으로 받는다.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'doc-gen은 브라우저를 모른다.' },
        { name: 'document', message: 'doc-gen은 DOM을 모른다.' },
        { name: 'process', message: 'doc-gen은 런타임 환경을 모른다.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: '난수는 문서 생성의 결정성을 깬다.' },
        {
          object: 'Date',
          property: 'now',
          message: '문서 날짜는 호출자가 준다. 엔진은 날짜를 만들지 않는다 (D-063).',
        },
      ],
    },
  },
];
