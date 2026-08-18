/**
 * packages/analytics-schema — 공개 API.
 *
 * D-119: `graph-core`의 `dependencies: {}`는 영구 계약이므로 zod 스키마는 여기 산다.
 */

export {
  CommonContext,
  AnonymousContext,
  ANONYMOUS_EVENTS,
  SMALL_DEPT_BUCKET,
  TenureBand,
  Surface,
  EntryContext,
  EVENT_SCHEMAS,
  EVENT_NAMES,
  parseEvent,
} from './events.ts';

export type { EventName, EventParseResult, EventRejection } from './events.ts';

export {
  FORBIDDEN_PROPERTIES,
  FORBIDDEN_PATTERNS,
  FREEFORM_STRING_ALLOWLIST,
  findForbiddenProps,
  screenPayload,
} from './forbidden.ts';

export type { ForbiddenHit } from './forbidden.ts';
