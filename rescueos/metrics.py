"""Metrics & Evidence Engine v0.1: medidas exatas e elegibilidade (ADR-006)."""

from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
from fractions import Fraction

from .ingest import Diagnostic, Origin
from .replay import Inconsistency, OrderReplay, ReplayResult

METRICS_VERSION = "0.1"
_CREATION = frozenset({"ORDER_CREATED"})
_KITCHEN = _CREATION | {"KITCHEN_STARTED", "KITCHEN_READY"}
_WAITING = _KITCHEN | {"COURIER_ASSIGNED", "COURIER_ARRIVED", "PICKED_UP"}
_DELIVERY = _WAITING | {"DELIVERED", "ORDER_CANCELLED"}
_STATE = _CREATION | {"DELIVERED", "ORDER_CANCELLED"}
_IDENTITY_ISSUES = {"INCOMPATIBLE_CREATIONS", "RESTAURANT_MISMATCH"}
_FORMULAS = {
    "delivery_deviation": "(DELIVERED.occurred_at - ORDER_CREATED.data.promised_delivery_at) / 60s",
    "delivery_delay": "max(0, delivery_deviation)",
    "delivery_earliness": "max(0, -delivery_deviation)",
    "kitchen_delay": "max(0, (KITCHEN_READY.occurred_at - ORDER_CREATED.data.promised_ready_at) / 60s)",
    "courier_waiting_time": "(PICKED_UP.occurred_at - COURIER_ARRIVED.occurred_at) / 60s",
}


@dataclass(frozen=True)
class TimestampSource:
    event_id: str
    event_type: str
    field: str
    timestamp: str
    origins: tuple[Origin, ...] = field(default=(), compare=False)


@dataclass(frozen=True)
class Metric:
    name: str
    value: Fraction | None
    unit: str
    reason: str | None
    formula: str
    sources: tuple[TimestampSource, ...]
    supporting_event_ids: tuple[str, ...]
    evidence_quality: str
    order_resolution: str
    order_evidence_quality: str
    conflicts: tuple[Diagnostic, ...] = field(default=(), compare=False)
    issues: tuple[Inconsistency, ...] = ()

    @property
    def available(self):
        return self.value is not None

    @property
    def event_ids(self):
        return tuple(dict.fromkeys(source.event_id for source in self.sources))


@dataclass(frozen=True)
class Eligibility:
    eligible: bool
    reason: str | None
    supporting_event_ids: tuple[str, ...]


@dataclass(frozen=True)
class OrderMetrics:
    order_id: str
    status: str | None
    resolution: str
    evidence_quality: str
    metrics: dict[str, Metric]
    eligibility: dict[str, Eligibility]


@dataclass(frozen=True)
class Exclusion:
    order_id: str
    reason: str


@dataclass(frozen=True)
class AggregateMetric:
    name: str
    value: int | Fraction | None
    unit: str
    reason: str | None
    formula: str
    criteria: str
    included_order_ids: tuple[str, ...]
    excluded_orders: tuple[Exclusion, ...]
    supporting_events: tuple[tuple[str, str], ...]
    evidence_quality: str
    numerator: int | None = None
    denominator: int | None = None
    numerator_order_ids: tuple[str, ...] = ()
    denominator_order_ids: tuple[str, ...] = ()

    @property
    def available(self):
        return self.value is not None


@dataclass(frozen=True)
class MetricsResult:
    orders: dict[str, OrderMetrics]
    aggregates: dict[str, AggregateMetric]
    excluded_histories: tuple[Exclusion, ...]
    diagnostic_order_ids: tuple[str, ...]
    ingestion_errors: tuple[Diagnostic, ...] = field(compare=False)
    scope: str = "Snapshot de todos os eventos do replay; sem janela temporal ou previsão."


