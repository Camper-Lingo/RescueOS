import type { Bundle, Diagnostic, Origin, Rational, Source } from '../types/api.ts';
import type { Zone } from '../simulation/replay.ts';
import type { AgentEvent } from './agentStream.ts';
import { envelope, invalidAgent, natural, object, readAgentStream, streamAudit, text } from './agentStream.ts';
import { canonical, diagnostic, identifier, origin, rational, source } from './validation.ts';
import { getJson } from './client.ts';

export interface ScoutScope { snapshot_id: string; frame_index: number }
export interface ScoutAlert {
  alert_id: string; code: string; order_id: string | null; category: 'attention' | 'information' | 'evidence';
  title: string; explanation: string; metric_name: string | null; value: Rational | null;
  sources: Source[]; origins: Origin[]; anchor_event_id: string | null; anchor_frame: number | null;
  zone: Zone | null; diagnostic_codes: string[]; diagnostics: Diagnostic[];
}
export interface ScoutEvent extends AgentEvent, ScoutScope {
  schema_version: 'scout.1'; phase?: string; alerts?: ScoutAlert[]; highlighted_alert_ids?: string[];
  focus?: 'overview' | 'timing' | 'evidence'; explanation?: string;
  thresholds?: { courier_wait_minutes: number }; unknowns?: string[];
}
const tools = ['get_operations_overview', 'get_operations_orders', 'get_operations_alerts'];
const metrics: Record<string, string> = { DELIVERY_DELAY: 'delivery_delay', KITCHEN_DELAY: 'kitchen_delay', COURIER_WAIT: 'courier_waiting_time' };
const zones: Record<string, string | null> = { DELIVERY_DELAY: null, KITCHEN_DELAY: 'kitchen', COURIER_WAIT: 'pickup', CANCELLED: 'incident', EVIDENCE_LIMITED: 'incident', PENDING_DATA: null };
const explanations: Record<string, string> = {
  overview: 'Este retrato reúne ocorrências observadas no quadro analisado. Não é previsão e não determina causas.',
  timing: 'Os intervalos destacados vêm dos eventos. A sequência temporal não demonstra causa ou responsabilidade.',
  evidence: 'Há limites de evidência nos destaques. Consulte as origens antes de interpretar os resultados.',
};
function strings(v: unknown): asserts v is string[] { if (!Array.isArray(v)) throw invalidAgent(); v.forEach(text); }
function thresholds(v: unknown) {
  object(v); natural(v.courier_wait_minutes);
  if (Object.keys(v).length !== 1 || (v.courier_wait_minutes as number) > 120) throw invalidAgent();
}
function validateAlerts(raw: unknown, scope: ScoutScope, bundle: Bundle, waitLimit: number) {
  if (!Array.isArray(raw)) throw invalidAgent();
  const prefix = bundle.replay.events.slice(0, scope.frame_index), frame = bundle.replay.frames[scope.frame_index];
  const seen = new Set<string>(), rules = new Set<string>();
  const knownDiagnostics = new Set([...bundle.diagnostics.diagnostics, ...frame.orders.flatMap(o => o.inconsistencies)].map(canonical));
  for (const a of raw) {
    object(a); text(a.alert_id); text(a.code); text(a.title); text(a.explanation);
    if (Object.keys(a).length !== 15 || !/^[a-f0-9]{64}$/.test(a.alert_id as string) || seen.has(a.alert_id as string)
      || !['attention', 'information', 'evidence'].includes(String(a.category))) throw invalidAgent();
    seen.add(a.alert_id as string);
    if (a.order_id !== null) identifier(a.order_id);
    const unprojected = String(a.code).startsWith('UNPROJECTED_CONFLICT:');
    const order = frame.orders.find(o => o.order_id === a.order_id);
    const rule = canonical([a.order_id, a.code]);
    const category = unprojected || a.code === 'EVIDENCE_LIMITED' ? 'evidence' : metrics[String(a.code)] ? 'attention' : 'information';
    if (rules.has(rule) || a.category !== category) throw invalidAgent();
    rules.add(rule);
    if ((!unprojected && (!Object.hasOwn(zones, String(a.code)) || !order))
      || a.zone !== (unprojected ? null : zones[String(a.code)])) throw invalidAgent();
    if (!Array.isArray(a.sources) || !Array.isArray(a.origins) || !Array.isArray(a.diagnostics)) throw invalidAgent();
    strings(a.diagnostic_codes);
    for (const d of a.diagnostics) { diagnostic(d); if (!knownDiagnostics.has(canonical(d))) throw invalidAgent(); }
    const codes = [...new Set(a.diagnostics.map(d => d.code))].sort();
    if (canonical(codes) !== canonical(a.diagnostic_codes)) throw invalidAgent();
    for (const ref of a.sources) {
      source(ref);
      const e = prefix.find(e => e.event_id === ref.event_id);
      if (!e || e.order_id !== a.order_id || e.type !== ref.event_type || canonical(ref.origins) !== canonical(e.origins)) throw invalidAgent();
      const allowed = [{ event_id: e.event_id, event_type: e.type, field: 'occurred_at', timestamp: e.occurred_at, origins: e.origins },
        ...Object.values(order?.metrics ?? {}).flatMap(m => m.sources)];
      if (!allowed.some(s => canonical(s) === canonical(ref))) throw invalidAgent();
    }
    a.origins.forEach(origin);
    const allOrigins = [...a.sources.flatMap(s => s.origins), ...a.diagnostics.flatMap(d => d.origins ?? [])];
    const unique = [...new Map(allOrigins.map(o => [canonical(o), o])).values()];
    if (canonical(a.origins) !== canonical(unique)) throw invalidAgent();
    const metricName = metrics[String(a.code)];
    if (metricName) {
      rational(a.value); object(a.value);
      const m = order!.metrics[metricName];
      if (Object.keys(a.value).length !== 2 || a.metric_name !== metricName || !m?.available
        || canonical(m.value) !== canonical(a.value) || canonical(m.sources) !== canonical(a.sources)) throw invalidAgent();
      if (BigInt(a.value.numerator as string) <= BigInt(a.code === 'COURIER_WAIT' ? waitLimit : 0) * BigInt(a.value.denominator as string)) throw invalidAgent();
    } else if (a.value !== null || a.metric_name !== null) throw invalidAgent();
    const limited = order && (order.resolution !== 'CONSISTENT' || order.evidence_quality === 'INCOMPLETE');
    const cancelled = order?.eligibility.cancelled?.eligible === true;
    if (a.code === 'CANCELLED' && (order?.status !== 'CANCELLED' || !cancelled
      || a.sources.length !== order.status_event_ids.length || !a.sources.length
      || a.sources.some(s => s.event_type !== 'ORDER_CANCELLED' || s.field !== 'occurred_at'
        || !order.status_event_ids.includes(s.event_id) || !order.applied_event_ids.includes(s.event_id)))) throw invalidAgent();
    if (a.code === 'EVIDENCE_LIMITED' && !limited
      || a.code === 'PENDING_DATA' && (limited || cancelled || !Object.values(order!.metrics).some(m => !m.available))) throw invalidAgent();
    if (!metricName && order) {
      const ids = order.status_event_ids.length ? order.status_event_ids : order.applied_event_ids;
      const expected = ids.flatMap(id => {
        const e = prefix.find(e => e.event_id === id);
        return e ? [{ event_id: id, event_type: e.type, field: 'occurred_at', timestamp: e.occurred_at, origins: e.origins }] : [];
      });
      const issues = a.code === 'EVIDENCE_LIMITED' ? [...order.inconsistencies,
        ...bundle.diagnostics.diagnostics.filter(d => d.code === 'EVENT_ID_CONFLICT' && d.affected_order_ids?.includes(order.order_id))] : [];
      if (canonical(a.sources) !== canonical(expected) || canonical(a.diagnostics) !== canonical(issues)) throw invalidAgent();
    } else if (metricName && a.diagnostics.length) throw invalidAgent();
    if (a.anchor_event_id === null) { if (a.anchor_frame !== null) throw invalidAgent(); }
    else {
      identifier(a.anchor_event_id); natural(a.anchor_frame);
      if (!a.sources.some(s => s.event_id === a.anchor_event_id)
        || prefix.findIndex(e => e.event_id === a.anchor_event_id) + 1 !== a.anchor_frame) throw invalidAgent();
    }
    if (unprojected && (a.order_id !== null || a.sources.length || a.anchor_frame !== null
      || a.diagnostics.length !== 1 || !a.diagnostics.some(d => d.code === 'EVENT_ID_CONFLICT'
        && a.code === 'UNPROJECTED_CONFLICT:' + d.event_id
        && (!d.affected_order_ids?.length || d.affected_order_ids.some((id: string) => !frame.orders.some(o => o.order_id === id)))))) throw invalidAgent();
  }
}

