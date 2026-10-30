from copy import deepcopy
from fractions import Fraction
import json
from pathlib import Path
import random
import unittest

from rescueos.ingest import ingest_lines, read_jsonl
from rescueos.metrics import compute_metrics
from rescueos.replay import replay

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "demo_events.jsonl"


def history(order_id="o", delivered="2026-10-29T18:06:00-03:00",
            deadline="2026-10-29T18:05:00-03:00"):
    kinds = ["ORDER_CREATED", "KITCHEN_STARTED", "COURIER_ASSIGNED", "COURIER_ARRIVED",
             "KITCHEN_READY", "PICKED_UP", "DELIVERED"]
    return [{"event_id": f"{order_id}-{index}", "order_id": order_id,
             "restaurant_id": "r", "type": kind,
             "occurred_at": delivered if kind == "DELIVERED" else f"2026-10-29T18:0{index}:00-03:00",
             "data": {"promised_ready_at": "2026-10-29T18:03:00-03:00",
                      "promised_delivery_at": deadline} if index == 0 else {}}
            for index, kind in enumerate(kinds)]


def calculate(events):
    return compute_metrics(replay(ingest_lines([json.dumps(e) for e in events], source="metrics-test.jsonl")))


def conflict(event):
    variant = deepcopy(event)
    variant["data"]["note"] = "divergent"
    return variant


