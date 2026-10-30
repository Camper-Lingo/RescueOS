"""Replay v0.1: projeção pura de eventos aceitos pela ingestão (ADR-005)."""

from copy import deepcopy
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone

from .contracts import RESTAURANT_TYPES
from .ingest import Diagnostic, IngestResult, Origin

REPLAY_VERSION = "0.1"
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_TERMINALS = {"DELIVERED", "ORDER_CANCELLED"}
_PREREQUISITES = {
    "KITCHEN_STARTED": (),
    "KITCHEN_READY": ("KITCHEN_STARTED",),
    "COURIER_ASSIGNED": (),
    "COURIER_ARRIVED": ("COURIER_ASSIGNED",),
    "PICKED_UP": ("KITCHEN_READY", "COURIER_ARRIVED"),
    "DELIVERED": ("PICKED_UP",),
    "ORDER_CANCELLED": (),
}
_PHASES = {
    "ORDER_CREATED": "CREATED", "KITCHEN_STARTED": "PREPARING",
    "KITCHEN_READY": "READY", "PICKED_UP": "PICKED_UP",
    "DELIVERED": "DELIVERED", "ORDER_CANCELLED": "CANCELLED",
}


@dataclass(frozen=True)
class Evidence:
    event: dict
    # Auditoria pode variar com linhas/duplicatas, sem mudar a projeção de negócio.
    origins: tuple[Origin, ...] = field(default=(), compare=False)


@dataclass(frozen=True)
class Inconsistency:
    code: str
    message: str
    evidence: tuple[Evidence, ...]


@dataclass(frozen=True)
class OrderReplay:
    order_id: str
    restaurant_id: str | None
    status: str | None
    resolution: str  # CONSISTENT, INCOMPLETE, INCONSISTENT ou AMBIGUOUS.
    timeline: tuple[Evidence, ...]
    applied_event_ids: tuple[str, ...]
    status_event_ids: tuple[str, ...]
    inconsistencies: tuple[Inconsistency, ...]
    evidence_quality: str = "NO_LINKED_CONFLICTS"
    ingestion_conflicts: tuple[Diagnostic, ...] = field(default=(), compare=False)


@dataclass(frozen=True)
class OrphanHistory:
    order_id: str
    timeline: tuple[Evidence, ...]
    inconsistencies: tuple[Inconsistency, ...]
    evidence_quality: str = "INCOMPLETE"
    ingestion_conflicts: tuple[Diagnostic, ...] = field(default=(), compare=False)


@dataclass(frozen=True)
class ReplayResult:
    orders: dict[str, OrderReplay]
    orphan_histories: dict[str, OrphanHistory]
    operational_context: tuple[Evidence, ...]
    ingestion_errors: tuple[Diagnostic, ...] = field(compare=False)

    @property
    def inconsistencies(self):
        return tuple(issue for group in (self.orders, self.orphan_histories)
                     for history in group.values() for issue in history.inconsistencies)


def _instant(timestamp):
    # Subtração aware usa o instante UTC; não arredonda e não estoura em anos
    # 0001/9999 cujos offsets levariam astimezone() além da faixa de datetime.
    return datetime.fromisoformat(timestamp) - _EPOCH


def _key(evidence):
    event = evidence.event
    return _instant(event["occurred_at"]), event["event_id"]


def _creation_signature(evidence):
    event = evidence.event
    return (event["restaurant_id"], _instant(event["occurred_at"]),
            _instant(event["data"]["promised_ready_at"]),
            _instant(event["data"]["promised_delivery_at"]))


