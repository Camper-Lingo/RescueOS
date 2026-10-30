from copy import deepcopy
import json
from pathlib import Path
import random
import unittest

from rescueos.ingest import ingest_lines, read_jsonl
from rescueos.replay import replay

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "demo_events.jsonl"


def make(event_id, kind, time="18:00", **changes):
    event = {
        "event_id": event_id, "order_id": "ord-test", "restaurant_id": "rest-01",
        "occurred_at": f"2026-10-29T{time}:00-03:00", "type": kind,
        "data": {"promised_ready_at": "2026-10-29T18:20:00-03:00",
                 "promised_delivery_at": "2026-10-29T18:48:00-03:00"}
        if kind == "ORDER_CREATED" else {},
    }
    event.update(changes)
    return event


def run(*events):
    return replay(ingest_lines([json.dumps(e) for e in events], source="test.jsonl"))


def full_history():
    return [make(f"e{i}", kind, f"18:{i:02}") for i, kind in enumerate([
        "ORDER_CREATED", "KITCHEN_STARTED", "COURIER_ASSIGNED", "COURIER_ARRIVED",
        "KITCHEN_READY", "PICKED_UP", "DELIVERED",
    ])]


class ReplayTests(unittest.TestCase):
    def test_fixture_statuses_and_complete_timelines(self):
        result = replay(read_jsonl(FIXTURE))
        expected = {
            "ord-1001": ("DELIVERED", [2, 3, 10, 12, 13, 14, 19]),
            "ord-1002": ("DELIVERED", [4, 6, 11, 15, 17, 18, 20]),
            "ord-1003": ("CANCELLED", [5, 9, 16]),
        }
        self.assertEqual(set(expected), set(result.orders))
        for order_id, (status, numbers) in expected.items():
            order = result.orders[order_id]
            ids = [f"evt-{number:03}" for number in numbers]
            self.assertEqual(status, order.status)
            self.assertEqual("CONSISTENT", order.resolution)
            self.assertEqual(ids, [e.event["event_id"] for e in order.timeline])
            self.assertEqual(tuple(ids), order.applied_event_ids)
            self.assertEqual((ids[-1],), order.status_event_ids)
            for evidence, number in zip(order.timeline, numbers):
                self.assertEqual(number, evidence.origins[0].line)
                self.assertEqual(evidence.event, json.loads(evidence.origins[0].raw))
        self.assertEqual((), result.inconsistencies)
        self.assertEqual({}, result.orphan_histories)

    def test_fixture_context_preserved_without_artificial_orders(self):
        result = replay(read_jsonl(FIXTURE))
        self.assertEqual(["evt-001", "evt-007", "evt-008"],
                         [e.event["event_id"] for e in result.operational_context])
        self.assertEqual(6, result.operational_context[-1].event["data"]["active_preparations"])

    def test_random_input_orders_have_same_business_projection(self):
        lines = FIXTURE.read_text(encoding="utf-8").splitlines()
        baseline = replay(ingest_lines(lines))
        for seed in range(10):
            shuffled = lines.copy()
            random.Random(seed).shuffle(shuffled)
            self.assertEqual(baseline, replay(ingest_lines(shuffled)))

    def test_utc_order_instead_of_wall_clock_or_id(self):
        created = make("z-created", "ORDER_CREATED", occurred_at="2026-10-29T23:50:00+02:00")
        started = make("a-started", "KITCHEN_STARTED", occurred_at="2026-10-29T19:00:00-03:00")
        order = run(started, created).orders["ord-test"]
        self.assertEqual(["z-created", "a-started"], [e.event["event_id"] for e in order.timeline])
        self.assertEqual("PREPARING", order.status)

    def test_timestamp_ties_use_ids_after_utc_normalization(self):
        created = make("a", "ORDER_CREATED", occurred_at="2026-10-29T21:00:00Z")
        started = make("b", "KITCHEN_STARTED")
        self.assertEqual("PREPARING", run(started, created).orders["ord-test"].status)
        self.assertEqual(run(started, created), run(created, started))

    def test_tie_with_event_id_before_creation_is_not_retroactive(self):
        order = run(make("a", "KITCHEN_STARTED"), make("z", "ORDER_CREATED")).orders["ord-test"]
        self.assertEqual("CREATED", order.status)
        self.assertEqual("EVENT_BEFORE_CREATION", order.inconsistencies[0].code)
        self.assertEqual(("z",), order.applied_event_ids)

    def test_year_boundaries_do_not_overflow_utc_sorting(self):
        for timestamp in ["0001-01-01T00:00:00+23:00", "9999-12-31T23:59:59-23:00"]:
            with self.subTest(timestamp=timestamp):
                result = run(make("e", "ORDER_CREATED", occurred_at=timestamp))
                self.assertEqual("CREATED", result.orders["ord-test"].status)

    def test_microsecond_order_is_exact(self):
        created = make("z", "ORDER_CREATED", occurred_at="2026-10-29T21:00:00.000001Z")
        started = make("a", "KITCHEN_STARTED", occurred_at="2026-10-29T21:00:00.000002Z")
        self.assertEqual("PREPARING", run(started, created).orders["ord-test"].status)

    def test_empty_input(self):
        result = run()
        self.assertEqual({}, result.orders)
        self.assertEqual((), result.inconsistencies)

    def test_only_context_even_when_order_id_is_filled(self):
        result = run(make("capacity", "RESTAURANT_CAPACITY_UPDATED", order_id=None,
                          data={"max_concurrent_orders": 3, "active_preparations": 6}),
                     make("promotion", "PROMOTION_STARTED", data={"promotion_id": "p", "source": "simulator"}))
        self.assertEqual({}, result.orders)
        self.assertEqual({}, result.orphan_histories)
        self.assertEqual(2, len(result.operational_context))

    def test_orphans_do_not_become_orders(self):
        result = run(make("a", "KITCHEN_STARTED"), make("b", "DELIVERED", "18:01"))
        self.assertEqual({}, result.orders)
        orphan = result.orphan_histories["ord-test"]
        self.assertEqual(2, len(orphan.timeline))
        self.assertEqual(["ORDER_NOT_CREATED"] * 2, [i.code for i in orphan.inconsistencies])
        self.assertEqual(1, orphan.inconsistencies[0].evidence[0].origins[0].line)

    def test_precreation_event_preserved_but_not_applied(self):
        order = run(make("a", "KITCHEN_STARTED"), make("b", "ORDER_CREATED", "18:01")).orders["ord-test"]
        self.assertEqual("CREATED", order.status)
        self.assertEqual("INCONSISTENT", order.resolution)
        self.assertEqual(2, len(order.timeline))
        self.assertEqual(("b",), order.applied_event_ids)

    def test_missing_prerequisites_independently(self):
        for kind in ["KITCHEN_READY", "COURIER_ARRIVED", "PICKED_UP", "DELIVERED"]:
            with self.subTest(kind=kind):
                order = run(make("a", "ORDER_CREATED"), make("b", kind, "18:01")).orders["ord-test"]
                self.assertEqual("CREATED", order.status)
                self.assertEqual("MISSING_PREREQUISITE", order.inconsistencies[0].code)
                self.assertEqual(("a",), order.applied_event_ids)

    def test_courier_does_not_regress_kitchen_phase(self):
        order = run(make("a", "ORDER_CREATED"), make("b", "KITCHEN_STARTED", "18:01"),
                    make("c", "KITCHEN_READY", "18:02"), make("d", "COURIER_ASSIGNED", "18:03"),
                    make("e", "COURIER_ARRIVED", "18:04")).orders["ord-test"]
        self.assertEqual("READY", order.status)
        self.assertEqual(("c",), order.status_event_ids)
        self.assertEqual((), order.inconsistencies)

    def test_pickup_requires_both_ready_and_arrived(self):
        history = full_history()
        for missing_id in ["e3", "e4"]:
            with self.subTest(missing_id=missing_id):
                order = run(*(e for e in history if e["event_id"] != missing_id)).orders["ord-test"]
                self.assertNotIn("e5", order.applied_event_ids)
                self.assertNotIn("e6", order.applied_event_ids)
                self.assertTrue(order.inconsistencies)

    def test_repeated_milestone_does_not_regress_status(self):
        order = run(*full_history()[:5], make("repeat", "KITCHEN_STARTED", "18:05")).orders["ord-test"]
        self.assertEqual("READY", order.status)
        self.assertEqual("REPEATED_MILESTONE", order.inconsistencies[0].code)
        self.assertNotIn("repeat", order.applied_event_ids)

    def test_cancellation_allowed_from_each_nonterminal_phase(self):
        history = full_history()
        for length in range(1, 7):
            with self.subTest(length=length):
                order = run(*history[:length], make("cancel", "ORDER_CANCELLED", "18:10")).orders["ord-test"]
                self.assertEqual("CANCELLED", order.status)
                self.assertEqual((), order.inconsistencies)

    def test_events_after_terminal_never_change_state(self):
        for kind in ["KITCHEN_STARTED", "KITCHEN_READY", "COURIER_ASSIGNED", "COURIER_ARRIVED", "PICKED_UP", "ORDER_CANCELLED"]:
            with self.subTest(kind=kind):
                order = run(make("a", "ORDER_CREATED"), make("b", "ORDER_CANCELLED", "18:01"),
                            make("c", kind, "18:02")).orders["ord-test"]
                self.assertEqual("CANCELLED", order.status)
                self.assertEqual("EVENT_AFTER_TERMINAL", order.inconsistencies[0].code)
                self.assertEqual(("b",), order.status_event_ids)
                self.assertNotIn("c", order.applied_event_ids)

    def test_same_terminal_repeated_preserves_first_evidence(self):
        order = run(*full_history(), make("again", "DELIVERED", "18:07")).orders["ord-test"]
        self.assertEqual("DELIVERED", order.status)
        self.assertEqual(("e6",), order.status_event_ids)
        self.assertEqual("EVENT_AFTER_TERMINAL", order.inconsistencies[0].code)

    def test_contradictory_terminals_are_ambiguous_in_both_chronologies(self):
        histories = [full_history() + [make("cancel", "ORDER_CANCELLED", "18:07")],
                     [make("a", "ORDER_CREATED"), make("b", "ORDER_CANCELLED", "18:01"), make("c", "DELIVERED", "18:02")]]
        for history in histories:
            with self.subTest(history=history):
                order = run(*history).orders["ord-test"]
                self.assertIsNone(order.status)
                self.assertEqual("AMBIGUOUS", order.resolution)
                self.assertEqual((), order.status_event_ids)
                issue = next(i for i in order.inconsistencies if i.code == "CONFLICTING_TERMINALS")
                self.assertEqual(2, len(issue.evidence))
                self.assertEqual(run(*history), run(*reversed(history)))

    def test_conflicting_terminals_even_if_delivery_lacks_pickup(self):
        order = run(make("a", "ORDER_CREATED"), make("b", "DELIVERED", "18:01"),
                    make("c", "ORDER_CANCELLED", "18:02")).orders["ord-test"]
        self.assertIsNone(order.status)
        self.assertIn("MISSING_PREREQUISITE", [i.code for i in order.inconsistencies])
        self.assertEqual("AMBIGUOUS", order.resolution)

    def test_compatible_creations_preserve_first_without_ambiguity(self):
        second = make("b", "ORDER_CREATED", occurred_at="2026-10-29T21:00:00Z")
        order = run(second, make("a", "ORDER_CREATED")).orders["ord-test"]
        self.assertEqual("CREATED", order.status)
        self.assertEqual("INCONSISTENT", order.resolution)
        self.assertEqual("MULTIPLE_CREATIONS", order.inconsistencies[0].code)
        self.assertEqual(("a",), order.applied_event_ids)

    def test_incompatible_creations_for_each_business_field(self):
        for field in ["occurred_at", "promised_ready_at", "promised_delivery_at", "restaurant_id"]:
            with self.subTest(field=field):
                second = make("b", "ORDER_CREATED")
                if field in second["data"]:
                    second["data"][field] = "2026-10-29T19:00:00-03:00"
                elif field == "occurred_at":
                    second[field] = "2026-10-29T18:01:00-03:00"
                else:
                    second[field] = "rest-other"
                order = run(make("a", "ORDER_CREATED"), second).orders["ord-test"]
                self.assertIsNone(order.status)
                self.assertEqual("AMBIGUOUS", order.resolution)
                self.assertIn("INCOMPATIBLE_CREATIONS", [i.code for i in order.inconsistencies])

    def test_restaurant_mismatch_preserves_all_evidence(self):
        order = run(make("a", "ORDER_CREATED"), make("b", "KITCHEN_STARTED", "18:01", restaurant_id="rest-other")).orders["ord-test"]
        self.assertIsNone(order.status)
        self.assertIsNone(order.restaurant_id)
        self.assertEqual("AMBIGUOUS", order.resolution)
        self.assertEqual(2, len(order.inconsistencies[0].evidence))
        self.assertEqual(("a",), order.applied_event_ids)

    def test_ingestion_duplicate_changes_audit_only(self):
        history = full_history()
        baseline, duplicate = run(*history), run(*history, history[-1])
        self.assertEqual(baseline, duplicate)
        self.assertEqual(2, len(duplicate.orders["ord-test"].timeline[-1].origins))

    def test_ingestion_conflicted_creation_is_excluded_not_reconstructed(self):
        first = make("a", "ORDER_CREATED")
        conflict = deepcopy(first)
        conflict["data"]["promised_ready_at"] = "2026-10-29T19:00:00-03:00"
        result = run(first, conflict, make("b", "DELIVERED", "18:01"))
        self.assertEqual({}, result.orders)
        self.assertIn("ord-test", result.orphan_histories)
        self.assertEqual("EVENT_ID_CONFLICT", result.ingestion_errors[0].code)
        self.assertEqual(2, len(result.ingestion_errors[0].origins))

    def test_invalid_ingestion_lines_stay_outside_timelines(self):
        result = replay(ingest_lines(['{', json.dumps(make("a", "ORDER_CREATED")),
                                     json.dumps(make("b", "UNKNOWN"))]))
        self.assertEqual(1, len(result.orders["ord-test"].timeline))
        self.assertEqual(2, len(result.ingestion_errors))

    def test_snapshot_has_no_alias_with_ingestion(self):
        ingestion = read_jsonl(FIXTURE)
        before = deepcopy(ingestion)
        result = replay(ingestion)
        self.assertEqual(before, ingestion)
        result.orders["ord-1001"].timeline[0].event["data"]["promised_ready_at"] = "changed"
        self.assertEqual(before, ingestion)

    def test_cancellation_reason_kept_as_reported_not_interpreted(self):
        result = replay(read_jsonl(FIXTURE))
        data = result.orders["ord-1003"].timeline[-1].event["data"]
        self.assertEqual({"reason_reported": "customer_requested", "reason_verified": False}, data)

    def test_replay_requires_ingestion_result(self):
        with self.assertRaises(TypeError):
            replay([])