class MetricsTests(unittest.TestCase):
    def test_fixture_exact_values(self):
        result = compute_metrics(replay(read_jsonl(FIXTURE)))
        expected = {
            "ord-1001": [-5, 0, 5, 0, 1],
            "ord-1002": [13, 13, 0, 11, 13],
            "ord-1003": [None, None, None, None, None],
        }
        names = ["delivery_deviation", "delivery_delay", "delivery_earliness", "kitchen_delay", "courier_waiting_time"]
        for oid, values in expected.items():
            self.assertEqual(values, [result.orders[oid].metrics[n].value for n in names])
        self.assertEqual("CANCELLED", result.orders["ord-1003"].status)
        self.assertEqual({"total_created": 3, "total_delivered": 2, "total_cancelled": 1,
                          "total_late_deliveries": 1, "total_on_time_deliveries": 1,
                          "delay_rate": Fraction(1, 2), "cancellation_rate": Fraction(1, 3)},
                         {k: a.value for k, a in result.aggregates.items()})

    def test_fixture_rate_denominators_and_contributors(self):
        result = compute_metrics(replay(read_jsonl(FIXTURE)))
        delay = result.aggregates["delay_rate"]
        cancellation = result.aggregates["cancellation_rate"]
        self.assertEqual((1, 2), (delay.numerator, delay.denominator))
        self.assertEqual(("ord-1002",), delay.numerator_order_ids)
        self.assertEqual(("ord-1001", "ord-1002"), delay.denominator_order_ids)
        self.assertEqual((1, 3), (cancellation.numerator, cancellation.denominator))
        self.assertEqual(("ord-1003",), cancellation.numerator_order_ids)
        self.assertTrue(all(a.criteria and a.formula for a in result.aggregates.values()))

    def test_earliness_keeps_sign(self):
        metrics = calculate(history(deadline="2026-10-29T18:10:00-03:00")).orders["o"].metrics
        self.assertEqual(-4, metrics["delivery_deviation"].value)
        self.assertEqual(0, metrics["delivery_delay"].value)
        self.assertEqual(4, metrics["delivery_earliness"].value)

    def test_exact_deadline_is_on_time(self):
        result = calculate(history(deadline="2026-10-29T18:06:00-03:00"))
        self.assertEqual(0, result.orders["o"].metrics["delivery_deviation"].value)
        self.assertEqual(1, result.aggregates["total_on_time_deliveries"].value)
        self.assertEqual(0, result.aggregates["total_late_deliveries"].value)

    def test_fractional_seconds_are_exact_without_rounding(self):
        result = calculate(history(delivered="2026-10-29T18:05:01.000001-03:00"))
        value = result.orders["o"].metrics["delivery_delay"].value
        self.assertIsInstance(value, Fraction)
        self.assertEqual(Fraction(1_000_001, 60_000_000), value)
        self.assertEqual(Fraction(1), result.aggregates["delay_rate"].value)

    def test_offsets_representing_same_instant(self):
        result = calculate(history(delivered="2026-10-29T21:06:00Z", deadline="2026-10-30T02:36:00+05:30"))
        self.assertEqual(0, result.orders["o"].metrics["delivery_deviation"].value)

    def test_cross_midnight(self):
        events = history(delivered="2026-10-30T00:02:30-03:00", deadline="2026-10-29T23:59:00-03:00")
        self.assertEqual(Fraction(7, 2), calculate(events).orders["o"].metrics["delivery_delay"].value)

    def test_kitchen_earliness_is_zero_delay(self):
        events = history()
        events[0]["data"]["promised_ready_at"] = "2026-10-29T18:10:00-03:00"
        self.assertEqual(0, calculate(events).orders["o"].metrics["kitchen_delay"].value)

    def test_waiting_fractional_minute(self):
        events = history()
        events[3]["occurred_at"] = "2026-10-29T18:04:29.500000-03:00"
        self.assertEqual(Fraction(61, 120), calculate(events).orders["o"].metrics["courier_waiting_time"].value)

    def test_missing_delivery_does_not_block_kitchen_or_waiting(self):
        result = calculate(history()[:-1])
        metrics = result.orders["o"].metrics
        self.assertFalse(metrics["delivery_delay"].available)
        self.assertEqual("NOT_DELIVERED", metrics["delivery_delay"].reason)
        self.assertEqual(1, metrics["kitchen_delay"].value)
        self.assertEqual(2, metrics["courier_waiting_time"].value)

    def test_missing_ready_has_no_invented_value(self):
        events = [e for e in history() if e["type"] != "KITCHEN_READY"]
        metrics = calculate(events).orders["o"].metrics
        for name in ["kitchen_delay", "courier_waiting_time", "delivery_delay"]:
            self.assertIsNone(metrics[name].value)
            self.assertTrue(metrics[name].reason)

    def test_no_ready_yet_has_missing_evidence_reason(self):
        metrics = calculate(history()[:2]).orders["o"].metrics
        self.assertEqual("MISSING_EVIDENCE", metrics["kitchen_delay"].reason)

    def test_negative_wait_sequence_is_not_applied_by_replay(self):
        events = history()
        events[5]["occurred_at"] = "2026-10-29T18:02:30-03:00"
        metric = calculate(events).orders["o"].metrics["courier_waiting_time"]
        self.assertIsNone(metric.value)
        self.assertEqual("INCONSISTENT_DEPENDENCY", metric.reason)
        self.assertNotIn("o-5", metric.supporting_event_ids)

    def test_negative_wait_guard_on_altered_snapshot(self):
        # Defesa aritmética; snapshots alterados pelo chamador não são a API normal.
        result = replay(ingest_lines([json.dumps(e) for e in history()]))
        result.orders["o"].timeline[5].event["occurred_at"] = "2026-10-29T18:02:00-03:00"
        metric = compute_metrics(result).orders["o"].metrics["courier_waiting_time"]
        self.assertIsNone(metric.value)
        self.assertEqual("NEGATIVE_WAITING_TIME", metric.reason)

    def test_cancelled_delivery_unavailable_but_existing_kitchen_fact_available(self):
        events = history()[:5]
        cancellation = deepcopy(history()[-1])
        cancellation["type"] = "ORDER_CANCELLED"
        cancellation["data"] = {"reason_reported": "customer_requested", "reason_verified": False}
        result = calculate(events + [cancellation])
        self.assertEqual("CANCELLED", result.orders["o"].status)
        self.assertIsNone(result.orders["o"].metrics["delivery_delay"].value)
        self.assertEqual(1, result.orders["o"].metrics["kitchen_delay"].value)
        self.assertEqual(Fraction(1), result.aggregates["cancellation_rate"].value)

    def test_terminal_ambiguity_blocks_delivery_not_previous_kitchen_or_waiting(self):
        cancel = deepcopy(history()[-1])
        cancel.update(event_id="cancel", type="ORDER_CANCELLED", occurred_at="2026-10-29T18:07:00-03:00")
        result = calculate(history() + [cancel])
        order = result.orders["o"]
        self.assertIsNone(order.status)
        self.assertEqual("AMBIGUOUS", order.metrics["delivery_delay"].evidence_quality)
        self.assertEqual(1, order.metrics["kitchen_delay"].value)
        self.assertEqual("AMBIGUOUS", order.metrics["kitchen_delay"].order_resolution)
        self.assertEqual(2, order.metrics["courier_waiting_time"].value)
        self.assertEqual(0, result.aggregates["total_delivered"].value)
        self.assertEqual(0, result.aggregates["cancellation_rate"].denominator)
        self.assertEqual(1, result.aggregates["total_created"].value)

    def test_restaurant_identity_ambiguity_blocks_all_metrics(self):
        events = history()
        extra = deepcopy(events[1])
        extra.update(event_id="foreign", restaurant_id="other")
        result = calculate(events + [extra])
        self.assertTrue(all(not m.available for m in result.orders["o"].metrics.values()))
        self.assertEqual(0, result.aggregates["total_created"].value)
        self.assertEqual("PARTIAL", result.aggregates["total_created"].evidence_quality)

    def test_incompatible_creations_block_all_metrics(self):
        events = history()
        extra = deepcopy(events[0])
        extra["event_id"] = "second-creation"
        extra["data"]["promised_ready_at"] = "2026-10-29T18:21:00-03:00"
        result = calculate(events + [extra])
        self.assertTrue(all(not m.available for m in result.orders["o"].metrics.values()))

    def test_redundant_compatible_creation_does_not_block_valid_values(self):
        events = history()
        extra = deepcopy(events[0])
        extra["event_id"] = "second-creation"
        order = calculate(events + [extra]).orders["o"]
        self.assertEqual("INCONSISTENT", order.resolution)
        self.assertTrue(all(m.available for m in order.metrics.values()))

    def test_relevant_delivery_conflict_excludes_from_delay_denominator(self):
        events = history()
        result = calculate(events + [conflict(events[-1])])
        metric = result.orders["o"].metrics["delivery_delay"]
        self.assertEqual("CONFLICTING_DEPENDENCY", metric.reason)
        self.assertEqual("INCOMPLETE", metric.evidence_quality)
        self.assertEqual("o-6", metric.conflicts[0].event_id)
        self.assertEqual(0, result.aggregates["delay_rate"].denominator)
        self.assertEqual(1, result.orders["o"].metrics["kitchen_delay"].value)

    def test_unrelated_courier_conflict_does_not_block_kitchen(self):
        events = history()
        result = calculate(events + [conflict(events[2])])
        kitchen = result.orders["o"].metrics["kitchen_delay"]
        self.assertEqual(1, kitchen.value)
        self.assertEqual("SUFFICIENT", kitchen.evidence_quality)
        self.assertEqual("INCOMPLETE", kitchen.order_evidence_quality)
        self.assertIsNone(result.orders["o"].metrics["courier_waiting_time"].value)

    def test_excluded_cancellation_qualifies_delivery_but_not_prior_facts(self):
        cancel = deepcopy(history()[-1])
        cancel.update(event_id="cancel", type="ORDER_CANCELLED")
        result = calculate(history() + [cancel, conflict(cancel)])
        self.assertEqual("DELIVERED", result.orders["o"].status)
        self.assertIsNone(result.orders["o"].metrics["delivery_delay"].value)
        self.assertEqual(1, result.orders["o"].metrics["kitchen_delay"].value)
        self.assertEqual(0, result.aggregates["cancellation_rate"].denominator)

    def test_irrelevant_inconsistent_event_does_not_poison_kitchen(self):
        events = history()
        extra = deepcopy(events[2])
        extra.update(event_id="early-courier", occurred_at="2026-10-29T17:59:00-03:00")
        order = calculate(events + [extra]).orders["o"]
        self.assertEqual("INCONSISTENT", order.resolution)
        self.assertEqual(1, order.metrics["kitchen_delay"].value)
        self.assertIsNone(order.metrics["courier_waiting_time"].value)

    def test_zero_denominators_and_empty_counts(self):
        result = calculate([])
        self.assertEqual({}, result.orders)
        for name in ["delay_rate", "cancellation_rate"]:
            rate = result.aggregates[name]
            self.assertIsNone(rate.value)
            self.assertEqual((0, 0), (rate.numerator, rate.denominator))
            self.assertEqual("ZERO_DENOMINATOR", rate.reason)
        self.assertEqual(0, result.aggregates["total_created"].value)

    def test_orphan_and_conflicts_only_are_explicit_exclusions(self):
        events = history()
        result = calculate(events[1:])
        self.assertEqual({}, result.orders)
        self.assertEqual("ORDER_NOT_CREATED", result.excluded_histories[0].reason)
        result = calculate([events[0], conflict(events[0])])
        self.assertEqual({}, result.orders)
        self.assertEqual(("o",), result.diagnostic_order_ids)
        self.assertEqual("NO_ACCEPTED_HISTORY", result.excluded_histories[0].reason)
        self.assertEqual("PARTIAL", result.aggregates["total_created"].evidence_quality)

    def test_eligible_denominators_use_available_measurements(self):
        good = history("good")
        bad = history("bad")
        result = calculate(good + bad + [conflict(bad[-1])])
        delay = result.aggregates["delay_rate"]
        self.assertEqual((1, 1), (delay.numerator, delay.denominator))
        self.assertEqual(("good",), delay.denominator_order_ids)
        self.assertEqual("bad", delay.excluded_orders[0].order_id)
        self.assertEqual("PARTIAL", delay.evidence_quality)

    def test_open_created_orders_in_cancellation_snapshot_denominator(self):
        result = calculate(history("delivered") + history("open")[:1])
        self.assertEqual((0, 2), (result.aggregates["cancellation_rate"].numerator,
                                result.aggregates["cancellation_rate"].denominator))

    def test_lineage_for_every_fixture_metric(self):
        result = compute_metrics(replay(read_jsonl(FIXTURE)))
        raw = {e["event_id"]: e for e in map(json.loads, FIXTURE.read_text(encoding="utf-8").splitlines())}
        for order in result.orders.values():
            for metric in order.metrics.values():
                self.assertEqual(metric.available, metric.value is not None)
                self.assertEqual("minutes", metric.unit)
                self.assertTrue(metric.formula)
                if metric.available:
                    self.assertEqual(2, len(metric.sources))
                    self.assertIsNone(metric.reason)
                else:
                    self.assertTrue(metric.reason)
                for source in metric.sources:
                    value = raw[source.event_id]
                    for field_name in source.field.split("."):
                        value = value[field_name]
                    self.assertEqual(value, source.timestamp)
                    self.assertEqual(source.event_id, json.loads(source.origins[0].raw)["event_id"])
        delay = result.orders["ord-1002"].metrics["delivery_delay"]
        self.assertEqual(("evt-004", "evt-020"), delay.event_ids)
        self.assertEqual("data.promised_delivery_at", delay.sources[0].field)
        for aggregate in result.aggregates.values():
            for oid, eid in aggregate.supporting_events:
                self.assertEqual(oid, raw[eid]["order_id"])

    def test_shuffles_and_repeated_events_preserve_metrics(self):
        events = [json.loads(s) for s in FIXTURE.read_text(encoding="utf-8").splitlines()]
        baseline = calculate(events)
        for seed in range(10):
            shuffled = deepcopy(events)
            random.Random(seed).shuffle(shuffled)
            self.assertEqual(baseline, calculate(shuffled))
        self.assertEqual(baseline, calculate(events + [events[-1], events[0]]))

    def test_conflict_shuffles_keep_quality_and_values(self):
        events = history()
        events += [conflict(events[-1])]
        baseline = calculate(events)
        self.assertEqual(baseline, calculate(events[::-1]))

    def test_metrics_do_not_mutate_or_alias_replay(self):
        source = replay(read_jsonl(FIXTURE))
        before = deepcopy(source)
        result = compute_metrics(source)
        self.assertEqual(before, source)
        result.orders.clear()
        self.assertEqual(before, source)

    def test_only_operational_context_is_not_a_created_order(self):
        events = [json.loads(s) for s in FIXTURE.read_text(encoding="utf-8").splitlines()]
        result = calculate([e for e in events if e["order_id"] is None])
        self.assertEqual({}, result.orders)
        self.assertEqual(0, result.aggregates["total_created"].value)

    def test_requires_real_replay_result(self):
        with self.assertRaises(TypeError):
            compute_metrics([])


