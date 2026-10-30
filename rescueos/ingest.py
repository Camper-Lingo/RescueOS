"""Leitura e identidade; nenhuma projeção, métrica ou efeito externo."""

from dataclasses import dataclass, field
from decimal import Decimal, DecimalException
import json
import math
from pathlib import Path

from .contracts import validate_event

# Limites locais do contrato numérico; não dependem do contexto global Decimal.
MAX_NUMBER_LENGTH = 128
MAX_COEFFICIENT_DIGITS = 100
MAX_ABS_EXPONENT = 308
MIN_INTEGER = -(2**63)
MAX_INTEGER = 2**63 - 1


@dataclass(frozen=True)
class _Number:
    # O decoder confirma a sintaxe antes de qualquer conversão ou limite.
    token: str
    floating: bool = False


def _integer(token):
    return _Number(token)


def _floating(token):
    return _Number(token, floating=True)


@dataclass(frozen=True)
class Origin:
    source: str
    line: int
    raw: str


@dataclass(frozen=True)
class Diagnostic:
    code: str
    message: str
    origins: tuple[Origin, ...]
    event_id: str | None = None
    affected_order_ids: tuple[str, ...] = ()
    affected_event_types: tuple[str, ...] = ()


@dataclass
class IngestResult:
    # Somente events é entrada de negócio. Origens/diagnósticos são auditoria.
    events: tuple[dict, ...] = ()
    origins_by_id: dict[str, tuple[Origin, ...]] = field(default_factory=dict)
    errors: list[Diagnostic] = field(default_factory=list)
    duplicates: list[Diagnostic] = field(default_factory=list)


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Chave JSON repetida: {key}")
        result[key] = value
    return result


def _nonfinite(value):
    raise ValueError(f"Número não permitido em JSON: {value}")


def _identity(value):
    """Árvore tipada para comparar números decimais sem arredondamento float."""
    if isinstance(value, dict):
        return ("object", tuple((key, _identity(item)) for key, item in sorted(value.items())))
    if isinstance(value, list):
        return ("array", tuple(_identity(item) for item in value))
    if isinstance(value, Decimal):
        sign, digits, exponent = value.as_tuple()
        digits = list(digits)
        while len(digits) > 1 and digits[-1] == 0:
            digits.pop()
            exponent += 1
        if not any(digits):
            exponent = 0
        return ("decimal", sign, tuple(digits), exponent)
    return (type(value).__name__, value)


def _convert_number(number):
    """Converte somente tokens limitados. Erro numérico não é erro de sintaxe."""
    token = number.token
    if len(token) > MAX_NUMBER_LENGTH:
        raise ValueError("literal numérico excede 128 caracteres")
    if not number.floating:
        value = int(token)
        if not MIN_INTEGER <= value <= MAX_INTEGER:
            raise ValueError("inteiro fora da faixa signed int64")
        return value, _identity(value)
    coefficient, separator, exponent = token.lower().partition('e')
    if separator and abs(int(exponent)) > MAX_ABS_EXPONENT:
        raise ValueError("expoente explícito fora de [-308, 308]")
    if sum(c.isdigit() for c in coefficient) > MAX_COEFFICIENT_DIGITS:
        raise ValueError("coeficiente excede 100 dígitos")
    exact = Decimal(token)
    value = float(token)
    if not math.isfinite(value) or (value == 0 and not exact.is_zero()):
        raise ValueError("conversão float causa overflow ou underflow para zero")
    return value, _identity(exact)


def _prepare(value, issues, path='$'):
    """Retorna valor e identidade; tokens inválidos nunca entram em events."""
    if isinstance(value, _Number):
        try:
            return _convert_number(value)
        except (ValueError, OverflowError, DecimalException) as exc:
            issues.append(('INVALID_NUMBER', f'{path}: {exc}.'))
            # Identidade tipada conserva o literal rejeitado, sem arredondamento.
            return None, ('invalid_number', value.floating, value.token)
    if isinstance(value, dict):
        prepared = {key: _prepare(item, issues, f'{path}.{key}') for key, item in value.items()}
        return (
            {key: item[0] for key, item in prepared.items()},
            ('object', tuple((key, item[1]) for key, item in sorted(prepared.items()))),
        )
    if isinstance(value, list):
        prepared = [_prepare(item, issues, f'{path}[{index}]') for index, item in enumerate(value)]
        return [item[0] for item in prepared], ('array', tuple(item[1] for item in prepared))
    return value, _identity(value)


def read_jsonl(path):
    """Lê UTF-8 linha a linha. Falhas ao abrir/ler o arquivo propagam OSError."""
    with Path(path).open("rb") as stream:
        return ingest_lines(stream, source=str(path))


def ingest_lines(lines, *, source="<memory>"):
    """Agrupa antes de aceitar: nenhuma variante conflitante pode escapar.

    Igualdade usa JSON canônico, preservando tipos e valores dos timestamps.
    Chaves reordenadas e espaços de formatação não alteram a identidade.
    """
    result = IngestResult()
    groups = {}
    for number, line in enumerate(lines, 1):
        if isinstance(line, bytes):
            try:
                raw = line.decode("utf-8")
            except UnicodeDecodeError:
                origin = Origin(source, number, repr(line))
                result.errors.append(Diagnostic("INVALID_ENCODING", "Linha não é UTF-8 válido; raw contém repr dos bytes.", (origin,)))
                continue
        else:
            raw = line
        origin = Origin(source, number, raw)
        try:
            parsed = json.loads(raw, object_pairs_hook=_object, parse_int=_integer,
                                parse_float=_floating, parse_constant=_nonfinite)
            issues = []
            event, canonical = _prepare(parsed, issues)
        except (ValueError, RecursionError) as exc:
            result.errors.append(Diagnostic("INVALID_JSON", str(exc), (origin,)))
            continue
        # Não gerar erros em cascata a partir dos placeholders numéricos.
        if not issues:
            issues.extend(validate_event(event))
        event_id = event.get("event_id") if isinstance(event, dict) else None
        identifiable = isinstance(event_id, str) and bool(event_id.strip())
        for code, message in issues:
            result.errors.append(Diagnostic(code, message, (origin,), event_id if identifiable else None))
        if identifiable:
            groups.setdefault(event_id, []).append((canonical, event, origin, issues))

    accepted = []
    for event_id, records in sorted(groups.items()):
        origins = tuple(record[2] for record in records)
        result.origins_by_id[event_id] = origins
        if len({record[0] for record in records}) > 1:
            orders = tuple(sorted({r[1]["order_id"] for r in records if isinstance(r[1].get("order_id"), str)}))
            types = tuple(sorted({r[1]["type"] for r in records if isinstance(r[1].get("type"), str)}))
            result.errors.append(Diagnostic(
                "EVENT_ID_CONFLICT",
                "Todas as variantes foram excluídas. Evidências ausentes podem tornar métricas dependentes indisponíveis; revisar pedidos e tipos afetados.",
                origins, event_id, orders, types,
            ))
        elif not records[0][3]:
            accepted.append(records[0][1])
            if len(records) > 1:
                result.duplicates.append(Diagnostic("DUPLICATE_EVENT", "Reenvios idênticos ignorados no conjunto de negócio.", origins, event_id))
    # Ordenação por ID serve apenas para estabilidade do conjunto, não é replay temporal.
    result.events = tuple(accepted)
    return result
