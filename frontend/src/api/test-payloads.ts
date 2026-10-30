import type { Aggregate, Bundle, Overview } from '../types/api.ts';

/** Resposta vazia completa do contrato HTTP; somente testes, nunca fallback de produto. */
export function emptyBundle(): Bundle {
  const meta = { schema_version: '1.0', snapshot_id: 'a'.repeat(64), demo_mode: true, synthetic: true, scenario: 'test' } as const;
  const aggregates: Record<string, Aggregate> = {};
  for (const name of ['total_created', 'total_delivered', 'total_cancelled', 'total_late_deliveries', 'total_on_time_deliveries', 'delay_rate', 'cancellation_rate']) {
    const ratio = name.endsWith('rate');
    aggregates[name] = { name, value: ratio ? null : 0, available: !ratio, unit: ratio ? 'ratio' : 'count',
      reason: ratio ? 'ZERO_DENOMINATOR' : null, formula: '', criteria: '', included_order_ids: [], excluded_orders: [],
      supporting_events: [], evidence_quality: 'COMPLETE', numerator: ratio ? 0 : null, denominator: ratio ? 0 : null,
      numerator_order_ids: [], denominator_order_ids: [] };
  }
  const overview: Overview = { order_count: 0, aggregates, diagnostic_count: 0, scope: 'test', excluded_histories: [] };
  return { replay: { ...meta, events: [], frames: [{ index: 0, event_id: null, elapsed_us: '0', orders: [], overview: structuredClone(overview) }],
    duration_us: '0', start_at: null, end_at: null, compression: 'test' }, overview: { ...meta, ...overview },
  orders: { ...meta, orders: [] }, diagnostics: { ...meta, diagnostics: [], evidence_catalog: [] } };
}