class Review002RegressionTests(unittest.TestCase):
    def test_conflict_qualifies_integrity_without_changing_accepted_state(self):
        a = make("cancel", "ORDER_CANCELLED", "18:07", data={"reason_reported": "a"})
        b = make("cancel", "ORDER_CANCELLED", "18:07", data={"reason_reported": "b"})
        result = run(*full_history(), a, b)
        order = result.orders["ord-test"]
        self.assertEqual("DELIVERED", order.status)
        self.assertEqual("INCOMPLETE", order.resolution)
        self.assertEqual("INCOMPLETE", order.evidence_quality)
        self.assertEqual((), order.inconsistencies)
        conflict, = order.ingestion_conflicts
        self.assertEqual("EVENT_ID_CONFLICT", conflict.code)
        self.assertEqual("cancel", conflict.event_id)
        self.assertEqual([a, b], [json.loads(o.raw) for o in conflict.origins])
        self.assertNotIn("cancel", order.applied_event_ids)

    def test_restaurant_mismatch_after_terminal_reports_both_violations(self):
        order = run(*full_history(), make("foreign", "KITCHEN_STARTED", "18:07",
                                         restaurant_id="rest-other")).orders["ord-test"]
        self.assertEqual("AMBIGUOUS", order.resolution)
        self.assertIsNone(order.status)
        self.assertEqual(["RESTAURANT_MISMATCH", "EVENT_AFTER_TERMINAL"],
                         [i.code for i in order.inconsistencies])
        self.assertNotIn("foreign", order.applied_event_ids)
        for issue in order.inconsistencies:
            self.assertEqual("foreign", issue.evidence[-1].event["event_id"])
            self.assertEqual(8, issue.evidence[-1].origins[0].line)


