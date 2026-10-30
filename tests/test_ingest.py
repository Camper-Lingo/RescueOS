from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from rescueos.contracts import timestamp_valid
from rescueos.ingest import ingest_lines, read_jsonl


FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "demo_events.jsonl"


def event(**changes):
    value = {
        "event_id": "evt-example", "order_id": "ord-example",
        "restaurant_id": "rest-01", "occurred_at": "2026-10-29T18:01:00-03:00",
        "type": "ORDER_CREATED", "data": {
            "promised_ready_at": "2026-10-29T18:20:00-03:00",
            "promised_delivery_at": "2026-10-29T18:48:00-03:00",
        },
    }
    value.update(changes)
    return value


def ingest(*events):
    return ingest_lines([json.dumps(value) for value in events], source="test.jsonl")


class IngestTests(unittest.TestCase):
    def test_fixture_all_twenty_events_accepted_and_bytes_preserved(self):
        before = hashlib.sha256(FIXTURE.read_bytes()).digest()
        result = read_jsonl(FIXTURE)
        self.assertEqual(20, len(result.events))
        self.assertEqual([], result.errors)
        self.assertEqual([], result.duplicates)
        self.assertEqual(before, hashlib.sha256(FIXTURE.read_bytes()).digest())
        self.assertEqual(2, result.origins_by_id["evt-002"][0].line)
        self.assertEqual(str(FIXTURE), result.origins_by_id["evt-002"][0].source)

    def test_duplicate_changes_only_diagnostics_and_origins(self):
        original = event()
        other = event(event_id="evt-other", type="DELIVERED", data={})
        baseline = ingest(original, other)
        duplicate = ingest(original, other, original, original)
        self.assertEqual(baseline.events, duplicate.events)
        self.assertEqual(baseline.errors, duplicate.errors)
        self.assertEqual("DUPLICATE_EVENT", duplicate.duplicates[0].code)
        self.assertEqual([1, 3, 4], [o.line for o in duplicate.duplicates[0].origins])

    def test_formatting_and_key_order_are_not_conflicts(self):
        original = event()
        reordered = dict(reversed(list(original.items())))
        reordered["data"] = dict(reversed(list(original["data"].items())))
        result = ingest_lines([json.dumps(original), json.dumps(reordered, indent=None, separators=(",", ":"))])
        self.assertEqual(1, len(result.events))
        self.assertEqual([], result.errors)
        self.assertEqual(1, len(result.duplicates))

    def test_conflict_excludes_all_variants_and_preserves_evidence(self):
        first = event()
        second = event(occurred_at="2026-10-29T18:02:00-03:00", order_id="ord-other")
        unaffected = event(event_id="evt-safe", type="DELIVERED", data={})
        result = ingest(first, unaffected, second, first)
        self.assertEqual((unaffected,), result.events)
        conflict, = result.errors
        self.assertEqual("EVENT_ID_CONFLICT", conflict.code)
        self.assertEqual("evt-example", conflict.event_id)
        self.assertEqual(("ord-example", "ord-other"), conflict.affected_order_ids)
        self.assertEqual(("ORDER_CREATED",), conflict.affected_event_types)
        self.assertIn("métricas", conflict.message)
        self.assertEqual([1, 3, 4], [o.line for o in conflict.origins])
        self.assertEqual([first, second, first], [json.loads(o.raw) for o in conflict.origins])
        self.assertEqual([], result.duplicates)

    def test_conflict_is_independent_of_input_order(self):
        values = [event(), event(data={}), event(event_id="evt-safe")]
        forward, reverse = ingest(*values), ingest(*reversed(values))
        self.assertEqual(forward.events, reverse.events)
        self.assertEqual(1, sum(e.code == "EVENT_ID_CONFLICT" for e in forward.errors))
        self.assertEqual(1, sum(e.code == "EVENT_ID_CONFLICT" for e in reverse.errors))

    def test_invalid_variant_still_conflicts_with_valid_variant(self):
        result = ingest(event(), event(type="UNKNOWN"))
        self.assertEqual((), result.events)
        self.assertEqual({"UNKNOWN_EVENT_TYPE", "EVENT_ID_CONFLICT"}, {e.code for e in result.errors})

    def test_all_content_and_json_types_participate_in_identity(self):
        for left, right in [(1, True), (1, 1.0), ("a", "b")]:
            with self.subTest(left=left, right=right):
                result = ingest(event(extra=left), event(extra=right))
                self.assertEqual((), result.events)
                self.assertEqual("EVENT_ID_CONFLICT", result.errors[0].code)

    def test_timestamp_offset_strings_are_not_normalized_for_identity(self):
        result = ingest(event(), event(occurred_at="2026-10-29T21:01:00Z"))
        self.assertEqual("EVENT_ID_CONFLICT", result.errors[0].code)

    def test_decimal_identity_does_not_lose_precision(self):
        template = json.dumps(event(extra="NUMBER"))
        first = template.replace('"NUMBER"', '1.00000000000000001')
        second = template.replace('"NUMBER"', '1.00000000000000002')
        result = ingest_lines([first, second])
        self.assertEqual((), result.events)
        self.assertEqual("EVENT_ID_CONFLICT", result.errors[0].code)
        equivalent = template.replace('"NUMBER"', '1.000000000000000010')
        result = ingest_lines([first, equivalent])
        self.assertEqual(1, len(result.events))
        self.assertEqual([], result.errors)
        self.assertEqual(1, len(result.duplicates))

    def test_required_envelope_fields(self):
        for key in event():
            with self.subTest(key=key):
                invalid = event()
                del invalid[key]
                result = ingest(invalid)
                self.assertEqual((), result.events)
                self.assertTrue(any(e.code == "MISSING_FIELD" and key in e.message for e in result.errors))

    def test_invalid_envelope_types_do_not_crash(self):
        cases = {"event_id": [None, 1, "", " "], "restaurant_id": [False, ""],
                 "order_id": [None, [], ""], "type": [{}, [], None, 4, ""],
                 "data": [None, [], "text"], "occurred_at": [None, 5]}
        for field, values in cases.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    result = ingest(event(**{field: value}))
                    self.assertEqual((), result.events)
                    self.assertTrue(result.errors)

    def test_unknown_type_has_clear_error_and_valid_next_line_survives(self):
        result = ingest(event(type="UNKNOWN"), event(event_id="evt-safe"))
        self.assertEqual("UNKNOWN_EVENT_TYPE", result.errors[0].code)
        self.assertIn("UNKNOWN", result.errors[0].message)
        self.assertEqual(1, result.errors[0].origins[0].line)
        self.assertEqual(1, len(result.events))

    def test_invalid_json_lines_and_structures_do_not_stop_reading(self):
        bad = ['{', '', 'null', '[]', '3', '{"x": NaN}', '{"x": Infinity}',
               '{"x": 1e999}', '{"x": 1, "x": 2}']
        result = ingest_lines(bad + [json.dumps(event())])
        self.assertEqual(1, len(result.events))
        self.assertEqual(len(bad), len(result.errors))
        self.assertEqual(list(range(1, len(bad) + 1)), [e.origins[0].line for e in result.errors])

    def test_nested_duplicate_json_keys_rejected(self):
        raw = json.dumps(event()).replace('"data": {', '"data": {"x": 1, "x": 2,')
        self.assertEqual("INVALID_JSON", ingest_lines([raw]).errors[0].code)

    def test_invalid_utf8_line_does_not_stop_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.jsonl"
            path.write_bytes(b"\xff\n" + json.dumps(event()).encode("utf-8") + b"\n")
            result = read_jsonl(path)
        self.assertEqual(1, len(result.events))
        self.assertEqual("INVALID_ENCODING", result.errors[0].code)
        self.assertIn("\\xff", result.errors[0].origins[0].raw)

    def test_missing_file_raises_explicit_io_error(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                read_jsonl(Path(directory) / "missing.jsonl")

    def test_data_contracts_and_optional_cancellation_fields(self):
        invalid = [
            event(data={}),
            event(data={"promised_ready_at": "2026-10-29T18:20:00", "promised_delivery_at": "bad"}),
            event(type="RESTAURANT_CAPACITY_UPDATED", order_id=None, data={}),
            event(type="RESTAURANT_CAPACITY_UPDATED", order_id=None, data={"max_concurrent_orders": True, "active_preparations": -1}),
            event(type="PROMOTION_STARTED", order_id=None, data={"promotion_id": 1, "source": ""}),
            event(type="ORDER_CANCELLED", data={"reason_reported": False, "reason_verified": "false"}),
        ]
        for value in invalid:
            with self.subTest(value=value):
                self.assertTrue(ingest(value).errors)
        self.assertFalse(ingest(event(type="ORDER_CANCELLED", data={})).errors)

    def test_all_ten_types_accept_valid_data(self):
        fixture = read_jsonl(FIXTURE)
        seen = {value["type"] for value in fixture.events}
        self.assertEqual(10, len(seen))
        self.assertEqual([], fixture.errors)

    def test_input_not_modified_and_text_is_never_executed(self):
        value = event(type="ORDER_CANCELLED", data={
            "reason_reported": "__import__('os').system('echo UNAUTHORIZED')",
            "reason_verified": False,
        })
        original = deepcopy(value)
        with patch("os.system") as system, patch("subprocess.run") as run:
            result = ingest(value)
        system.assert_not_called()
        run.assert_not_called()
        self.assertEqual(original, value)
        self.assertEqual((original,), result.events)

    def test_empty_input(self):
        result = ingest_lines([])
        self.assertEqual((), result.events)
        self.assertEqual([], result.errors)


class TimestampTests(unittest.TestCase):
    def test_valid_offsets_and_calendar(self):
        for value in ["2026-10-29T18:01:00-03:00", "2026-10-29T21:01:00Z",
                      "2026-10-30T02:31:00+05:30", "2024-02-29T00:00:00.123456+00:00"]:
            with self.subTest(value=value):
                self.assertTrue(timestamp_valid(value))

    def test_invalid_offsets_and_calendar(self):
        for value in ["2026-10-29T18:01:00", "2026-10-29", "2026-02-29T00:00:00Z",
                      "2026-10-29T25:00:00Z", "2026-10-29T18:01:00+24:00",
                      "2026-10-29T18:01:00+03:60", "2026-10-29T18:01:00-00:00",
                      "2026-10-29T18:01:00+0300", None, 42]:
            with self.subTest(value=value):
                self.assertFalse(timestamp_valid(value))

    def test_invalid_occurred_at_rejected_without_stopping_valid_event(self):
        result = ingest(event(occurred_at="2026-10-29T18:01:00"), event(event_id="evt-safe"))
        self.assertEqual(1, len(result.events))
        self.assertEqual("INVALID_TIMESTAMP", result.errors[0].code)
        self.assertIn("offset", result.errors[0].message)


if __name__ == "__main__":
    unittest.main()
