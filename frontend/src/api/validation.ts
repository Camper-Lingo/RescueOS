import type { Bundle, OrderResponse } from '../types/api.ts';

export class ApiError extends Error {
  readonly kind: 'offline' | 'http' | 'schema';
  constructor(kind: ApiError['kind'], message: string) { super(message); this.kind = kind; }
}

function invalid(): never {
  throw new ApiError('schema', 'Os dados recebidos da API estão incompletos ou inconsistentes. Tente novamente.');
}
type Check = (value: unknown) => void;
const text: Check = value => { if (typeof value !== 'string') invalid(); };
// Whitespace de Python str.strip(): inclui C0/NEL; U+FEFF é conteúdo, sem normalizar IDs.
const identifierContent = /[^\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
const identifier: Check = value => { if (typeof value !== 'string' || !identifierContent.test(value)) invalid(); };
const boolean: Check = value => { if (typeof value !== 'boolean') invalid(); };
const natural: Check = value => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(); };
const match = (pattern: RegExp): Check => value => { if (typeof value !== 'string' || !pattern.test(value)) invalid(); };
const oneOf = (...allowed: unknown[]): Check => value => { if (!allowed.includes(value)) invalid(); };
const nullable = (check: Check): Check => value => { if (value !== null) check(value); };
const optional = (check: Check): Check => value => { if (value !== undefined) check(value); };
const list = (check: Check): Check => value => { if (!Array.isArray(value)) invalid(); value.forEach(check); };
function record(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
}
const object = (fields: Record<string, Check>): Check => value => {
  record(value); for (const [key, check] of Object.entries(fields)) check(value[key]);
};
const dictionary = (check: Check): Check => value => { record(value); Object.values(value).forEach(check); };
// Diagnósticos podem preservar strings inválidas (até vazias) das variantes rejeitadas.
const strings = list(text), nullableText = nullable(text);
const decimal = match(/^\d+$/), sha256 = match(/^[a-f0-9]{64}$/);
// Forma HTTP; calendário e regras operacionais continuam validados pelo núcleo.
const timestamp = match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const metadata = { schema_version: oneOf('1.0'), snapshot_id: sha256, demo_mode: oneOf(true), synthetic: oneOf(true), scenario: text };
const rational = object({ numerator: match(/^-?\d+$/), denominator: match(/^[1-9]\d*$/) });
const origin = object({ source: text, line: value => { natural(value); if (value === 0) invalid(); }, raw_text_sha256: sha256 });
const evidenceFields = { event_id: identifier, order_id: nullable(identifier), restaurant_id: identifier, type: identifier, occurred_at: timestamp, origins: list(origin) };
const evidence = object(evidenceFields);
const diagnostic = object({ code: text, message: optional(nullableText), event_id: optional(nullableText), order_id: optional(nullableText),
  affected_order_ids: optional(strings), affected_event_types: optional(strings), origins: optional(list(origin)), evidence: optional(list(evidence)),
  conflict_event_ids: optional(strings), stage: optional(nullableText), severity: optional(nullableText), classification: optional(nullableText), fatal: optional(boolean) });
const source = object({ event_id: identifier, event_type: identifier, field: identifier, timestamp, origins: list(origin) });
const resolution = oneOf('CONSISTENT', 'INCONSISTENT', 'AMBIGUOUS', 'INCOMPLETE');
const orderQuality = oneOf('NO_LINKED_CONFLICTS', 'INCOMPLETE');
const available = (check: Check): Check => value => {
  check(value); record(value); if (value.available !== (value.value !== null)) invalid();
};
const metric = available(object({ name: text, value: nullable(rational), unit: text, reason: nullableText, formula: text,
  sources: list(source), supporting_event_ids: strings, evidence_quality: oneOf('SUFFICIENT', 'INSUFFICIENT', 'INCOMPLETE', 'INCONSISTENT', 'AMBIGUOUS', 'NOT_APPLICABLE'),
  order_resolution: resolution, order_evidence_quality: orderQuality, available: boolean, conflicts: list(diagnostic), issues: list(diagnostic) }));
const eligibility = object({ eligible: boolean, reason: nullableText, supporting_event_ids: strings });
const exclusion = object({ order_id: text, reason: text });
const pair: Check = value => { if (!Array.isArray(value) || value.length !== 2) invalid(); value.forEach(text); };
const aggregate = available(object({ name: text, value: nullable(value => { if (typeof value === 'number') natural(value); else rational(value); }),
  unit: text, reason: nullableText, formula: text, criteria: text, included_order_ids: strings, excluded_orders: list(exclusion), supporting_events: list(pair),
  evidence_quality: oneOf('COMPLETE', 'PARTIAL'), numerator: nullable(natural), denominator: nullable(natural),
  numerator_order_ids: strings, denominator_order_ids: strings, available: boolean }));
