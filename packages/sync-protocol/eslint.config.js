/**
 * packages/sync-protocol/eslint.config.js
 *
 * 이 패키지가 가질 수 있는 런타임 의존성은 **zod 하나뿐이다.**
 * 여기에 zustand나 drizzle이 들어오는 순간 "와이어 스키마"라는 경계가 사라지고,
 * 서버 액션·클라이언트·웹워커가 같은 패키지를 못 쓰게 된다 (D-119).
 *
 * graph-core에서 값을 import 하는 것도 막는다 — 이 패키지는 graph-core의
 * **타입만** 참조한다. 리듀서가 두 벌이 되면 반드시 어긋난다.
 */

export default [
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'react/*'], message: '스키마는 UI를 모른다.' },
            { group: ['@xyflow/*', 'elkjs', 'elkjs/*'], message: '레이아웃은 앱 레이어의 일이다.' },
            { group: ['drizzle-orm', 'drizzle-orm/*', 'pg', 'postgres'], message: 'DB 접근 금지.' },
            { group: ['next', 'next/*', 'zustand', 'immer', 'idb'], message: '동기화 런타임은 sync-client의 일이다.' },
            { group: ['node:*', 'fs', 'path', 'crypto'], message: '서버·브라우저·엣지에서 모두 돌아야 한다.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'sync-protocol은 브라우저를 모른다.' },
        { name: 'document', message: 'sync-protocol은 DOM을 모른다.' },
      ],
    },
  },
];
