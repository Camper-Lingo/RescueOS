"""Stage 8C: manually authorized, bounded LOCAL Ollama benchmark.

No model inference on import, dry-run or offline tests.
Uses the historical synthetic fixture, NOT the live restaurant or external orders.
"""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import sys
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rescueos.tower.scout import ScoutAgent, ScoutRequest, ScoutTools
from rescueos.tower.snapshot import load_snapshot
from rescueos.tower.trace import InvestigationRequest, OrderTools, TraceAgent
from rescueos.tower.trace_provider import OllamaProvider, TraceError

MODEL = "qwen3:4b"
CASES = {
    "scout_final": {"agent": "scout", "frame": 20},
    "trace_delayed": {"agent": "trace", "frame": 20, "order_id": "ord-1002"},
    "scout_empty": {"agent": "scout", "frame": 0},
    "trace_ontime": {"agent": "trace", "frame": 20, "order_id": "ord-1001"},
}
DEFAULT_CASES = ("scout_final", "trace_delayed")


class MeteredProvider:
    """Records durations, never model messages or prompt contents."""
    kind = "ollama"
    model = MODEL

    def __init__(self, provider):
        self.inner = provider
        self.model = provider.model
        self.model_calls = 0
        self.call_ms = []

    async def check(self):
        return await self.inner.check()

    async def chat(self, messages, schema):
        start = perf_counter()
        try:
            return await self.inner.chat(messages, schema)
        finally:
            self.model_calls += 1
            self.call_ms.append(round((perf_counter() - start) * 1000))


def tools_and_agent(case_id, snapshot, provider, *, timeout=120):
    """Use production agent, tool scopes and canonical snapshot. No mocks."""
    config = CASES[case_id]
    if config["agent"] == "scout":
        req = ScoutRequest(snapshot_id=snapshot.snapshot_id, frame_index=config["frame"])
        tools = ScoutTools(snapshot, req)
        agent = ScoutAgent(provider, timeout=timeout)
    else:
        req = InvestigationRequest(order_id=config["order_id"], snapshot_id=snapshot.snapshot_id,
                                   frame_index=config["frame"])
        tools = OrderTools(snapshot, req)
        agent = TraceAgent(provider, timeout=timeout)
    return tools, agent


def evaluate_completed(case_id, tools, event):
    """Check model *choices*, not only the agent's canonical response catalog."""
    if CASES[case_id]["agent"] == "scout":
        truth = {a["alert_id"] for a in tools.canonical_catalog["alerts"]}
        selected = set(event["highlighted_alert_ids"])
        # Agent already verifies that all chosen references are valid.
        chosen_valid = selected <= truth
        coverage = len(selected & truth) / len(truth) if truth else float(not selected)
        result = {
            "canonical_alerts": len(truth),
            "highlighted": len(selected),
            "highlight_recall": round(coverage, 4),
            "all_highlights_canonical": chosen_valid,
            "quality_pass": chosen_valid and selected == truth,
        }
    else:
        expected = {f"metric.{k}" for k, v in tools.order["metrics"].items() if v["available"]}
        facts = {f["fact_id"]: f for f in event["facts"]}
        chosen = {fid for fid in facts if fid.startswith("metric.")}
        correct = chosen & expected
        coverage = len(correct) / len(expected) if expected else 1.0
        valid_metric_values = all(
            facts[fid]["value"] == tools.order["metrics"][fid.removeprefix("metric.")]["value"]
            for fid in correct
        )
        result = {
            "available_metrics": len(expected),
            "metrics_selected": len(correct),
            "metric_recall": round(coverage, 4),
            "state_selected": "state" in facts,
            "metric_values_canonical": valid_metric_values,
            "quality_pass": ("state" in facts and chosen == expected and valid_metric_values),
        }
    return result


async def run_case(case_id, snapshot, provider, *, timeout=120):
    tools, agent = tools_and_agent(case_id, snapshot, provider, timeout=timeout)
    began = perf_counter()
    last = None
    try:
        async for event in agent.stream(tools):
            # Deliberately do not persist raw prompts, tool payloads or model completions.
            if event["type"] in {"completed", "error"}:
                last = event
    except Exception as exc:
        last = {"type": "error", "code": type(exc).__name__}
    if last is None:
        last = {"type": "error", "code": "NO_TERMINAL_EVENT"}
    result = {
        "case": case_id,
        "agent": CASES[case_id]["agent"],
        "frame": CASES[case_id]["frame"],
        "outcome": last["type"],
        "elapsed_ms": round((perf_counter() - began) * 1000),
        "model_calls": provider.model_calls,
        "model_call_ms": provider.call_ms,
        "tool_names": [item["name"] for item in last.get("tool_history", [])],
    }
    if last["type"] == "completed":
        result.update(evaluate_completed(case_id, tools, last))
    else:
        result["error_code"] = last.get("code", "UNKNOWN")
        result["quality_pass"] = False
    return result


