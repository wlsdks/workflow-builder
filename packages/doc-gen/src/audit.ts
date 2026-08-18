/**
 * packages/doc-gen/src/audit.ts
 *
 * 생성 문장 수집기.
 *
 * ★ 이 파일이 존재하는 이유는 딱 하나다 — **엔진이 쓴 글자와 사람이 쓴 글자를
 *   조립 시점에 구분해서 기록해 두기 위해서.** 나중에 완성된 문서를 보고
 *   되짚으면 그 구분은 복원할 수 없고, 복원 못 하면 금지어 검사가 사용자 원문까지
 *   검사하게 된다. 그 순간 이 제품은 사용자 글을 고치기 시작한다 (§4.0 ①).
 *
 * 사용법 — 태그드 템플릿이 그 구분을 문법으로 만든다.
 *
 *     gen.s`${name} 님이 ${tools}로 해요.`
 *          └ 사용자 원문        └ 엔진 문장 (리터럴 부분)
 *
 * 보간값은 기본적으로 **사용자 원문**으로 본다. 엔진이 만든 조각을 보간할 때는
 * `E(...)`로 감싼다. 기본값을 안전한 쪽(=검사 안 함)이 아니라 보수적인 쪽으로
 * 두고 싶었지만, 반대로 두면 이름·도구명 하나가 금지어를 품는 순간
 * 남의 이름을 고치라는 요구가 되어서 이렇게 뒀다.
 */

/** 엔진이 만든 조각임을 표시한다 */
export class EnginePart {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
  toString(): string {
    return this.text;
  }
}

export const E = (text: string | number): EnginePart => new EnginePart(String(text));

export type SentenceRecord = {
  /** 최종 문장 — 길이 검사 대상 */
  text: string;
  /** 그중 엔진이 쓴 조각만 이어붙인 것 — 금지어·느낌표·이모지 검사 대상 */
  engine: string;
};

export class Gen {
  readonly records: SentenceRecord[] = [];

  /** 태그드 템플릿. 리터럴 = 엔진, 보간 = 사용자 (E()로 감싸면 엔진) */
  s(strings: TemplateStringsArray, ...values: unknown[]): string {
    let text = '';
    let engine = '';
    strings.forEach((lit, i) => {
      text += lit;
      engine += lit;
      if (i < values.length) {
        const v = values[i];
        if (v === undefined || v === null) return;
        const str = String(v);
        text += str;
        if (v instanceof EnginePart) engine += str;
      }
    });
    return this.record(text, engine);
  }

  /** 전부 엔진이 쓴 고정 문구 */
  raw(text: string): string {
    return this.record(text, text);
  }

  /** 전부 사용자 원문. 기록하지 않는다 — 검사 대상이 아니다 */
  user(text: string): string {
    return text;
  }

  private record(text: string, engine: string): string {
    const t = text.trim();
    if (t.length > 0) this.records.push({ text: t, engine: engine.trim() });
    return text;
  }
}
