"""Relatórios determinísticos e publicação local (ADR-007)."""

from dataclasses import fields, is_dataclass
import hashlib
import html
import json
import os
from pathlib import Path
from fractions import Fraction
import tempfile
import unicodedata

from .ingest import IngestResult, Origin
from .metrics import AggregateMetric, METRICS_VERSION, Metric, MetricsResult
from .replay import Evidence, REPLAY_VERSION, ReplayResult

REPORT_VERSION = "1.0"
REPORT_NAMES = ("summary.json", "report.md", "errors.json")


def _event(event):
    # Não copiar payloads arbitrários para os relatórios.
    return {key: event[key] for key in
            ("event_id", "order_id", "restaurant_id", "type", "occurred_at")}


def _convert(value, *, audit=False):
    if isinstance(value, Fraction):
        return {"numerator": value.numerator, "denominator": value.denominator}
    if isinstance(value, Origin):
        return {"source": value.source, "line": value.line,
                "raw_text_sha256": hashlib.sha256(value.raw.encode("utf-8", errors="surrogatepass")).hexdigest()}
    if isinstance(value, Evidence):
        result = _event(value.event)
        if audit:
            result["origins"] = _convert(value.origins, audit=True)
        return result
    if is_dataclass(value):
        result = {f.name: _convert(getattr(value, f.name), audit=audit) for f in fields(value)
                  if f.name not in {"raw", "origins"} or audit and f.name == "origins"}
        if isinstance(value, (Metric, AggregateMetric)):
            result["available"] = value.available
        return result
    if isinstance(value, dict):
        return {key: _convert(item, audit=audit) for key, item in sorted(value.items())}
    if isinstance(value, (tuple, list)):
        return [_convert(item, audit=audit) for item in value]
    return value


def _json(value):
    # ASCII escapado também suporta IDs com surrogates aceitos pela ingestão.
    return json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2, allow_nan=False) + "\n"


def _md(value):
    text = str(value)
    text = "".join(f"\\u{ord(c):04x}" if unicodedata.category(c).startswith("C") else c for c in text)
    text = html.escape(text, quote=True)
    for char in "\\`*_{}[]()#+!|":
        text = text.replace(char, "\\" + char)
    return text


def _number(value):
    if value is None:
        return "indisponível"
    if isinstance(value, dict):
        n, d = value["numerator"], value["denominator"]
        return str(n) if d == 1 else f"{n}/{d}"
    return str(value)


def _markdown(summary):
    lines = ["# RescueOS — relatório operacional", "", f"Execução: {summary['run_id']}", "",
             "Dados sintéticos. Snapshot dos eventos aceitos; sem previsão de desfechos futuros.", "",
             "## Indicadores calculados", "", "| Indicador | Valor | Unidade | Qualidade | Motivo |",
             "|---|---:|---|---|---|"]
    for name, aggregate in summary["aggregates"].items():
        lines.append("| " + " | ".join(map(_md, (name, _number(aggregate["value"]), aggregate["unit"],
                                                  aggregate["evidence_quality"], aggregate["reason"] or "—"))) + " |")
    lines += ["", "## Critérios, populações e exclusões", ""]
    for name, aggregate in summary["aggregates"].items():
        lines += [f"- {_md(name)}: {_md(aggregate['criteria'])}",
                  f"  Fórmula: {_md(aggregate['formula'])}. Incluídos: {_md(', '.join(aggregate['included_order_ids']) or 'nenhum')}."]
        if aggregate["denominator"] is not None:
            lines.append(f"  Numerador/denominador: {aggregate['numerator']}/{aggregate['denominator']}.")
        for exclusion in aggregate["excluded_orders"]:
            lines.append(f"  Exclusão: {_md(exclusion['order_id'])} — {_md(exclusion['reason'])}.")
    lines += ["", "## Fatos observados e indicadores por pedido", ""]
    for oid, order in summary["orders"].items():
        projection, indicators = order["replay"], order["indicators"]
        lines += [f"### {_md(oid)}", "",
                  f"Estado reconstruído: {_md(projection['status'] or 'AMBIGUOUS')}. "
                  f"Resolução: {_md(projection['resolution'])}. Evidência: {_md(projection['evidence_quality'])}.", ""]
        for name, metric in indicators["metrics"].items():
            lines += [f"- {_md(name)}: {_md(_number(metric['value']))} {_md(metric['unit'])}; "
                      f"{_md(metric['evidence_quality'])}; motivo: {_md(metric['reason'] or '—')}.",
                      f"  Fórmula: {_md(metric['formula'])}."]
            for source in metric["sources"]:
                lines.append(f"  Fonte: {_md(source['event_id'])}, {_md(source['field'])} = {_md(source['timestamp'])}.")
            lines.append(f"  Apoio: {_md(', '.join(metric['supporting_event_ids']) or 'nenhum')}.")
        lines += ["", "Cronologia aceita (aplicação indicada separadamente):", ""]
        for event in projection["timeline"]:
            applied = event["event_id"] in projection["applied_event_ids"]
            lines.append(f"- {_md(event['occurred_at'])} — {_md(event['event_id'])}: {_md(event['type'])}; aplicado={applied}.")
        for issue in projection["inconsistencies"]:
            ids = ", ".join(e["event_id"] for e in issue["evidence"])
            lines.append(f"- Aviso: {_md(issue['code'])}; {_md(issue['message'])}; eventos: {_md(ids)}.")
        for conflict in projection["ingestion_conflicts"]:
            lines.append(f"- Evidência excluída: {_md(conflict['code'])}, {_md(conflict['event_id'])}; "
                         f"tipos: {_md(', '.join(conflict['affected_event_types']))}.")
        lines.append("")
    lines += ["## Contexto operacional", ""]
    for event in summary["operational_context"]:
        lines.append(f"- {_md(event['event_id'])}: {_md(event['type'])} em {_md(event['occurred_at'])}.")
    lines += ["", "## Integridade e limitações", "",
              "- COMPLETE refere-se às evidências conhecidas, não à completude universal.",
              "- PARTIAL indica exclusões incertas; contagens são observações elegíveis.",
              "- Indisponível não é zero. Denominador vazio não define uma taxa.",
              "- Origens físicas e diagnósticos detalhados estão em errors.json; payloads brutos não são exportados.",
              "- Linhas rejeitadas sem pedido identificável não permitem medir a população desconhecida.",
              "- Interpretação: não é atribuída responsabilidade por atraso ou cancelamento.", ""]
    return "\n".join(lines)