def _minutes(start, end):
    delta = datetime.fromisoformat(end) - datetime.fromisoformat(start)
    microseconds = ((delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds)
    return Fraction(microseconds, 60_000_000)


def _problem_types(issue):
    # As âncoras citadas como contexto não são necessariamente os eventos ruins.
    if issue.code == "EVENT_BEFORE_CREATION":
        evidence = issue.evidence[:1]
    elif issue.code == "EVENT_AFTER_TERMINAL":
        evidence = issue.evidence[-1:]
    else:
        evidence = issue.evidence
    return {e.event["type"] for e in evidence}


def _assess(order, dependencies, *, terminal=False):
    conflicts = tuple(c for c in order.ingestion_conflicts
                      if dependencies.intersection(c.affected_event_types))
    issues = tuple(i for i in order.inconsistencies
                   if i.code in _IDENTITY_ISSUES
                   or (i.code == "CONFLICTING_TERMINALS" and terminal)
                   or (i.code not in _IDENTITY_ISSUES | {"MULTIPLE_CREATIONS", "CONFLICTING_TERMINALS"}
                       and dependencies.intersection(_problem_types(i))))
    if any(i.code in _IDENTITY_ISSUES | {"CONFLICTING_TERMINALS"} for i in issues):
        return "AMBIGUOUS_DEPENDENCY", "AMBIGUOUS", conflicts, issues
    if issues:
        return "INCONSISTENT_DEPENDENCY", "INCONSISTENT", conflicts, issues
    if conflicts:
        return "CONFLICTING_DEPENDENCY", "INCOMPLETE", conflicts, issues
    return None, "SUFFICIENT", conflicts, issues


def _applied(order):
    ids = set(order.applied_event_ids)
    return {e.event["type"]: e for e in order.timeline if e.event["event_id"] in ids}


def _support(applied, dependencies):
    return tuple(e.event["event_id"] for kind, e in applied.items() if kind in dependencies)


def _source(applied, kind, path):
    if kind not in applied:
        return None
    evidence = applied[kind]
    value = evidence.event
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return TimestampSource(evidence.event["event_id"], kind, path, value, evidence.origins)


def _measure(order, applied, name, dependencies, fields, *, terminal=False):
    reason, quality, conflicts, issues = _assess(order, dependencies, terminal=terminal)
    candidates = tuple(_source(applied, kind, path) for kind, path in fields)
    sources = tuple(source for source in candidates if source is not None)
    value = None
    if reason is None:
        if terminal and order.status != "DELIVERED":
            reason, quality = "NOT_DELIVERED", "NOT_APPLICABLE"
        elif len(sources) != len(fields):
            reason, quality = "MISSING_EVIDENCE", "INSUFFICIENT"
        else:
            difference = _minutes(sources[0].timestamp, sources[1].timestamp)
            if name == "courier_waiting_time" and difference < 0:
                reason, quality = "NEGATIVE_WAITING_TIME", "INCONSISTENT"
            elif name in {"delivery_delay", "kitchen_delay"}:
                value = max(Fraction(0), difference)
            elif name == "delivery_earliness":
                value = max(Fraction(0), -difference)
            else:
                value = difference
    return Metric(name, value, "minutes", reason, _FORMULAS[name], sources,
                  _support(applied, dependencies), quality, order.resolution,
                  order.evidence_quality, conflicts, issues)


def _eligibility(order, applied, dependencies, *, terminal=False, required_status=None):
    reason, _, _, _ = _assess(order, dependencies, terminal=terminal)
    if reason is None and "ORDER_CREATED" not in applied:
        reason = "MISSING_CREATION"
    if reason is None and order.status is None and terminal:
        reason = "AMBIGUOUS_STATUS"
    if reason is None and required_status and order.status != required_status:
        reason = "NOT_" + required_status
    return Eligibility(reason is None, reason, _support(applied, dependencies))


def _delivery_eligibility(order, applied, measurement=None):
    # Classificar a população antes de exigir a cadeia de uma entrega.
    classification = _eligibility(order, applied, _STATE, terminal=True)
    if not classification.eligible:
        return classification
    if order.status != "DELIVERED":
        return Eligibility(False, "NOT_DELIVERED", classification.supporting_event_ids)
    if measurement is None:
        return _eligibility(order, applied, _DELIVERY, terminal=True, required_status="DELIVERED")
    return Eligibility(measurement.available, measurement.reason, measurement.supporting_event_ids)


def _order_metrics(order):
    applied = _applied(order)
    delivery_fields = (("ORDER_CREATED", "data.promised_delivery_at"), ("DELIVERED", "occurred_at"))
    metrics = {name: _measure(order, applied, name, _DELIVERY, delivery_fields, terminal=True)
               for name in ("delivery_deviation", "delivery_delay", "delivery_earliness")}
    metrics["kitchen_delay"] = _measure(order, applied, "kitchen_delay", _KITCHEN,
                                        (("ORDER_CREATED", "data.promised_ready_at"), ("KITCHEN_READY", "occurred_at")))
    metrics["courier_waiting_time"] = _measure(order, applied, "courier_waiting_time", _WAITING,
                                              (("COURIER_ARRIVED", "occurred_at"), ("PICKED_UP", "occurred_at")))
    eligibility = {
        "created": _eligibility(order, applied, _CREATION),
        "delivered": _delivery_eligibility(order, applied),
        "cancelled": _eligibility(order, applied, _STATE, terminal=True, required_status="CANCELLED"),
        "cancellation_population": _eligibility(order, applied, _STATE, terminal=True),
        "delivery_population": _delivery_eligibility(order, applied, metrics["delivery_deviation"]),
    }
    return OrderMetrics(order.order_id, order.status, order.resolution, order.evidence_quality, metrics, eligibility)


def _aggregate(orders, excluded_histories, name, population, criteria, *, numerator_filter=None):
    included = tuple(k for k, o in orders.items() if o.eligibility[population].eligible)
    excluded = tuple(Exclusion(k, o.eligibility[population].reason) for k, o in orders.items()
                     if not o.eligibility[population].eligible) + excluded_histories
    support = tuple((k, eid) for k in included for eid in orders[k].eligibility[population].supporting_event_ids)
    uncertain = any(e.reason not in {"NOT_DELIVERED", "NOT_CANCELLED"} for e in excluded)
    quality = "PARTIAL" if uncertain else "COMPLETE"
    if numerator_filter is None:
        return AggregateMetric(name, len(included), "orders", None, "count(distinct eligible order_id)",
                               criteria, included, excluded, support, quality)
    numerator_ids = tuple(k for k in included if numerator_filter(orders[k]))
    denominator = len(included)
    return AggregateMetric(name, Fraction(len(numerator_ids), denominator) if denominator else None,
                           "ratio", None if denominator else "ZERO_DENOMINATOR", "numerator / denominator",
                           criteria, included, excluded, support, quality,
                           len(numerator_ids), denominator, numerator_ids, included)


def compute_metrics(result: ReplayResult) -> MetricsResult:
    """Projeta somente o ReplayResult íntegro. Valores racionais exatos (Fraction).

    Metadados de pedido não substituem a avaliação por dependência. Não há I/O.
    """
    if not isinstance(result, ReplayResult):
        raise TypeError("compute_metrics exige ReplayResult produzido pela Etapa 2.")
    result = deepcopy(result)
    orders = {key: _order_metrics(order) for key, order in sorted(result.orders.items())}
    diagnostic_ids = tuple(sorted({oid for error in result.ingestion_errors for oid in error.affected_order_ids
                                   if oid not in result.orders and oid not in result.orphan_histories}))
    excluded = tuple(sorted(
        [Exclusion(key, "ORDER_NOT_CREATED") for key in result.orphan_histories]
        + [Exclusion(key, "NO_ACCEPTED_HISTORY") for key in diagnostic_ids], key=lambda e: e.order_id))
    aggregates = {}
    specifications = [
        ("total_created", "created", "IDs distintos com criação aplicada e identidade não comprometida."),
        ("total_delivered", "delivered", "Estado DELIVERED; criação, cadeia aplicada e terminais confiáveis."),
        ("total_cancelled", "cancelled", "Estado CANCELLED; criação e classificação terminal confiáveis."),
    ]
    for name, population, criteria in specifications:
        aggregates[name] = _aggregate(orders, excluded, name, population, criteria)
    for name, late in (("total_late_deliveries", True), ("total_on_time_deliveries", False)):
        rate = _aggregate(orders, excluded, name, "delivery_population",
                          "Entregues com delivery_deviation disponível; atraso > 0, no prazo <= 0.",
                          numerator_filter=lambda o, late=late: (o.metrics["delivery_deviation"].value > 0) == late)
        aggregates[name] = AggregateMetric(name, rate.numerator, "orders", None,
                                           "count(eligible delivered orders matching deviation sign)",
                                           rate.criteria, rate.numerator_order_ids, rate.excluded_orders,
                                           rate.supporting_events, rate.evidence_quality)
    aggregates["delay_rate"] = _aggregate(
        orders, excluded, "delay_rate", "delivery_population",
        "Numerador: entregas elegíveis com desvio > 0. Denominador: entregues com desvio disponível.",
        numerator_filter=lambda o: o.metrics["delivery_deviation"].value > 0)
    aggregates["cancellation_rate"] = _aggregate(
        orders, excluded, "cancellation_rate", "cancellation_population",
        "Numerador: estado CANCELLED. Denominador: pedidos criados com classificação atual confiável, inclusive não terminais; snapshot.",
        numerator_filter=lambda o: o.status == "CANCELLED")
    return MetricsResult(orders, aggregates, excluded, diagnostic_ids, result.ingestion_errors)
