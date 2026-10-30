export interface Metadata {
  schema_version: '1.0'; snapshot_id: string; demo_mode: true; synthetic: true; scenario: string;
}
export interface Rational { numerator: string; denominator: string }
export interface Origin { source: string; line: number; raw_text_sha256: string }
export interface Evidence {
  event_id: string; order_id: string | null; restaurant_id: string;
  type: string; occurred_at: string; origins: Origin[];
}
export interface Diagnostic {
  code: string; message?: string | null; event_id?: string | null; order_id?: string | null;
  affected_order_ids?: string[]; affected_event_types?: string[]; origins?: Origin[];
  evidence?: Evidence[]; conflict_event_ids?: string[]; stage?: string | null;
  severity?: string | null; classification?: string | null; fatal?: boolean;
}
export interface Source { event_id: string; event_type: string; field: string; timestamp: string; origins: Origin[] }
export interface Metric {
  name: string; value: Rational | null; unit: string; reason: string | null; formula: string;
  sources: Source[]; supporting_event_ids: string[]; evidence_quality: string;
  order_resolution: string; order_evidence_quality: string; available: boolean;
  conflicts: Diagnostic[]; issues: Diagnostic[];
}
export interface Eligibility { eligible: boolean; reason: string | null; supporting_event_ids: string[] }
export interface Exclusion { order_id: string; reason: string }
export interface Aggregate {
  name: string; value: Rational | number | null; unit: string; reason: string | null;
  formula: string; criteria: string; included_order_ids: string[]; excluded_orders: Exclusion[];
  supporting_events: [string, string][]; evidence_quality: string; numerator: number | null;
  denominator: number | null; numerator_order_ids: string[]; denominator_order_ids: string[]; available: boolean;
}
export interface Order {
  order_id: string; restaurant_id: string | null; status: string | null; resolution: string;
  evidence_quality: string; metrics: Record<string, Metric>; eligibility: Record<string, Eligibility>;
  timeline_event_ids: string[]; applied_event_ids: string[]; status_event_ids: string[];
  inconsistencies: Diagnostic[]; ingestion_conflicts: Diagnostic[];
}
export interface Overview {
  order_count: number; aggregates: Record<string, Aggregate>; diagnostic_count: number;
  scope: string; excluded_histories: Exclusion[];
}
export interface ReplayEvent extends Evidence { elapsed_us: string; applied_to_order: boolean }
export interface Frame { index: number; event_id: string | null; elapsed_us: string; orders: Order[]; overview: Overview }
export interface ReplayResponse extends Metadata {
  events: ReplayEvent[]; frames: Frame[]; duration_us: string;
  start_at: string | null; end_at: string | null; compression: string;
}
export interface OverviewResponse extends Metadata, Overview {}
export interface OrdersResponse extends Metadata { orders: Order[] }
export interface OrderResponse extends Metadata { order: Order }
export interface DiagnosticsResponse extends Metadata { diagnostics: Diagnostic[]; evidence_catalog: Evidence[] }
export interface Bundle { replay: ReplayResponse; overview: OverviewResponse; orders: OrdersResponse; diagnostics: DiagnosticsResponse }
