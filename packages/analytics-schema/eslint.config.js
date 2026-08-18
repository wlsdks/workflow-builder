/**
 * packages/analytics-schema/eslint.config.js
 *
 * 순수성 3중 방어 중 2번째.
 *   1) tsconfig     — lib에 DOM 없음 + types: []  → 전역 접근이 컴파일 에러
 *   2) eslint       — 아래 규칙                    → 패키지 import가 린트 에러
 *   3) package.json — dependencies 최소            → 애초에 설치돼 있지 않음
 *
 * "그러지 말자"는 합의는 6개월이면 깨진다. 규칙을 사람의 기억에 두지 않는다.
 */

export default [
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'react/*'], message: '순수 패키지다. UI는 앱 레이어의 일이다.' },
            { group: ['@xyflow/*', 'elkjs', 'elkjs/*'], message: '레이아웃 의존 금지.' },
            { group: ['drizzle-orm', 'drizzle-orm/*', 'pg', 'postgres'], message: 'DB 접근 금지. 순수 값만 받는다.' },
            { group: ['next', 'next/*', 'zustand', 'immer'], message: '프레임워크·상태관리 의존 금지.' },
            { group: ['node:*', 'fs', 'path', 'crypto'], message: 'Node 전역 금지. 브라우저·워커·엣지에서도 돌아야 한다.' },
          ],
        },
      ],
      // Date.now()/Math.random()은 결정성을 깬다 — 골든 픽스처가 성립하지 않는다
      'no-restricted-globals': ['error', { name: 'Date', message: '시각은 인자로 받는다. 결정성이 골든 픽스처의 전제다.' }],
    },
  },
];
