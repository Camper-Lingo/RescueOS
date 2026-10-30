"""Snapshot temporal imutável da fixture, reutilizando as quatro etapas aprovadas."""

from dataclasses import dataclass, replace
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from types import MappingProxyType
from typing import Mapping

from rescueos.ingest import read_jsonl
from rescueos.metrics import compute_metrics
from rescueos.replay import replay
from rescueos.reporting import build_reports

ROOT = Path(__file__).resolve().parents[2]
DEMO_FIXTURE = ROOT / "fixtures" / "demo_events.jsonl"
API_VERSION = "1.0"
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _instant(timestamp):
    # Mesma ordem contratual (instante UTC, event_id), inclusive extremos do calendário.
    return datetime.fromisoformat(timestamp) - EPOCH


def _micros(delta):
    return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds


def _wire(value):
    if isinstance(value, dict):
        if set(value) == {"numerator", "denominator"}:
            # O browser usa BigInt; não perder inteiros grandes ao fazer JSON.parse.
            return {key: str(number) for key, number in value.items()}
        result = {key: _wire(item) for key, item in value.items()}
        if {"source", "line", "raw_text_sha256"} <= set(result):
            result["source"] = Path(result["source"]).name
        return result
    if isinstance(value, list):
        return [_wire(item) for item in value]
    return value


def _overview(summary, diagnostic_count):
    return {"order_count": summary["order_count"], "aggregates": summary["aggregates"],
            "diagnostic_count": diagnostic_count, "scope": summary["scope"],
            "excluded_histories": summary["excluded_histories"]}


def _orders(summary, catalog):
    orders = []
    for oid, data in sorted(summary["orders"].items()):
        projection, indicators = data["replay"], data["indicators"]
        for metric in indicators["metrics"].values():
            for source in metric["sources"]:
                source["origins"] = catalog[source["event_id"]]["origins"]
        orders.append({
            "order_id": oid, "restaurant_id": projection["restaurant_id"],
            "status": projection["status"], "resolution": projection["resolution"],
            "evidence_quality": projection["evidence_quality"], "metrics": indicators["metrics"],
            "eligibility": indicators["eligibility"],
            "timeline_event_ids": [event["event_id"] for event in projection["timeline"]],
            "applied_event_ids": projection["applied_event_ids"], "status_event_ids": projection["status_event_ids"],
            "inconsistencies": projection["inconsistencies"],
            "ingestion_conflicts": projection["ingestion_conflicts"],
        })
    return orders


def _project(ingestion):
    projection = replay(ingestion)
    metrics = compute_metrics(projection)
    reports = build_reports(ingestion, projection, metrics)
    summary = _wire(json.loads(reports["summary.json"]))
    diagnostics = _wire(json.loads(reports["errors.json"]))
    catalog = {event["event_id"]: event for event in diagnostics["evidence_catalog"]}
    return summary, diagnostics, _orders(summary, catalog)


@dataclass(frozen=True)
class Snapshot:
    snapshot_id: str
    _payloads: Mapping[str, str]

    def payload(self, name):
        # Cada resposta recebe uma cópia, sem expor as estruturas do cache.
        return json.loads(self._payloads[name])


def load_snapshot(fixture_path=DEMO_FIXTURE):
    ingestion = read_jsonl(fixture_path)
    ordered = tuple(sorted(ingestion.events, key=lambda event: (_instant(event["occurred_at"]), event["event_id"])))
    summary, diagnostics, orders = _project(ingestion)
    applied = {eid for order in orders for eid in order["applied_event_ids"]}
    first = _instant(ordered[0]["occurred_at"]) if ordered else None
    catalog = {event["event_id"]: event for event in diagnostics["evidence_catalog"]}
    events = [{**catalog[event["event_id"]],
               "elapsed_us": str(_micros(_instant(event["occurred_at"]) - first)),
               "applied_to_order": event["event_id"] in applied}
              for event in ordered]
    frames = []
    for index in range(len(ordered) + 1):
        # Visão temporal dos eventos aceitos; auditoria completa permanece conhecida.
        # Não reparsar/deduplicar nem reinserir variantes excluídas em cada prefixo.
        temporal = replace(ingestion, events=ordered[:index])
        frame_summary, frame_diagnostics, frame_orders = _project(temporal)
        frames.append({"index": index, "event_id": ordered[index - 1]["event_id"] if index else None,
                       "elapsed_us": events[index - 1]["elapsed_us"] if index else "0",
                       "orders": frame_orders,
                       "overview": _overview(frame_summary, len(frame_diagnostics["diagnostics"]))})
    overview = _overview(summary, len(diagnostics["diagnostics"]))
    replay_payload = {"events": events, "frames": frames,
                      "duration_us": events[-1]["elapsed_us"] if events else "0",
                      "start_at": ordered[0]["occurred_at"] if ordered else None,
                      "end_at": ordered[-1]["occurred_at"] if ordered else None,
                      "compression": "1 segundo real = 5 minutos simulados na velocidade 1x"}
    content = {"overview": overview, "orders": {"orders": orders},
               "diagnostics": {"diagnostics": diagnostics["diagnostics"],
                               "evidence_catalog": diagnostics["evidence_catalog"]},
               "replay": replay_payload}
    canonical = json.dumps(content, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    snapshot_id = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    metadata = {"schema_version": API_VERSION, "snapshot_id": snapshot_id,
                "demo_mode": True, "synthetic": True, "scenario": "The Living Restaurant"}
    payloads = {name: json.dumps({**metadata, **payload}, sort_keys=True, ensure_ascii=True)
                for name, payload in content.items()}
    payloads["health"] = json.dumps({**metadata, "status": "ok"}, sort_keys=True)
    for order in orders:
        payloads["order:" + order["order_id"]] = json.dumps({**metadata, "order": order}, sort_keys=True)
    return Snapshot(snapshot_id, MappingProxyType(payloads))
