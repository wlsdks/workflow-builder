/**
 * packages/layout-core/eslint.config.js
 *
 * LAYOUT §14.2의 금지 import를 린트로 못 박는다.
 *
 * 방어는 4중이다.
 *   1) tsconfig       — DOM 없는 lib + types: []      → 전역 접근이 컴파일 에러
 *   2) eslint         — 아래 no-restricted-imports    → 패키지 import가 린트 에러
 *   3) package.json   — dependencies에 elkjs가 없다   → 애초에 설치돼 있지 않다
 *   4) scripts/gates.mjs `layout-core-no-elkjs`       → 배포 차단
 */

export default [
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'react/*'], message: 'layout-core는 순수 기하다. React는 apps/web에.' },
            { group: ['@xyflow/*'], message: '위와 같음.' },
            {
              group: ['elkjs', 'elkjs/*'],
              message: 'ElkNode는 types.ts의 구조적 타입으로 다룬다. 인스턴스 생성은 apps/web/lib/layout/pool.ts.',
            },
            { group: ['@workflow/graph-core/src/*'], message: '배럴(index.ts)만 import한다.' },
            { group: ['node:*', 'fs', 'path', 'crypto'], message: 'Node 전역 금지. 브라우저·워커·엣지에서도 돌아야 한다.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'layout-core는 브라우저를 모른다.' },
        { name: 'document', message: 'layout-core는 DOM을 모른다.' },
        { name: 'navigator', message: '위와 같음.' },
        { name: 'performance', message: '시간은 호출자가 재서 elapsedMs로 넘긴다.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: '난수는 레이아웃 결정성을 깬다.' },
        { object: 'Date', property: 'now', message: '현재 시각은 순수 함수의 입력이 아니다.' },
      ],
    },
  },
];