def _project(order_id, timeline):
    creations = tuple(e for e in timeline if e.event["type"] == "ORDER_CREATED")
    anchor = creations[0]
    restaurant = anchor.event["restaurant_id"]
    issues = []
    ambiguous = False

    def record(code, message, *evidence):
        issues.append(Inconsistency(code, message, tuple(sorted(evidence, key=_key))))

    for creation in creations[1:]:
        incompatible = _creation_signature(creation) != _creation_signature(anchor)
        record("INCOMPATIBLE_CREATIONS" if incompatible else "MULTIPLE_CREATIONS",
               "Criações incompatíveis." if incompatible else "Criação redundante com outro ID.",
               anchor, creation)
        ambiguous |= incompatible

    # Afirmações terminais contraditórias permanecem ambíguas mesmo se faltar
    # um pré-requisito para aplicar uma delas. Não escolher vencedor por ID.
    terminal_claims = tuple(e for e in timeline if e.event["type"] in _TERMINALS
                            and _key(e) > _key(anchor)
                            and e.event["restaurant_id"] == restaurant)
    if len({e.event["type"] for e in terminal_claims}) > 1:
        record("CONFLICTING_TERMINALS", "Há evidências de entrega e cancelamento.", *terminal_claims)
        ambiguous = True

    observed = {}
    applied = []
    status = None
    status_id = None
    terminal = None
    for evidence in timeline:
        event = evidence.event
        kind = event["type"]
        mismatch = event["restaurant_id"] != restaurant
        if mismatch:
            record("RESTAURANT_MISMATCH", "Restaurante diverge da criação de referência.", anchor, evidence)
            ambiguous = True
        if _key(evidence) < _key(anchor):
            record("EVENT_BEFORE_CREATION", "Evento anterior à criação na ordem (UTC, event_id).", evidence, anchor)
            continue
        if terminal is not None:
            record("EVENT_AFTER_TERMINAL", "Evento posterior a estado terminal; não altera o estado.", terminal, evidence)
            continue
        if mismatch:
            continue
        if kind == "ORDER_CREATED":
            if evidence is not anchor:
                continue
        else:
            if kind in observed:
                record("REPEATED_MILESTONE", "Marco repetido com outro ID; preservada a primeira observação.", observed[kind], evidence)
                continue
            missing = tuple(name for name in _PREREQUISITES[kind] if name not in observed)
            if missing:
                record("MISSING_PREREQUISITE", "Pré-requisitos não observados: " + ", ".join(missing) + ".", evidence)
                continue
        observed[kind] = evidence
        applied.append(event["event_id"])
        if kind in _PHASES:
            status = _PHASES[kind]
            status_id = event["event_id"]
        if kind in _TERMINALS:
            terminal = evidence

    resolution = "AMBIGUOUS" if ambiguous else "INCONSISTENT" if issues else "CONSISTENT"
    return OrderReplay(
        order_id, None if any(e.event["restaurant_id"] != restaurant for e in timeline) else restaurant,
        None if ambiguous else status, resolution, timeline, tuple(applied),
        () if ambiguous or status_id is None else (status_id,), tuple(issues),
    )


def replay(ingestion: IngestResult) -> ReplayResult:
    """Recebe somente a saída da Etapa 1. Não revalida nem deduplica eventos.

    Timeline inclui eventos incoerentes; applied_event_ids distingue a projeção.
    As origens e erros são auditoria, excluídos da igualdade de negócio.
    """
    if not isinstance(ingestion, IngestResult):
        raise TypeError("replay exige IngestResult produzido pela Etapa 1.")
    conflicts_by_order = {}
    for error in ingestion.errors:
        if error.code == "EVENT_ID_CONFLICT":
            for order_id in error.affected_order_ids:
                conflicts_by_order.setdefault(order_id, []).append(error)
    evidence = tuple(sorted((Evidence(deepcopy(event), tuple(ingestion.origins_by_id.get(event["event_id"], ())))
                             for event in ingestion.events), key=_key))
    context = []
    groups = {}
    for entry in evidence:
        event = entry.event
        # Classificação por tipo: mesmo contexto com order_id preenchido não
        # cria um pedido nem participa de suas transições.
        if event["type"] in RESTAURANT_TYPES:
            context.append(entry)
        else:
            groups.setdefault(event["order_id"], []).append(entry)
    orders = {}
    orphans = {}
    for order_id, entries in sorted(groups.items()):
        timeline = tuple(entries)
        conflicts = tuple(sorted(conflicts_by_order.get(order_id, ()),
                                 key=lambda error: error.event_id or ""))
        if not any(e.event["type"] == "ORDER_CREATED" for e in timeline):
            orphans[order_id] = OrphanHistory(order_id, timeline, tuple(
                Inconsistency("ORDER_NOT_CREATED", "Não há criação aceita para este histórico.", (e,))
                for e in timeline), ingestion_conflicts=conflicts)
        else:
            order = _project(order_id, timeline)
            if conflicts:
                # Lacunas conhecidas qualificam a conclusão sem aplicar variantes
                # excluídas nem inventar uma transição inválida ou ambiguidade.
                order = replace(order, evidence_quality="INCOMPLETE",
                                resolution="INCOMPLETE" if order.resolution == "CONSISTENT" else order.resolution,
                                ingestion_conflicts=conflicts)
            orders[order_id] = order
    return ReplayResult(orders, orphans, tuple(context), tuple(ingestion.errors))