def report_markdown(report):
    rows = [
        "# RescueOS AI Lab — Stage 8C (Qwen local)",
        "",
        "**Modelo real:** Qwen3:4B via Ollama local. **Ambiente:** fixture histórica sintética, não restaurante vivo.",
        "Os resultados abaixo NÃO representam acurácia em produção. A avaliação é pequena e mede cobertura de referências e métricas, além de falhas/latência.",
        "",
        f"- Snapshot SHA-256: `{report['snapshot_id']}`",
        f"- Casos concluídos: **{report['completed']}/{len(report['cases'])}**",
        f"- Casos que cumpriram a cobertura estrita: **{report['quality_passed']}/{len(report['cases'])}**",
        "",
        "| Caso | Resultado | Cobertura de referências/métricas | Chamadas LLM | Duração real |",
        "|---|---|---:|---:|---:|",
    ]
    for case in report["cases"]:
        metric = case.get("highlight_recall", case.get("metric_recall"))
        coverage = f"{100 * metric:.0f}%" if metric is not None else "—"
        outcome = case["outcome"] if case["outcome"] == "completed" else f"erro: {case.get('error_code')}"
        rows.append(f"| `{case['case']}` | {outcome} | {coverage} | {case['model_calls']} | {case['elapsed_ms'] / 1000:.1f}s |")
    rows += [
        "", "## Leitura correta", "",
        "- Scout devolve um catálogo canônico mesmo que a seleção da IA seja ruim. Por isso medimos `highlighted_alert_ids`, não o catálogo devolvido.",
        "- Trace seleciona referências de fatos reais. Medimos cobertura dos indicadores disponíveis e presença do estado, sem confundir sucesso de execução com raciocínio correto.",
        "- Rejeições de respostas inválidas são falhas do modelo **nesta medição**, mesmo que a proteção do agente tenha funcionado corretamente.",
        "- Latência mede chamadas reais locais, mas depende de aquecimento do modelo, hardware e condições de execução.",
        "- Resultados são de uma amostra minúscula e não devem ser extrapolados para outras operações.\n",
    ]
    return "\n".join(rows)


def write_outputs(report, output):
    output.mkdir(parents=True, exist_ok=True)
    (output / "qwen-eval-results.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "qwen-eval-report.md").write_text(report_markdown(report), encoding="utf-8")


async def execute(case_ids, output, *, timeout=120, provider_factory=OllamaProvider):
    snapshot = load_snapshot()
    results = []
    for case_id in case_ids:
        print(f"Avaliando {case_id} com modelo local. Pare manualmente se a CPU passar de 85°C.", flush=True)
        provider = MeteredProvider(provider_factory(model=MODEL))
        item = await run_case(case_id, snapshot, provider, timeout=timeout)
        results.append(item)
        report = {
            "schema": "rescueos.ai_lab.real.v1",
            "mode": "local-qwen3-4b-real-llm",
            "model": MODEL,
            "snapshot_id": snapshot.snapshot_id,
            "cases": results,
            "completed": sum(x["outcome"] == "completed" for x in results),
            "quality_passed": sum(x["quality_pass"] for x in results),
        }
        write_outputs(report, output)  # Save even if later case is interrupted.
        print(f"  {item['outcome']} · critério de cobertura: {item['quality_pass']} · {item['elapsed_ms']/1000:.1f}s", flush=True)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="Tiny evaluation of REAL local Qwen (requires explicit --run-real)")
    parser.add_argument("--run-real", action="store_true", help="Authorize Ollama inference on this computer")
    parser.add_argument("--cases", nargs="+", choices=tuple(CASES), default=list(DEFAULT_CASES))
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--out", type=Path, default=ROOT / "ai_lab" / "out")
    args = parser.parse_args(argv)
    if len(set(args.cases)) != len(args.cases) or len(args.cases) > 4:
        parser.error("Escolha de 1 a 4 casos distintos")
    if not (15 <= args.timeout <= 180):
        parser.error("--timeout deve estar entre 15 e 180 segundos")
    if not args.run_real:
        print("MODO SEGURO — nenhuma inferência executada.")
        print("Casos preparados:", ", ".join(args.cases))
        print("Para usar o Ollama real, escolha explicitamente --run-real (CPU monitorada).")
        return 0
    print("A execução fará inferência Qwen3:4b LOCAL. Verifique HWiNFO e limite conservador de 85°C.")
    result = asyncio.run(execute(args.cases, args.out, timeout=args.timeout))
    print("Relatório:", args.out / "qwen-eval-report.md")
    return 0 if result["completed"] == len(result["cases"]) else 1


if __name__ == "__main__":
    sys.exit(main())
