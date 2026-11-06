"""Stage 8D: bounded, deterministic OFFLINE robustness suite for production Scout/Trace.

No network, no Ollama; uses 8B's injected controlled provider and canonical snapshot.
This is a *contract/robustness* benchmark, NOT an evaluation of real LLM quality.
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
from reliability import ControlledProvider, corrupt_tool

# Explicit, reproducible cases; no randomly chosen snapshots or implicit retries.
# Trace: check orders before and after status transitions and missing metrics.
CLEAN_CASES = [
    ("scout", frame, None) for frame in (0, 3, 5, 10, 12, 15, 16, 18, 20)
] + [
    ("trace", frame, order) for frame, order in (
        (3, "ord-1001"), (12, "ord-1001"), (15, "ord-1001"), (20, "ord-1001"),
        (5, "ord-1002"), (15, "ord-1002"), (18, "ord-1002"), (20, "ord-1002"),
        (5, "ord-1003"), (16, "ord-1003"), (20, "ord-1003"),
    )
]

# Stress at multiple frames; tamper tests only where required evidence is present.
ADVERSARIAL_CASES = [
    {"id": "scout18_fake_wait_999", "agent": "scout", "frame": 18, "order": None,
     "provider": "valid", "target": "get_operations_alerts", "mutation": "metric_999",
     "expected": "TOOL_RESULT_MISMATCH"},
    {"id": "scout20_forged_reference", "agent": "scout", "frame": 20, "order": None,
     "provider": "valid", "target": "get_operations_alerts", "mutation": "forged_source",
     "expected": "TOOL_RESULT_MISMATCH"},
    {"id": "scout10_invalid_tool", "agent": "scout", "frame": 10, "order": None,
     "provider": "unapproved_tool", "target": None, "mutation": None,
     "expected": "INVALID_MODEL_RESPONSE"},
    {"id": "scout20_invented_alert", "agent": "scout", "frame": 20, "order": None,
     "provider": "invented_reference", "target": None, "mutation": None,
     "expected": "UNSUPPORTED_REFERENCE"},
    {"id": "trace20_fake_metric_999", "agent": "trace", "frame": 20, "order": "ord-1002",
     "provider": "valid", "target": "get_order_metrics", "mutation": "metric_999",
     "expected": "TOOL_RESULT_MISMATCH"},
    {"id": "trace20_invented_fact", "agent": "trace", "frame": 20, "order": "ord-1002",
     "provider": "invented_reference", "target": None, "mutation": None,
     "expected": "UNSUPPORTED_REFERENCE"},
    {"id": "trace20_missing_state", "agent": "trace", "frame": 20, "order": "ord-1002",
     "provider": "missing_evidence", "target": None, "mutation": None,
     "expected": "MISSING_EVIDENCE"},
]


def build_case(snapshot, agent, frame, order, provider_mode="valid"):
    provider = ControlledProvider(provider_mode)
    if agent == "scout":
        tools = ScoutTools(snapshot, ScoutRequest(snapshot_id=snapshot.snapshot_id, frame_index=frame))
        return tools, ScoutAgent(provider)
    if agent == "trace":
        tools = OrderTools(snapshot, InvestigationRequest(order_id=order,
                            snapshot_id=snapshot.snapshot_id, frame_index=frame))
        return tools, TraceAgent(provider)
    raise ValueError("Unknown agent")


def check_scout(tools, event):
    # Model-chosen highlights may differ from canonical alerts in a real LLM run;
    # this suite uses a *controlled* provider that must select all canonical alerts.
    canonical = {x["alert_id"]: x for x in tools.canonical_catalog["alerts"]}
    observed = {x["alert_id"]: x for x in event.get("alerts", [])}
    selected = event.get("highlighted_alert_ids", [])
    return {
        "pass": (observed == canonical and len(selected) == len(set(selected))
                 and set(selected) == set(canonical)),
        "canonical_alert_count": len(canonical),
        "highlight_count": len(selected),
        "alert_codes": sorted({v["code"] for v in observed.values()}),
    }


def check_trace(tools, event):
    # Exact state + currently-available numeric facts, not just agent status.
    expected = {f"metric.{k}": v["value"] for k, v in tools.order["metrics"].items()
                if v["available"]}
    facts = event.get("facts", [])
    selected = {f["fact_id"]: f for f in facts}
    observed = {k: selected[k]["value"] for k in expected if k in selected}
    state = selected.get("state", {}).get("value")
    return {
        "pass": (len(selected) == len(facts) and state == tools.order["status"]
                 and observed == expected and all(f.get("sources") for f in facts)),
        "state": state,
        "metrics_expected": len(expected),
        "metrics_selected": len(observed),
    }


async def terminal(agent, tools):
    last = None
    async for event in agent.stream(tools):
        if event["type"] in {"completed", "error"}:
            last = event
    return last or {"type": "error", "code": "NO_TERMINAL_EVENT"}


async def run_clean(snapshot, kind, frame, order):
    tools, agent = build_case(snapshot, kind, frame, order)
    start = perf_counter()
    event = await terminal(agent, tools)
    result = {"case": f"{kind}_frame_{frame}" + (f"_{order}" if order else ""),
              "agent": kind, "frame": frame, "order_id": order,
              "family": "clean", "outcome": event["type"]}
    if event["type"] == "completed":
        checks = check_scout(tools, event) if kind == "scout" else check_trace(tools, event)
        result.update(checks)
    else:
        result["code"] = event.get("code")
        result["pass"] = False
    result["elapsed_ms_stub"] = round((perf_counter() - start) * 1000, 2)
    return result


async def run_adversarial(snapshot, spec):
    tools, agent = build_case(snapshot, spec["agent"], spec["frame"], spec["order"], spec["provider"])
    if spec["mutation"]:
        corrupt_tool(tools, spec["target"], spec["mutation"])
    start = perf_counter()
    event = await terminal(agent, tools)
    observed = "completed" if event["type"] == "completed" else event.get("code", "UNKNOWN")
    return {"case": spec["id"], "agent": spec["agent"], "frame": spec["frame"],
            "order_id": spec["order"], "family": "adversarial",
            "expected": spec["expected"], "observed": observed,
            "pass": observed == spec["expected"],
            "elapsed_ms_stub": round((perf_counter() - start) * 1000, 2)}


def summarize(results, snapshot_id):
    clean = [r for r in results if r["family"] == "clean"]
    adversarial = [r for r in results if r["family"] == "adversarial"]
    return {"schema": "rescueos.ai_lab.stage8d.offline.v1", "mode": "offline-stub-no-llm",
            "snapshot_id": snapshot_id, "cases": results,
            "counts": {"total": len(results), "passed": sum(r["pass"] for r in results),
                       "clean_passed": sum(r["pass"] for r in clean), "clean_total": len(clean),
                       "adversarial_rejected": sum(r["pass"] for r in adversarial),
                       "adversarial_total": len(adversarial)}}


def markdown(report):
    c = report["counts"]
    lines = ["# RescueOS — Stage 8D: matrizes de robustez (offline)", "",
             "> **Provador controlado, sem modelo de linguagem.** Mede validação e a integridade de fatos nos estados da fixture histórica sintética.", "",
             f"- Snapshot: `{report['snapshot_id']}`",
             f"- Casos corretos: **{c['passed']}/{c['total']}**",
             f"- Estados normais: **{c['clean_passed']}/{c['clean_total']}**",
             f"- Adulterações rejeitadas corretamente: **{c['adversarial_rejected']}/{c['adversarial_total']}**",
             "", "| Caso | Tipo | Quadro | Esperado / observado | Passou |", "|---|---|---:|---|---|" ]
    for r in report["cases"]:
        obs = r["observed"] if "observed" in r else r["outcome"]
        exp = r.get("expected", "completed + fatos canônicos completos")
        lines.append(f"| `{r['case']}` | {r['family']} | {r['frame']} | {exp} / {obs} | {'sim' if r['pass'] else '**NÃO**'} |")
    lines.extend(["", "## Leitura técnica", "",
                  "- Nos casos limpos, verificamos **seleções feitas pelo stub**, fatos canônicos, estados e métricas disponíveis em cada quadro.",
                  "- Nos casos adulterados, exigimos rejeição por código específico; terminar sem erro não seria sucesso.",
                  "- Os quadros pertencem todos à MESMA fixture: cobertura temporal não significa independência estatística ou generalização.",
                  "- Tempos medidos aqui são de stubs, **não** latência do Qwen.",
                  "- Esta suíte NÃO avalia o LLM real. Para nova evidência real, use manualmente a Stage 8C com casos adicionais, um por vez.", ""])
    return "\n".join(lines)


async def execute():
    snapshot = load_snapshot()
    results = []
    for kind, frame, order in CLEAN_CASES:
        results.append(await run_clean(snapshot, kind, frame, order))
    for spec in ADVERSARIAL_CASES:
        results.append(await run_adversarial(snapshot, spec))
    return summarize(results, snapshot.snapshot_id)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Stage 8D OFFLINE robustness benchmark — no Ollama")
    parser.add_argument("--out", type=Path, default=ROOT / "ai_lab" / "out" / "stress")
    args = parser.parse_args(argv)
    result = asyncio.run(execute())
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "stress-results.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (args.out / "stress-report.md").write_text(markdown(result), encoding="utf-8")
    stats = result["counts"]
    print(f"Stage 8D offline: {stats['passed']}/{stats['total']}; "
          f"limpos {stats['clean_passed']}/{stats['clean_total']}; "
          f"adversariais {stats['adversarial_rejected']}/{stats['adversarial_total']}")
    print("Relatório:", args.out / "stress-report.md")
    return 0 if stats["passed"] == stats["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
