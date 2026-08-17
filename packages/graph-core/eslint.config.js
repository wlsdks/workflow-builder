/**
 * packages/graph-core/eslint.config.js
 *
 * §12 금지 import를 **린트로 못 박는다.**
 *
 * "React를 import 하지 말자"는 합의는 6개월이면 깨진다. 어느 날 누가
 * `import { useMemo }`를 넣고, 그 순간 이 패키지는 RSC·웹워커·서버 익스포터에서
 * 못 쓰게 된다. 규칙을 사람의 기억에 두지 않는다.
 *
 * 방어는 3중이다.
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
            { group: ['react', 'react-dom', 'react/*'], message: 'graph-core는 순수 패키지다 (D-033).' },
            { group: ['@xyflow/*', 'elkjs', 'elkjs/*'], message: '레이아웃은 앱 레이어의 일이다.' },
            { group: ['drizzle-orm', 'drizzle-orm/*', 'pg', 'postgres'], message: 'DB 접근 금지. 순수 값만 받는다.' },
            { group: ['next', 'next/*', 'zustand', 'immer'], message: '프레임워크·상태관리 의존 금지.' },
            { group: ['node:*', 'fs', 'path', 'crypto'], message: 'Node 전역 금지. 브라우저·워커·엣지에서도 돌아야 한다.' },
            { group: ['@blocknote/*'], message: '에디터 JSON은 도메인 모델이 아니다 (D-034).' },
          ],
        },
      ],
      // 결정성 계약: 같은 입력이면 언제 어디서 돌려도 같은 출력
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'graph-core는 브라우저를 모른다.' },
        { name: 'document', message: 'graph-core는 DOM을 모른다.' },
        { name: 'process', message: 'graph-core는 런타임 환경을 모른다.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: '난수는 derive()의 결정성을 깬다. ID는 호출자가 발급한다.' },
        { object: 'Date', property: 'now', message: '현재 시각은 순수 함수의 입력이 아니다. 필요하면 옵션으로 주입하라.' },
      ],
    },
  },
];
