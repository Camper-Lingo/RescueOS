"""Contrato de evento v0.1. Campos adicionais são dados, nunca instruções."""

from datetime import datetime
import re

CONTRACT_VERSION = "0.1"
ORDER_TYPES = frozenset({
    "ORDER_CREATED", "KITCHEN_STARTED", "KITCHEN_READY", "COURIER_ASSIGNED",
    "COURIER_ARRIVED", "PICKED_UP", "DELIVERED", "ORDER_CANCELLED",
})
RESTAURANT_TYPES = frozenset({"RESTAURANT_CAPACITY_UPDATED", "PROMOTION_STARTED"})
TIMESTAMP = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})"
)


def timestamp_valid(value):
    """Perfil ISO 8601 explícito, com segundos e offset (ou Z)."""
    if not isinstance(value, str) or not TIMESTAMP.fullmatch(value):
        return False
    if value.endswith("-00:00"):
        return False  # Offset desconhecido não identifica um instante confiável.
    if not value.endswith("Z"):
        if int(value[-5:-3]) > 23 or int(value[-2:]) > 59:
            return False
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.utcoffset() is not None
    except ValueError:
        return False


def validate_event(event):
    """Retorna (código, mensagem) para cada violação; não modifica o objeto."""
    if not isinstance(event, dict):
        return [("INVALID_STRUCTURE", "A linha deve conter um objeto JSON.")]
    issues = []

    def issue(code, message):
        issues.append((code, message))

    required = {"event_id", "order_id", "restaurant_id", "occurred_at", "type", "data"}
    for field in sorted(required - event.keys()):
        issue("MISSING_FIELD", f"Campo obrigatório ausente: {field}.")
    for field in ("event_id", "restaurant_id", "type"):
        if field in event and (not isinstance(event[field], str) or not event[field].strip()):
            issue("INVALID_FIELD", f"{field} deve ser uma string não vazia.")
    kind = event.get("type")
    if isinstance(kind, str) and kind not in ORDER_TYPES | RESTAURANT_TYPES:
        issue("UNKNOWN_EVENT_TYPE", f"Tipo de evento desconhecido: {kind}.")
    if "order_id" in event:
        order = event["order_id"]
        if order is not None and (not isinstance(order, str) or not order.strip()):
            issue("INVALID_FIELD", "order_id deve ser string não vazia ou null.")
        elif order is None and isinstance(kind, str) and kind in ORDER_TYPES:
            issue("INVALID_FIELD", "Eventos de pedido exigem order_id não nulo.")
    if "occurred_at" in event and not timestamp_valid(event["occurred_at"]):
        issue("INVALID_TIMESTAMP", "occurred_at exige timestamp ISO 8601 válido com offset explícito.")
    data = event.get("data")
    if "data" in event and not isinstance(data, dict):
        issue("INVALID_FIELD", "data deve ser um objeto JSON.")
    if not isinstance(data, dict):
        return issues

    fields = {
        "ORDER_CREATED": {"promised_ready_at": "timestamp", "promised_delivery_at": "timestamp"},
        "RESTAURANT_CAPACITY_UPDATED": {"max_concurrent_orders": "count", "active_preparations": "count"},
        "PROMOTION_STARTED": {"promotion_id": "string", "source": "string"},
    }.get(kind if isinstance(kind, str) else "", {})
    for field, rule in fields.items():
        if field not in data:
            issue("MISSING_FIELD", f"Campo obrigatório ausente: data.{field}.")
            continue
        value = data[field]
        if rule == "timestamp" and not timestamp_valid(value):
            issue("INVALID_TIMESTAMP", f"data.{field} exige timestamp ISO 8601 válido com offset explícito.")
        elif rule == "count" and (type(value) is not int or value < 0):
            issue("INVALID_FIELD", f"data.{field} deve ser inteiro não negativo.")
        elif rule == "string" and (not isinstance(value, str) or not value.strip()):
            issue("INVALID_FIELD", f"data.{field} deve ser string não vazia.")
    if kind == "ORDER_CANCELLED":
        if "reason_reported" in data and not isinstance(data["reason_reported"], str):
            issue("INVALID_FIELD", "data.reason_reported deve ser string.")
        if "reason_verified" in data and type(data["reason_verified"]) is not bool:
            issue("INVALID_FIELD", "data.reason_verified deve ser booleano.")
    return issues
