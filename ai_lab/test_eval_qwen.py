"""Stage 8C tests: ALL OFFLINE. No Ollama connection or inference."""
import asyncio
import tempfile
import unittest
from pathlib import Path

from eval_qwen import (CASES, MeteredProvider, evaluate_completed, main, report_markdown,
                       run_case, tools_and_agent, write_outputs)
from reliability import ControlledProvider
from rescueos.tower.snapshot import load_snapshot


class EvalQwenOfflineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = load_snapshot()

    def test_cli_without_explicit_consent_does_not_contact_model(self):
        self.assertEqual(main([]), 0)
        self.assertEqual(main(["--cases", "scout_empty"]), 0)

    def test_scout_clean_stub_selects_canonical_alerts(self):
        async def evaluate():
            stub = ControlledProvider()
            stub.kind = "ollama"  # Simulates output, not actual model.
            provider = MeteredProvider(stub)
            return await run_case("scout_final", self.snapshot, provider)
        result = asyncio.run(evaluate())
        self.assertEqual(result["outcome"], "completed")
        self.assertEqual(result["canonical_alerts"], 4)
        self.assertEqual(result["highlight_recall"], 1.0)
        self.assertTrue(result["quality_pass"])

    def test_trace_delayed_stub_covers_metrics(self):
        async def evaluate():
            stub = ControlledProvider()
            stub.kind = "ollama"
            provider = MeteredProvider(stub)
            return await run_case("trace_delayed", self.snapshot, provider)
        result = asyncio.run(evaluate())
        self.assertEqual(result["outcome"], "completed")
        self.assertTrue(result["state_selected"])
        self.assertTrue(result["metric_values_canonical"])
        self.assertTrue(result["quality_pass"])

    def test_empty_scout_does_not_invent_alerts(self):
        async def evaluate():
            stub = ControlledProvider()
            stub.kind = "ollama"
            return await run_case("scout_empty", self.snapshot, MeteredProvider(stub))
        result = asyncio.run(evaluate())
        self.assertEqual(result["outcome"], "completed")
        self.assertEqual(result["canonical_alerts"], 0)
        self.assertEqual(result["highlighted"], 0)

    def test_report_is_candid_about_limits(self):
        record = {"case": "scout_final", "outcome": "error", "error_code": "TIMEOUT",
                  "model_calls": 1, "elapsed_ms": 4000, "quality_pass": False}
        report = {"snapshot_id": self.snapshot.snapshot_id, "completed": 0, "quality_passed": 0,
                  "cases": [record]}
        with tempfile.TemporaryDirectory() as path:
            write_outputs(report, Path(path))
            text = Path(path, "qwen-eval-report.md").read_text(encoding="utf8")
            self.assertIn("erro: TIMEOUT", text)
            self.assertIn("NÃO representam acurácia em produção", text)


if __name__ == "__main__":
    unittest.main()