class Review002IntegrationTests(unittest.TestCase):
    def test_conflicts_at_each_milestone_preserve_accepted_projection(self):
        for kind in ["ORDER_CREATED", "KITCHEN_STARTED", "COURIER_ASSIGNED", "COURIER_ARRIVED",
                     "KITCHEN_READY", "PICKED_UP", "DELIVERED", "ORDER_CANCELLED"]:
            with self.subTest(kind=kind):
                history = full_history()
                if kind == "ORDER_CANCELLED":
                    candidate = make("cancel", kind, "18:07")
                    accepted = history
                else:
                    candidate = next(e for e in history if e["type"] == kind)
                    accepted = [e for e in history if e is not candidate]
                variant = deepcopy(candidate)
                variant["data"]["review_note"] = "different"
                baseline = run(*accepted)
                for events in [accepted + [candidate, variant], [variant, candidate] + accepted[::-1]]:
                    result = run(*events)
                    if kind == "ORDER_CREATED":
                        self.assertEqual({}, result.orders)
                        orphan = result.orphan_histories["ord-test"]
                        self.assertEqual(1, len(orphan.ingestion_conflicts))
                        self.assertEqual("INCOMPLETE", orphan.evidence_quality)
                        continue
                    order = result.orders["ord-test"]
                    base_order = baseline.orders["ord-test"]
                    self.assertEqual(base_order.status, order.status)
                    self.assertEqual(base_order.status_event_ids, order.status_event_ids)
                    self.assertEqual(base_order.applied_event_ids, order.applied_event_ids)
                    self.assertEqual(base_order.timeline, order.timeline)
                    self.assertEqual(base_order.inconsistencies, order.inconsistencies)
                    self.assertEqual("INCOMPLETE", order.evidence_quality)
                    self.assertNotEqual("CONSISTENT", order.resolution)
                    self.assertNotIn(candidate["event_id"], order.applied_event_ids)

    def test_cancelled_state_is_not_replaced_by_excluded_delivery(self):
        accepted = [make("a", "ORDER_CREATED"), make("b", "ORDER_CANCELLED", "18:01")]
        delivery = make("delivery", "DELIVERED", "18:02")
        variant = deepcopy(delivery)
        variant["occurred_at"] = "2026-10-29T18:03:00-03:00"
        order = run(*accepted, delivery, variant).orders["ord-test"]
        self.assertEqual("CANCELLED", order.status)
        self.assertEqual("INCOMPLETE", order.resolution)
        self.assertEqual(("b",), order.status_event_ids)
        self.assertEqual((), order.inconsistencies)

    def test_only_conflicted_events_do_not_create_order_or_orphan(self):
        first = make("a", "ORDER_CREATED")
        second = deepcopy(first)
        second["restaurant_id"] = "other"
        result = run(first, second)
        self.assertEqual({}, result.orders)
        self.assertEqual({}, result.orphan_histories)
        self.assertEqual(1, len(result.ingestion_errors))
        self.assertEqual(("ord-test",), result.ingestion_errors[0].affected_order_ids)
        self.assertEqual([first, second], [json.loads(o.raw) for o in result.ingestion_errors[0].origins])

    def test_orphan_retains_conflict_without_applying_rejected_creation(self):
        a, b = make("created", "ORDER_CREATED"), make("created", "ORDER_CREATED", "18:01")
        result = run(a, b, make("orphan", "DELIVERED", "18:10"))
        self.assertEqual({}, result.orders)
        orphan = result.orphan_histories["ord-test"]
        self.assertEqual(["orphan"], [e.event["event_id"] for e in orphan.timeline])
        self.assertEqual("ORDER_NOT_CREATED", orphan.inconsistencies[0].code)
        self.assertEqual("created", orphan.ingestion_conflicts[0].event_id)

    def test_conflict_links_all_affected_orders_but_not_unrelated_order(self):
        a = make("shared", "KITCHEN_STARTED", "18:10")
        b = make("shared", "KITCHEN_STARTED", "18:10", order_id="ord-other")
        result = run(*full_history(), make("other", "ORDER_CREATED", order_id="ord-other"),
                     make("unrelated", "ORDER_CREATED", order_id="ord-unrelated"), a, b)
        for order_id in ["ord-test", "ord-other"]:
            order = result.orders[order_id]
            self.assertEqual("INCOMPLETE", order.resolution)
            self.assertEqual(("ord-other", "ord-test"), order.ingestion_conflicts[0].affected_order_ids)
        self.assertEqual("CONSISTENT", result.orders["ord-unrelated"].resolution)
        self.assertEqual("NO_LINKED_CONFLICTS", result.orders["ord-unrelated"].evidence_quality)
        self.assertEqual((), result.orders["ord-unrelated"].ingestion_conflicts)

    def test_ambiguity_of_accepted_terminals_has_priority_over_incompleteness(self):
        history = full_history() + [make("cancel", "ORDER_CANCELLED", "18:07")]
        a, b = make("excluded", "KITCHEN_STARTED", "18:10"), make("excluded", "KITCHEN_STARTED", "18:11")
        for events in [history + [a, b], [b, a] + history[::-1]]:
            order = run(*events).orders["ord-test"]
            self.assertIsNone(order.status)
            self.assertEqual("AMBIGUOUS", order.resolution)
            self.assertEqual("INCOMPLETE", order.evidence_quality)
            self.assertIn("CONFLICTING_TERMINALS", [i.code for i in order.inconsistencies])

    def test_transition_inconsistency_remains_separate_from_conflict(self):
        accepted = [make("a", "ORDER_CREATED"), make("b", "DELIVERED", "18:01")]
        a, b = make("excluded", "COURIER_ASSIGNED", "18:02"), make("excluded", "COURIER_ASSIGNED", "18:03")
        order = run(*accepted, a, b).orders["ord-test"]
        self.assertEqual("CREATED", order.status)
        self.assertEqual("INCONSISTENT", order.resolution)
        self.assertEqual("INCOMPLETE", order.evidence_quality)
        self.assertEqual(["MISSING_PREREQUISITE"], [i.code for i in order.inconsistencies])
        self.assertEqual(1, len(order.ingestion_conflicts))

    def test_conflict_projection_deterministic_with_shuffles_and_repeated_variants(self):
        a, b = make("cancel", "ORDER_CANCELLED", "18:07"), make("cancel", "ORDER_CANCELLED", "18:08")
        events = full_history() + [a, b]
        baseline = run(*events)
        for seed in range(10):
            shuffled = deepcopy(events)
            random.Random(seed).shuffle(shuffled)
            self.assertEqual(baseline, run(*shuffled))
        repeated = run(*events, a)
        self.assertEqual(baseline, repeated)
        self.assertEqual(3, len(repeated.orders["ord-test"].ingestion_conflicts[0].origins))

    def test_combined_violations_after_both_terminal_states_preserve_evidence(self):
        histories = [full_history(), [make("a", "ORDER_CREATED"), make("b", "ORDER_CANCELLED", "18:01")]]
        for history in histories:
            with self.subTest(terminal=history[-1]["type"]):
                bad = make("foreign", "DELIVERED", "18:10", restaurant_id="other")
                order = run(*history, bad).orders["ord-test"]
                self.assertEqual(["RESTAURANT_MISMATCH", "EVENT_AFTER_TERMINAL"], [i.code for i in order.inconsistencies])
                after = order.inconsistencies[1]
                self.assertEqual([history[-1]["event_id"], "foreign"], [e.event["event_id"] for e in after.evidence])
                self.assertEqual(bad, json.loads(after.evidence[-1].origins[0].raw))
                self.assertNotIn("foreign", order.applied_event_ids)

    def test_conflict_metadata_preserves_ids_timestamps_sources_and_input(self):
        a, b = make("cancel", "ORDER_CANCELLED", "18:07"), make("cancel", "ORDER_CANCELLED", "18:08")
        ingestion = ingest_lines([json.dumps(e) for e in full_history() + [a, b]], source="review002.jsonl")
        before = deepcopy(ingestion)
        result = replay(ingestion)
        self.assertEqual(before, ingestion)
        conflict, = result.orders["ord-test"].ingestion_conflicts
        self.assertEqual("cancel", conflict.event_id)
        self.assertEqual(("ORDER_CANCELLED",), conflict.affected_event_types)
        self.assertEqual([8, 9], [o.line for o in conflict.origins])
        self.assertEqual(["review002.jsonl"] * 2, [o.source for o in conflict.origins])
        self.assertEqual([a["occurred_at"], b["occurred_at"]], [json.loads(o.raw)["occurred_at"] for o in conflict.origins])


if __name__ == "__main__":
    unittest.main()
