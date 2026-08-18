/**
 * packages/paste-parse/eslint.config.js
 *
 * PARSING §12.4 — 이 패키지는 그대로 웹워커에 올라간다. 그래서 graph-core와 같은
 * 3중 방어를 건다.
 *   1) tsconfig  — `lib`에 DOM 없음 + `types: []`      → 전역 접근이 컴파일 에러
 *   2) eslint    — 아래 no-restricted-imports          → 패키지 import가 린트 에러
 *   3) package.json — dependencies가 영구히 비어 있음   → 애초에 설치돼 있지 않음
 */

export default [
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'react/*'], message: 'paste-parse는 순수 패키지다 (D-033).' },
            { group: ['@xyflow/*', 'elkjs', 'elkjs/*'], message: '레이아웃은 앱 레이어의 일이다.' },
            { group: ['drizzle-orm', 'drizzle-orm/*', 'pg', 'postgres'], message: 'DB 접근 금지. 순수 값만 받는다.' },
            { group: ['next', 'next/*', 'zustand', 'immer'], message: '프레임워크·상태관리 의존 금지.' },
            { group: ['node:*', 'fs', 'path', 'crypto'], message: 'Node 전역 금지. 워커에서도 돌아야 한다 (PARSING §12.4).' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'paste-parse는 브라우저를 모른다.' },
        { name: 'document', message: 'paste-parse는 DOM을 모른다.' },
        { name: 'process', message: 'paste-parse는 런타임 환경을 모른다.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: '난수는 파싱의 결정성을 깬다. ID는 호출자가 발급한다 (PARSING §11 읽는 법).' },
        { object: 'Date', property: 'now', message: '현재 시각은 순수 함수의 입력이 아니다.' },
      ],
    },
  },
];
