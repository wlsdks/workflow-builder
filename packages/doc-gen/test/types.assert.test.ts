/**
 * packages/doc-gen/test/types.assert.test.ts
 *
 * **컴파일되는 것 자체가 테스트다.** 실행할 단언은 하나뿐이고, 진짜 검사는
 * `tsc --noEmit -p tsconfig.test.json`이 한다.
 *
 * D-062를 런타임 검사만으로 막으면, 막히는 시점이 "이미 그 코드를 짠 뒤"다.
 * 렌더 입력 타입에 비공개 노트 필드가 **아예 없어야** 하고, 얹으려는 시도가
 * 타입 검사에서 죽어야 한다. 아래 `@ts-expect-error`가 그걸 고정한다 —
 * 만약 언젠가 그 필드가 허용되면 이 파일의 타입 검사가 깨진다.
 */

import { ok as assertOk } from 'node:assert/strict';
import { it } from 'node:test';

import type { NoNotes, RenderableStep, Step } from '../src/types.ts';

const ok: RenderableStep = { id: 'a', kind: 'task', title: '단계 제목을 적어요' };
void ok;

// @ts-expect-error 비공개 노트는 렌더 입력에 존재할 수 없다 (D-062)
const leaky: RenderableStep = { id: 'a', kind: 'task', title: '단계', privateNote: '남한테 안 보이는 메모' };
void leaky;

// 짜증 플래그도 마찬가지로 렌더 입력 타입에 자리가 없다
// @ts-expect-error
const pain: RenderableStep = { id: 'a', kind: 'task', title: '단계', painFlag: true };
void pain;

// 브랜드는 어떤 타입에도 씌울 수 있다
type Wrapped = NoNotes<{ note?: string }>;
const wrapped: Wrapped = { note: '공개 각주' };
void wrapped;

// 원본 Step에는 애초에 그 필드가 없다 — 있으면 아래가 통과해버린다
type HasNoteField = 'privateNote' extends keyof Step ? true : false;
const noNoteField: HasNoteField = false;
void noNoteField;

it('비공개 노트는 타입 레벨에서 막힌다 — 이 파일이 컴파일된 것이 그 증거다', () => {
  assertOk(true);
});