const metricNames = ['delivery_deviation', 'delivery_delay', 'delivery_earliness', 'kitchen_delay', 'courier_waiting_time'];
const aggregateNames = ['total_created', 'total_delivered', 'total_cancelled', 'total_late_deliveries', 'total_on_time_deliveries', 'delay_rate', 'cancellation_rate'];
const named = (names: string[], check: Check): Check => value => {
  dictionary(check)(value); record(value);
  for (const name of names) { check(value[name]); record(value[name]); if (value[name].name !== name) invalid(); }
};
const order = object({ order_id: identifier, restaurant_id: nullable(identifier), status: nullable(oneOf('CREATED', 'PREPARING', 'READY', 'PICKED_UP', 'DELIVERED', 'CANCELLED')),
  resolution, evidence_quality: orderQuality, metrics: named(metricNames, metric), eligibility: dictionary(eligibility),
  timeline_event_ids: strings, applied_event_ids: strings, status_event_ids: strings, inconsistencies: list(diagnostic), ingestion_conflicts: list(diagnostic) });
const overviewFields = { order_count: natural, aggregates: named(aggregateNames, aggregate), diagnostic_count: natural, scope: text, excluded_histories: list(exclusion) };
const frame = object({ index: natural, event_id: nullableText, elapsed_us: decimal, orders: list(order), overview: object(overviewFields) });

function assertShape(value: unknown): asserts value is Bundle {
  object({ replay: object({ ...metadata, events: list(object({ ...evidenceFields, elapsed_us: decimal, applied_to_order: boolean })),
    frames: list(frame), duration_us: decimal, start_at: nullable(timestamp), end_at: nullable(timestamp), compression: text }),
  overview: object({ ...metadata, ...overviewFields }), orders: object({ ...metadata, orders: list(order) }),
  diagnostics: object({ ...metadata, diagnostics: list(diagnostic), evidence_catalog: list(evidence) }) })(value);
}
function assertIndividual(value: unknown): asserts value is OrderResponse { object({ ...metadata, order })(value); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function validateBundle(value: unknown): Bundle {
  assertShape(value);
  const { replay, overview, orders, diagnostics } = value;
  if (![overview, orders, diagnostics].every(part => part.snapshot_id === replay.snapshot_id && part.scenario === replay.scenario)) invalid();
  if (replay.frames.length !== replay.events.length + 1 || replay.frames[0].event_id !== null || replay.frames[0].elapsed_us !== '0' || replay.frames[0].orders.length) invalid();
  const prefix = new Set<string>();
  for (let index = 0; index < replay.frames.length; index++) {
    const current = replay.frames[index], event = replay.events[index - 1];
    if (current.index !== index || current.overview.order_count !== current.orders.length || new Set(current.orders.map(item => item.order_id)).size !== current.orders.length) invalid();
    if (event) {
      if (prefix.has(event.event_id) || current.event_id !== event.event_id || current.elapsed_us !== event.elapsed_us
        || (index === 1 ? BigInt(event.elapsed_us) !== 0n : BigInt(event.elapsed_us) < BigInt(replay.events[index - 2].elapsed_us))) invalid();
      prefix.add(event.event_id);
    }
    for (const item of current.orders) {
      if (![...item.timeline_event_ids, ...item.applied_event_ids, ...item.status_event_ids].every(id => prefix.has(id))) invalid();
      for (const measurement of Object.values(item.metrics)) {
        if (measurement.order_resolution !== item.resolution || measurement.order_evidence_quality !== item.evidence_quality) invalid();
        if (!measurement.sources.every(ref => prefix.has(ref.event_id)) || !measurement.supporting_event_ids.every(id => prefix.has(id))) invalid();
      }
    }
  }
  const last = replay.frames.at(-1)!;
  if (replay.duration_us !== (replay.events.at(-1)?.elapsed_us ?? '0')
    || replay.start_at !== (replay.events[0]?.occurred_at ?? null) || replay.end_at !== (replay.events.at(-1)?.occurred_at ?? null)
    || canonical(last.orders) !== canonical(orders.orders)) invalid();
  for (const key of Object.keys(overviewFields) as (keyof typeof overviewFields)[]) if (canonical(last.overview[key]) !== canonical(overview[key])) invalid();
  return value;
}

export function validateOrderResponse(value: unknown, id: string, snapshotId?: string): OrderResponse {
  assertIndividual(value);
  if (value.order.order_id !== id || snapshotId !== undefined && value.snapshot_id !== snapshotId) invalid();
  for (const measurement of Object.values(value.order.metrics)) {
    if (measurement.order_resolution !== value.order.resolution || measurement.order_evidence_quality !== value.order.evidence_quality) invalid();
  }
  return value;
}
