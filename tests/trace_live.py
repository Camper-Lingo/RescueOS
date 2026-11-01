"""Avaliação explícita com LLM real local; não entra em unittest discover."""

import asyncio
import json
from pathlib import Path

from rescueos.tower.snapshot import load_snapshot
from rescueos.tower.trace import InvestigationRequest, OrderTools, TraceAgent
from rescueos.tower.trace_provider import OllamaProvider


async def main():
    snapshot = load_snapshot()
    agent = TraceAgent(OllamaProvider())
    runs = []
    for oid in ("ord-1001", "ord-1002", "ord-1003"):
        request = InvestigationRequest(order_id=oid, snapshot_id=snapshot.snapshot_id, frame_index=20)
        tools = OrderTools(snapshot, request)
        events = [event async for event in agent.stream(tools)]
        final = events[-1]
        required = {"state"} | {"metric." + k for k, m in tools.order["metrics"].items() if m["available"]}
        selected = {f["fact_id"] for f in final.get("facts", [])}
        returned = {f["fact_id"]: f for h in final.get("tool_history", []) for f in h.get("result", {}).get("facts", [])}
        verified = sum(returned.get(f["fact_id"]) == f for f in final.get("facts", []))
        record = {"order_id": oid, "status": final["type"], "error": final.get("code"),
                  "duration_ms": final["elapsed_ms"], "verified_facts": verified,
                  "selected_facts": len(final.get("facts", [])), "required_findings": len(required),
                  "covered_findings": len(required & selected), "events": events}
        runs.append(record)
        print(json.dumps({k: v for k, v in record.items() if k != "events"}), flush=True)
    Path("out").mkdir(exist_ok=True)
    Path("out/trace-live.json").write_text(json.dumps(runs, ensure_ascii=True, indent=2) + "\n", encoding="utf8")
    if any(r["status"] != "completed" or r["verified_facts"] != r["selected_facts"] or
           r["covered_findings"] != r["required_findings"] for r in runs):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
