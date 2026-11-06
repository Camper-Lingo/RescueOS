"""All Stage 8D checks run with a simulated provider; NO Ollama or network."""
import asyncio
import tempfile
import unittest
from pathlib import Path

from rescueos.tower.snapshot import load_snapshot
from stress_suite import (CLEAN_CASES, ADVERSARIAL_CASES, check_scout, check_trace,
                          execute, main, markdown, run_clean, summarize)
from case_study import render, load_sources


class Stage8DTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = load_snapshot()

    def test_scout_empty_has_no_alerts(self):
        result = asyncio.run(run_clean(self.snapshot, "scout", 0, None))
        self.assertTrue(result["pass"])
        self.assertEqual(result["canonical_alert_count"], 0)
        self.assertEqual(result["highlight_count"], 0)

    def test_scout_partial_does_not_leak_final_delivery(self):
        result = asyncio.run(run_clean(self.snapshot, "scout", 18, None))
        self.assertTrue(result["pass"])
        self.assertNotIn("DELIVERY_DELAY", result["alert_codes"])
        self.assertIn("COURIER_WAIT", result["alert_codes"])

    def test_trace_ontime_final_metrics(self):
        result = asyncio.run(run_clean(self.snapshot, "trace", 20, "ord-1001"))
        self.assertTrue(result["pass"])
        self.assertEqual(result["state"], "DELIVERED")
        self.assertEqual(result["metrics_expected"], result["metrics_selected"])

    def test_trace_cancellation_is_not_delivery(self):
        result = asyncio.run(run_clean(self.snapshot, "trace", 20, "ord-1003"))
        self.assertTrue(result["pass"])
        self.assertEqual(result["state"], "CANCELLED")
        self.assertEqual(result["metrics_expected"], 0)

    def test_strict_check_fails_for_missing_metric(self):
        from rescueos.tower.trace import InvestigationRequest, OrderTools
        tools = OrderTools(self.snapshot, InvestigationRequest(order_id="ord-1002",
                             frame_index=20, snapshot_id=self.snapshot.snapshot_id))
        self.assertFalse(check_trace(tools, {"facts": [{"fact_id": "state", "value": "DELIVERED", "sources": [{}]}]})["pass"])

    def test_strict_scout_rejects_missing_highlight(self):
        from rescueos.tower.scout import ScoutRequest, ScoutTools
        tools = ScoutTools(self.snapshot, ScoutRequest(snapshot_id=self.snapshot.snapshot_id, frame_index=20))
        self.assertFalse(check_scout(tools, {"alerts": tools.canonical_catalog["alerts"], "highlighted_alert_ids": []})["pass"])

    def test_every_offline_case_passes(self):
        data = asyncio.run(execute())
        self.assertEqual(data["counts"]["total"], len(CLEAN_CASES)+len(ADVERSARIAL_CASES))
        self.assertEqual(data["counts"]["passed"], data["counts"]["total"])
        self.assertEqual(data["counts"]["adversarial_rejected"], len(ADVERSARIAL_CASES))
        self.assertIn("não", markdown(data).lower())

    def test_cli_writes_local_artifacts(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(main(["--out", folder]), 0)
            self.assertTrue(Path(folder, "stress-results.json").exists())
            self.assertTrue(Path(folder, "stress-report.md").exists())

    def test_portfolio_does_not_invent_missing_results(self):
        with tempfile.TemporaryDirectory() as folder:
            found = load_sources(Path(folder))
            self.assertTrue(all(value is None for value in found.values()))
            report = render(found)
            self.assertIn("não disponível", report)
            self.assertIn("ausente", report)
            self.assertNotIn("0.810", report)

    def test_portfolio_separates_offline_and_real(self):
        report = render({"ml":None, "safety":None,"stress":None,"scout":None,"trace":None})
        self.assertIn("não representam acurácia", report.lower())
        self.assertIn("inferência real", report.lower())


if __name__ == "__main__":
    unittest.main()