def build_reports(ingestion: IngestResult, projection: ReplayResult, metrics: MetricsResult):
    """Renderiza três textos sem I/O; os argumentos devem vir da mesma execução."""
    if not isinstance(ingestion, IngestResult) or not isinstance(projection, ReplayResult) or not isinstance(metrics, MetricsResult):
        raise TypeError("build_reports exige IngestResult, ReplayResult e MetricsResult íntegros.")
    summary = {
        "schema_version": REPORT_VERSION,
        "versions": {"reporting": REPORT_VERSION, "replay": REPLAY_VERSION, "metrics": METRICS_VERSION},
        "scope": metrics.scope, "order_count": len(metrics.orders),
        "orders": {oid: {"replay": _convert(projection.orders[oid]), "indicators": _convert(order)}
                   for oid, order in sorted(metrics.orders.items())},
        "aggregates": _convert(metrics.aggregates),
        "operational_context": _convert(projection.operational_context),
        "excluded_histories": _convert(metrics.excluded_histories),
        "diagnostic_order_ids": _convert(metrics.diagnostic_order_ids),
    }
    summary["run_id"] = hashlib.sha256(_json(summary).encode("utf-8")).hexdigest()
    diagnostics = []
    for diagnostic in (*ingestion.errors, *ingestion.duplicates):
        diagnostics.append({"stage": "ingest", "fatal": False,
                            "severity": "INFO" if diagnostic.code == "DUPLICATE_EVENT" else "ERROR",
                            "classification": "duplicate" if diagnostic.code == "DUPLICATE_EVENT" else
                            "conflict" if diagnostic.code == "EVENT_ID_CONFLICT" else "invalid_event",
                            **_convert(diagnostic, audit=True)})
    for groups in (projection.orders, projection.orphan_histories):
        for oid, order in sorted(groups.items()):
            for issue in order.inconsistencies:
                diagnostics.append({"stage": "replay", "fatal": False, "severity": "WARNING", "classification": "inconsistency",
                                    "order_id": oid, **_convert(issue, audit=True)})
            if order.evidence_quality == "INCOMPLETE":
                diagnostics.append({"stage": "replay", "fatal": False, "severity": "WARNING", "classification": "incomplete_evidence",
                                    "code": "INCOMPLETE_EVIDENCE", "order_id": oid,
                                    "conflict_event_ids": sorted(c.event_id for c in order.ingestion_conflicts)})
    # A ordenação não depende da posição em listas de erros recebidas.
    diagnostics.sort(key=_json)
    catalog = [{**_event(event), "origins": _convert(ingestion.origins_by_id.get(event["event_id"], ()), audit=True)}
               for event in sorted(ingestion.events, key=lambda event: event["event_id"])]
    errors = {"schema_version": REPORT_VERSION, "run_id": summary["run_id"],
              "diagnostics": diagnostics, "evidence_catalog": catalog}
    return {"summary.json": _json(summary), "report.md": _markdown(summary), "errors.json": _json(errors)}


