from copy import deepcopy
import hashlib
import json
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from rescueos.tower.api import create_app
from rescueos.tower.snapshot import DEMO_FIXTURE, load_snapshot
from tests.test_metrics import conflict, history


class TowerApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = TestClient(create_app())
        cls.client = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)

    def get(self, path):
        response = self.client.get("/api/v1/" + path)
        self.assertEqual(200, response.status_code, response.text)
        return response.json()

    def test_endpoints_share_snapshot_and_demo_metadata(self):
        responses = [self.get(path) for path in ("health", "overview", "orders", "orders/ord-1002", "diagnostics", "replay")]
        self.assertEqual(1, len({r["snapshot_id"] for r in responses}))
        self.assertTrue(all(r["synthetic"] and r["demo_mode"] for r in responses))

    def test_fixture_overview(self):
        overview = self.get("overview")
        self.assertEqual(3, overview["order_count"])
        for name, expected in (("total_created", 3), ("total_delivered", 2), ("total_cancelled", 1), ("total_late_deliveries", 1)):
            self.assertEqual(expected, overview["aggregates"][name]["value"])
        self.assertEqual({"numerator": "1", "denominator": "2"}, overview["aggregates"]["delay_rate"]["value"])
        self.assertEqual({"numerator": "1", "denominator": "3"}, overview["aggregates"]["cancellation_rate"]["value"])

    def test_metrics_and_source_origins(self):
        order = self.get("orders/ord-1002")["order"]
        for name, number in (("delivery_delay", 13), ("kitchen_delay", 11), ("courier_waiting_time", 13)):
            self.assertEqual({"numerator": str(number), "denominator": "1"}, order["metrics"][name]["value"])
        sources = order["metrics"]["courier_waiting_time"]["sources"]
        self.assertEqual(["evt-015", "evt-018"], [s["event_id"] for s in sources])
        self.assertEqual([15, 18], [s["origins"][0]["line"] for s in sources])
        self.assertTrue(all(s["origins"][0]["source"] == "demo_events.jsonl" for s in sources))

    def test_cancelled_is_null_not_zero(self):
        order = self.get("orders/ord-1003")["order"]
        self.assertEqual("CANCELLED", order["status"])
        self.assertIsNone(order["metrics"]["delivery_delay"]["value"])
        self.assertFalse(order["metrics"]["delivery_delay"]["available"])

    def test_unknown_order_and_write_methods(self):
        self.assertEqual(404, self.client.get("/api/v1/orders/missing").status_code)
        self.assertEqual(405, self.client.post("/api/v1/orders", json={}).status_code)

    def test_replay_prefix_states_and_no_future_metrics(self):
        replay = self.get("replay")
        self.assertEqual((20, 21), (len(replay["events"]), len(replay["frames"])))
        self.assertEqual([], replay["frames"][0]["orders"])
        frame = next(f for f in replay["frames"] if f["event_id"] == "evt-015")
        order = next(o for o in frame["orders"] if o["order_id"] == "ord-1002")
        self.assertIsNone(order["metrics"]["courier_waiting_time"]["value"])
        ready = next(f for f in replay["frames"] if f["event_id"] == "evt-017")
        order = next(o for o in ready["orders"] if o["order_id"] == "ord-1002")
        self.assertEqual("READY", order["status"])
        self.assertEqual("11", order["metrics"]["kitchen_delay"]["value"]["numerator"])
        pickup = next(f for f in replay["frames"] if f["event_id"] == "evt-018")
        order = next(o for o in pickup["orders"] if o["order_id"] == "ord-1002")
        self.assertEqual("13", order["metrics"]["courier_waiting_time"]["value"]["numerator"])
        self.assertIsNone(order["metrics"]["delivery_delay"]["value"])

    def test_responses_are_independent_copies(self):
        response = self.get("orders")
        before = deepcopy(response)
        response["orders"][0]["metrics"].clear()
        self.assertEqual(before, self.get("orders"))

    def test_no_writes_or_fixture_mutation(self):
        original = DEMO_FIXTURE.read_bytes()
        with patch("rescueos.reporting.write_reports", side_effect=AssertionError("API cannot publish reports")):
            snapshot = load_snapshot()
        self.assertTrue(snapshot.snapshot_id)
        self.assertEqual(original, DEMO_FIXTURE.read_bytes())

    def snapshot_from(self, events):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "test.jsonl"
            path.write_text("\n".join(json.dumps(e) for e in events), encoding="utf-8")
            return load_snapshot(path)

    def test_shuffles_offsets_and_ties_use_core_order(self):
        events = history()
        events[1]["occurred_at"] = "2026-10-29T21:01:00Z"
        events[2]["occurred_at"] = "2026-10-29T18:01:00-03:00"
        expected = [e["event_id"] for e in self.snapshot_from(events).payload("replay")["events"]]
        self.assertEqual(["o-1", "o-2"], expected[1:3])
        for seed in range(5):
            shuffled = deepcopy(events)
            random.Random(seed).shuffle(shuffled)
            actual = self.snapshot_from(shuffled).payload("replay")
            self.assertEqual(expected, [e["event_id"] for e in actual["events"]])
            self.assertEqual("60000000", actual["events"][2]["elapsed_us"])

    def test_conflicts_ambiguity_and_quality_are_not_hidden(self):
        events = history()
        snapshot = self.snapshot_from(events + [conflict(events[-1])])
        order = snapshot.payload("orders")["orders"][0]
        self.assertEqual("INCOMPLETE", order["evidence_quality"])
        self.assertIsNone(order["metrics"]["delivery_delay"]["value"])
        self.assertEqual("PARTIAL", snapshot.payload("overview")["aggregates"]["delay_rate"]["evidence_quality"])
        cancel = dict(events[-1], event_id="cancel", type="ORDER_CANCELLED", occurred_at="2026-10-29T18:07:00-03:00")
        order = self.snapshot_from(events + [cancel]).payload("orders")["orders"][0]
        self.assertIsNone(order["status"])
        self.assertEqual("AMBIGUOUS", order["resolution"])

    def test_empty_and_orphans_do_not_invent_orders(self):
        for events in ([], history()[1:]):
            snapshot = self.snapshot_from(events)
            self.assertEqual([], snapshot.payload("orders")["orders"])
        self.assertEqual(1, len(self.snapshot_from([]).payload("replay")["frames"]))

    def test_snapshot_remains_consistent_if_fixture_changes_after_startup(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "fixture.jsonl"
            path.write_bytes(DEMO_FIXTURE.read_bytes())
            with TestClient(create_app(path)) as client:
                before = client.get("/api/v1/orders").content
                path.write_text("", encoding="utf-8")
                self.assertEqual(before, client.get("/api/v1/orders").content)

    def test_snapshot_is_deterministic_and_cache_cannot_be_mutated(self):
        first, second = load_snapshot(), load_snapshot()
        self.assertEqual(first.snapshot_id, second.snapshot_id)
        first.payload("overview")["aggregates"].clear()
        self.assertEqual(second.payload("overview"), first.payload("overview"))
        with self.assertRaises(TypeError):
            first._payloads["overview"] = "changed"
