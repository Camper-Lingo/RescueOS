"""Contrato HTTP v1; racionais e microssegundos são strings decimais exatas."""

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Metadata(Model):
    schema_version: Literal["1.0"]
    snapshot_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    demo_mode: Literal[True]
    synthetic: Literal[True]
    scenario: str


class Rational(Model):
    numerator: str = Field(pattern=r"^-?\d+$")
    denominator: str = Field(pattern=r"^[1-9]\d*$")


class Origin(Model):
    source: str
    line: int
    raw_text_sha256: str


class Evidence(Model):
    event_id: str
    order_id: str | None
    restaurant_id: str
    type: str
    occurred_at: str
    origins: list[Origin] = Field(default_factory=list)


class Diagnostic(Model):
    code: str
    message: str | None = None
    event_id: str | None = None
    order_id: str | None = None
    affected_order_ids: list[str] = Field(default_factory=list)
    affected_event_types: list[str] = Field(default_factory=list)
    origins: list[Origin] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    conflict_event_ids: list[str] = Field(default_factory=list)
    stage: str | None = None
    severity: str | None = None
    classification: str | None = None
    fatal: bool = False


class Source(Model):
    event_id: str
    event_type: str
    field: str
    timestamp: str
    origins: list[Origin]


class Metric(Model):
    name: str
    value: Rational | None
    unit: str
    reason: str | None
    formula: str
    sources: list[Source]
    supporting_event_ids: list[str]
    evidence_quality: str
    order_resolution: str
    order_evidence_quality: str
    conflicts: list[Diagnostic]
    issues: list[Diagnostic]
    available: bool


class Eligibility(Model):
    eligible: bool
    reason: str | None
    supporting_event_ids: list[str]


class Exclusion(Model):
    order_id: str
    reason: str


class Aggregate(Model):
    name: str
    value: Rational | int | None
    unit: str
    reason: str | None
    formula: str
    criteria: str
    included_order_ids: list[str]
    excluded_orders: list[Exclusion]
    supporting_events: list[tuple[str, str]]
    evidence_quality: str
    numerator: int | None
    denominator: int | None
    numerator_order_ids: list[str]
    denominator_order_ids: list[str]
    available: bool


class Order(Model):
    order_id: str
    restaurant_id: str | None
    status: str | None
    resolution: str
    evidence_quality: str
    metrics: dict[str, Metric]
    eligibility: dict[str, Eligibility]
    timeline_event_ids: list[str]
    applied_event_ids: list[str]
    status_event_ids: list[str]
    inconsistencies: list[Diagnostic]
    ingestion_conflicts: list[Diagnostic]


class Overview(Model):
    order_count: int
    aggregates: dict[str, Aggregate]
    diagnostic_count: int
    scope: str
    excluded_histories: list[Exclusion]


class OverviewResponse(Metadata, Overview):
    pass


class HealthResponse(Metadata):
    status: Literal["ok"]


class OrdersResponse(Metadata):
    orders: list[Order]


class OrderResponse(Metadata):
    order: Order


class DiagnosticsResponse(Metadata):
    diagnostics: list[Diagnostic]
    evidence_catalog: list[Evidence]


class ReplayEvent(Evidence):
    elapsed_us: str = Field(pattern=r"^\d+$")
    applied_to_order: bool


class Frame(Model):
    index: int
    event_id: str | None
    elapsed_us: str
    orders: list[Order]
    overview: Overview


class ReplayResponse(Metadata):
    events: list[ReplayEvent]
    frames: list[Frame]
    duration_us: str
    start_at: str | None
    end_at: str | None
    compression: str