class ReportWriteError(OSError):
    """Falha primária e problemas secundários, sem perder backups de recuperação."""

    def __init__(self, original_error=None, *, rollback_errors=(), cleanup_errors=(),
                 recovery_backups=(), publication_completed=False):
        self.original_error = original_error
        self.rollback_errors = tuple(rollback_errors)
        self.cleanup_errors = tuple(cleanup_errors)
        self.recovery_backups = tuple(sorted(recovery_backups))
        self.publication_completed = publication_completed
        if original_error is not None:
            message = f"Falha ao publicar relatórios: {original_error}"
            if self.rollback_errors:
                message += "; restauração incompleta; rollback: " + "; ".join(
                    f"{name}: {error}" for name, error in self.rollback_errors)
                message += "; backups: " + (", ".join(map(str, self.recovery_backups)) or "nenhum")
            else:
                message += "; destinos anteriores preservados"
        else:
            message = "Publicação concluída; falha na limpeza de temporários"
        if self.cleanup_errors:
            message += "; limpeza: " + "; ".join(f"{path}: {error}" for path, error in self.cleanup_errors)
        super().__init__(message)


def _cleanup(paths, protected=()):
    failures = []
    for path in paths:
        if path is not None and path not in protected:
            try:
                path.unlink(missing_ok=True)
            except OSError as error:
                failures.append((path, error))
    return failures


def _stage(directory, content):
    path = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", prefix=".rescueos-", suffix=".tmp", dir=directory, delete=False) as file:
            path = Path(file.name)
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
        return path
    except BaseException as error:
        failures = _cleanup((path,))
        if failures:
            if isinstance(error, OSError):
                raise ReportWriteError(error, cleanup_errors=failures) from error
            error.add_note("Falhas de limpeza: " + "; ".join(f"{p}: {e}" for p, e in failures))
        raise


def write_reports(reports, output_dir, *, input_path):
    """Prepara todos os arquivos e substitui por arquivo; rollback de OSError comum.

    Não é uma transação entre arquivos contra quedas/concorrência (ADR-007).
    """
    if set(reports) != set(REPORT_NAMES) or not all(isinstance(v, str) for v in reports.values()):
        raise ValueError("São necessários exatamente summary.json, report.md e errors.json, em texto.")
    source = Path(input_path).resolve(strict=True)
    if not source.is_file():
        raise ValueError("A entrada deve ser um arquivo regular.")
    directory = Path(output_dir).resolve()
    if directory.exists() and not directory.is_dir():
        raise ValueError("O diretório de saída não é um diretório.")
    for name in REPORT_NAMES:
        target = directory / name
        if target.is_symlink() or target.resolve() == source or target.exists() and target.samefile(source):
            raise ValueError(f"Destino inseguro ou coincide com a entrada: {name}")
        if target.exists() and not target.is_file():
            raise ValueError(f"Destino não é um arquivo regular: {name}")
    directory.mkdir(parents=True, exist_ok=True)
    staged, backups, published = {}, {}, []
    recovery = set()
    original_error = None
    rollback_errors, cleanup_errors = [], []
    publication_completed = False
    try:
        # Nenhum destino é substituído antes de todos os temporários estarem prontos.
        for name in REPORT_NAMES:
            target = directory / name
            staged[name] = _stage(directory, reports[name].encode("utf-8"))
            backups[name] = _stage(directory, target.read_bytes()) if target.exists() else None
        for name in REPORT_NAMES:
            os.replace(staged[name], directory / name)
            published.append(name)
        publication_completed = True
    except OSError as error:
        original_error = error.original_error if isinstance(error, ReportWriteError) else error
        if isinstance(error, ReportWriteError):
            cleanup_errors.extend(error.cleanup_errors)
        for name in reversed(published):
            try:
                if backups[name] is None:
                    (directory / name).unlink()
                else:
                    os.replace(backups[name], directory / name)
            except OSError as rollback_error:
                rollback_errors.append((name, rollback_error))
                if backups[name] is not None:
                    recovery.add(backups[name])
    finally:
        cleanup_errors.extend(_cleanup((*staged.values(), *backups.values()), recovery))
    if original_error is not None or cleanup_errors:
        raise ReportWriteError(original_error, rollback_errors=rollback_errors, cleanup_errors=cleanup_errors,
                               recovery_backups=recovery, publication_completed=publication_completed
                               ) from (original_error if original_error is not None else cleanup_errors[0][1])