export async function analyzeScout(scope: ScoutScope, bundle: Bundle, onEvent: (e: ScoutEvent) => void,
  signal: AbortSignal, fetcher: typeof fetch = fetch) {
  if (scope.snapshot_id !== bundle.replay.snapshot_id || !Number.isSafeInteger(scope.frame_index)
    || !bundle.replay.frames[scope.frame_index]) throw invalidAgent();
  // A separate snapshot read prevents a stream from redefining its own complete catalog.
  const query = new URLSearchParams({ snapshot_id: scope.snapshot_id, frame_index: String(scope.frame_index) });
  const reference = await getJson(`scout/catalog?${query}`, AbortSignal.any([signal, AbortSignal.timeout(10_000)]), fetcher);
  object(reference);
  if (Object.keys(reference).length !== 6 || reference.schema_version !== 'scout.1'
    || reference.snapshot_id !== scope.snapshot_id || reference.frame_index !== scope.frame_index) throw invalidAgent();
  thresholds(reference.thresholds); strings(reference.unknowns);
  validateAlerts(reference.alerts, scope, bundle, (reference.thresholds as { courier_wait_minutes: number }).courier_wait_minutes);
  const catalog = structuredClone({ alerts: reference.alerts, thresholds: reference.thresholds, unknowns: reference.unknowns });
  const audit = streamAudit(tools.length);
  let receivedCatalog = false;
  await readAgentStream('/api/v1/scout/analyze', scope, raw => {
    envelope(raw, scope, 'scout.1', tools, scope);
    if ('order_id' in raw) throw invalidAgent();
    if (raw.type === 'tool_result') {
      object(raw.result); strings(raw.result.unknowns);
      if (raw.name === tools[0]) {
        const expected = { overview: bundle.replay.frames[scope.frame_index].overview,
          context: bundle.replay.events.slice(0, scope.frame_index).filter(e => e.order_id === null), unknowns: [] };
        if (canonical(expected) !== canonical(raw.result)) throw invalidAgent();
      } else if (raw.name === tools[1]) {
        if (canonical({ orders: bundle.replay.frames[scope.frame_index].orders, unknowns: [] }) !== canonical(raw.result)) throw invalidAgent();
      } else {
        if (canonical(raw.result) !== canonical(catalog)) throw invalidAgent();
        receivedCatalog = true;
      }
    }
    if (raw.type === 'completed') {
      if (!receivedCatalog || canonical(raw.alerts) !== canonical(catalog.alerts) || canonical(raw.thresholds) !== canonical(catalog.thresholds)
        || canonical(raw.unknowns) !== canonical(catalog.unknowns)) throw invalidAgent();
      strings(raw.highlighted_alert_ids); text(raw.explanation);
      const selected = raw.highlighted_alert_ids.map(id => (catalog!.alerts as ScoutAlert[]).find(a => a.alert_id === id));
      if (selected.length > 12 || new Set(raw.highlighted_alert_ids).size !== selected.length || selected.some(a => !a)
        || !Object.hasOwn(explanations, String(raw.focus)) || raw.explanation !== explanations[String(raw.focus)]
        || raw.focus === 'timing' && !selected.some(a => a!.metric_name)
        || raw.focus === 'evidence' && !selected.some(a => a!.category === 'evidence')) throw invalidAgent();
    }
    const event = raw as unknown as ScoutEvent;
    audit(event); onEvent(event);
    return event.type === 'completed' || event.type === 'error';
  }, signal, fetcher);
}