class Review003RegressionTests(unittest.TestCase):
    @staticmethod
    def cancelled(order_id="c"):
        events = history(order_id)
        events[6]["type"] = "ORDER_CANCELLED"
        return [events[0], events[2], events[6]]

    def test_trusted_cancellation_with_repeated_courier_is_outside_delivery_population(self):
        cancelled = history("c")
        cancelled[6]["type"] = "ORDER_CANCELLED"
        repeat = deepcopy(cancelled[2])
        repeat.update(event_id="repeat", occurred_at="2026-10-29T18:02:30-03:00")
        result = calculate(history("d") + [cancelled[0], cancelled[2], repeat, cancelled[6]])
        order = result.orders["c"]
        self.assertTrue(order.eligibility["cancelled"].eligible)
        self.assertEqual("INCONSISTENT", order.resolution)
        self.assertEqual("INCONSISTENT_DEPENDENCY", order.metrics["delivery_delay"].reason)
        for population in ("delivered", "delivery_population"):
            self.assertEqual("NOT_DELIVERED", order.eligibility[population].reason)
        rate = result.aggregates["delay_rate"]
        self.assertEqual((Fraction(1), 1, 1), (rate.value, rate.numerator, rate.denominator))
        self.assertEqual([("c", "NOT_DELIVERED")], [(e.order_id, e.reason) for e in rate.excluded_orders])
        self.assertEqual("COMPLETE", rate.evidence_quality)

    def test_compromised_terminal_evidence_does_not_become_normal_exclusion(self):
        for kind in ("ORDER_CANCELLED", "DELIVERED"):
            with self.subTest(kind=kind):
                events = self.cancelled()
                uncertain = deepcopy(events[-1])
                uncertain.update(event_id="uncertain", type=kind)
                result = calculate(history("d") + events + [uncertain, conflict(uncertain)])
                self.assertEqual("CANCELLED", result.orders["c"].status)
                self.assertFalse(result.orders["c"].eligibility["cancelled"].eligible)
                rate = result.aggregates["delay_rate"]
                self.assertEqual((1, 1), (rate.numerator, rate.denominator))
                self.assertEqual("CONFLICTING_DEPENDENCY", rate.excluded_orders[0].reason)
                self.assertEqual("PARTIAL", rate.evidence_quality)

    def test_compromised_creation_blocks_even_with_another_applied_creation(self):
        events = self.cancelled()
        creation = deepcopy(events[0])
        creation["event_id"] = "other-creation"
        result = calculate(history("d") + events + [creation, conflict(creation)])
        order = result.orders["c"]
        self.assertEqual("CANCELLED", order.status)
        self.assertFalse(order.eligibility["cancelled"].eligible)
        self.assertEqual("CONFLICTING_DEPENDENCY", order.eligibility["delivery_population"].reason)
        self.assertEqual("PARTIAL", result.aggregates["delay_rate"].evidence_quality)

    def test_delivered_order_with_inconsistent_chain_remains_excluded(self):
        events = history("bad")
        repeat = deepcopy(events[2])
        repeat.update(event_id="repeat", occurred_at="2026-10-29T18:02:30-03:00")
        result = calculate(history("d") + events + [repeat])
        order = result.orders["bad"]
        self.assertEqual("DELIVERED", order.status)
        self.assertIsNone(order.metrics["delivery_delay"].value)
        for key in ("delivered", "delivery_population"):
            self.assertEqual("INCONSISTENT_DEPENDENCY", order.eligibility[key].reason)
        self.assertEqual("PARTIAL", result.aggregates["delay_rate"].evidence_quality)
        self.assertEqual((1, 1), (result.aggregates["delay_rate"].numerator,
                                result.aggregates["delay_rate"].denominator))

    def test_contradictory_terminal_orders_remain_ambiguous_in_both_chronologies(self):
        for cancel_first in (False, True):
            with self.subTest(cancel_first=cancel_first):
                events = history("c")
                cancellation = deepcopy(events[-1])
                cancellation.update(event_id="cancel", type="ORDER_CANCELLED",
                                    occurred_at="2026-10-29T18:05:30-03:00" if cancel_first
                                    else "2026-10-29T18:07:00-03:00")
                result = calculate(history("d") + events + [cancellation])
                order = result.orders["c"]
                self.assertIsNone(order.status)
                self.assertEqual("AMBIGUOUS", order.resolution)
                self.assertEqual("AMBIGUOUS_DEPENDENCY", order.eligibility["delivery_population"].reason)
                self.assertEqual("PARTIAL", result.aggregates["delay_rate"].evidence_quality)

    def test_only_trusted_cancelled_orders_have_known_empty_delivery_population(self):
        events = self.cancelled()
        result = calculate(events + [conflict(events[1])])
        rate = result.aggregates["delay_rate"]
        self.assertIsNone(rate.value)
        self.assertEqual("ZERO_DENOMINATOR", rate.reason)
        self.assertEqual((0, 0), (rate.numerator, rate.denominator))
        self.assertEqual("COMPLETE", rate.evidence_quality)
        for key in ("total_delivered", "total_late_deliveries", "total_on_time_deliveries"):
            self.assertEqual(0, result.aggregates[key].value)
            self.assertEqual("COMPLETE", result.aggregates[key].evidence_quality)
        self.assertEqual(Fraction(1), result.aggregates["cancellation_rate"].value)

    def test_mixed_population_preserves_exact_rates_ids_and_exclusions(self):
        cancelled = self.cancelled()
        result = calculate(history("late") + history("on-time", deadline="2026-10-29T18:06:00-03:00")
                           + cancelled + [conflict(cancelled[1])])
        rate = result.aggregates["delay_rate"]
        self.assertEqual(Fraction(1, 2), rate.value)
        self.assertEqual((1, 2), (rate.numerator, rate.denominator))
        self.assertEqual(("late",), rate.numerator_order_ids)
        self.assertEqual(("late", "on-time"), rate.denominator_order_ids)
        self.assertEqual([("c", "NOT_DELIVERED")], [(e.order_id, e.reason) for e in rate.excluded_orders])
        self.assertEqual("COMPLETE", rate.evidence_quality)
        self.assertEqual(Fraction(1, 3), result.aggregates["cancellation_rate"].value)
        classification = result.orders["c"].eligibility["delivery_population"]
        self.assertEqual(("c-0", "c-6"), classification.supporting_event_ids)
        self.assertTrue(all(oid != "c" for oid, _ in rate.supporting_events))

    def test_relevant_uncertainty_stays_partial_and_is_deterministic(self):
        cancelled = self.cancelled()
        bad = history("bad")
        events = history("d") + cancelled + [conflict(cancelled[1])] + bad + [conflict(bad[-1])]
        baseline = calculate(events)
        rate = baseline.aggregates["delay_rate"]
        self.assertEqual("PARTIAL", rate.evidence_quality)
        self.assertEqual({"c": "NOT_DELIVERED", "bad": "CONFLICTING_DEPENDENCY"},
                         {e.order_id: e.reason for e in rate.excluded_orders})
        for seed in range(10):
            shuffled = deepcopy(events)
            random.Random(seed).shuffle(shuffled)
            self.assertEqual(baseline, calculate(shuffled))

    def test_individual_metrics_and_raw_replay_evidence_remain_intact(self):
        events = history("c")
        events[-1]["type"] = "ORDER_CANCELLED"
        repeat = deepcopy(events[2])
        repeat.update(event_id="repeat", occurred_at="2026-10-29T18:02:30-03:00")
        snapshot = replay(ingest_lines([json.dumps(e) for e in events + [repeat]], source="review003.jsonl"))
        before = deepcopy(snapshot)
        result = compute_metrics(snapshot)
        self.assertEqual(before, snapshot)
        order = result.orders["c"]
        self.assertEqual(1, order.metrics["kitchen_delay"].value)
        self.assertEqual("INCONSISTENT_DEPENDENCY", order.metrics["courier_waiting_time"].reason)
        self.assertEqual("INCONSISTENT_DEPENDENCY", order.metrics["delivery_delay"].reason)
        issue = order.metrics["delivery_delay"].issues[0]
        self.assertEqual("REPEATED_MILESTONE", issue.code)
        evidence = next(e for e in issue.evidence if e.event["event_id"] == "repeat")
        self.assertEqual("2026-10-29T18:02:30-03:00", evidence.event["occurred_at"])
        self.assertEqual(("review003.jsonl", 8), (evidence.origins[0].source, evidence.origins[0].line))
        self.assertEqual("NOT_DELIVERED", order.eligibility["delivery_population"].reason)

    def test_trusted_cancellation_with_conflicting_courier_is_outside_delivery_population(self):
        cancelled = history("c")
        cancelled[6]["type"] = "ORDER_CANCELLED"
        result = calculate(history("d") + [cancelled[0], cancelled[2], conflict(cancelled[2]), cancelled[6]])
        order = result.orders["c"]
        self.assertTrue(order.eligibility["cancelled"].eligible)
        self.assertEqual("INCOMPLETE", order.evidence_quality)
        metric = order.metrics["delivery_delay"]
        self.assertEqual("CONFLICTING_DEPENDENCY", metric.reason)
        self.assertEqual("c-2", metric.conflicts[0].event_id)
        self.assertEqual(2, len(metric.conflicts[0].origins))
        for population in ("delivered", "delivery_population"):
            self.assertEqual("NOT_DELIVERED", order.eligibility[population].reason)
        rate = result.aggregates["delay_rate"]
        self.assertEqual((Fraction(1), 1, 1), (rate.value, rate.numerator, rate.denominator))
        self.assertEqual("COMPLETE", rate.evidence_quality)


if __name__ == "__main__":
    unittest.main()
