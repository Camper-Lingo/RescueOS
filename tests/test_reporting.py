from copy import deepcopy
from fractions import Fraction
import json
import os
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch

from rescueos.ingest import ingest_lines, read_jsonl
from rescueos.metrics import compute_metrics
from rescueos.replay import replay
from rescueos.reporting import REPORT_NAMES, ReportWriteError, build_reports, write_reports
from tests.test_metrics import conflict, history

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "demo_events.jsonl"


def pipeline(events=None):
    ingestion = read_jsonl(FIXTURE) if events is None else ingest_lines(
        [json.dumps(event) if isinstance(event, dict) else event for event in events], source="events.jsonl")
    projection = replay(ingestion)
    return ingestion, projection, compute_metrics(projection)


class ReportingTests(unittest.TestCase):
    def test_fixture_schema_and_exact_values(self):
        reports = build_reports(*pipeline())
        self.assertEqual(set(REPORT_NAMES), set(reports))
        summary, errors = json.loads(reports["summary.json"]), json.loads(reports["errors.json"])
        self.assertEqual("1.0", summary["schema_version"])
        self.assertEqual(64, len(summary["run_id"]))
        self.assertEqual(summary["run_id"], errors["run_id"])
        self.assertEqual(3, summary["order_count"])
        self.assertEqual({"numerator": 1, "denominator": 3}, summary["aggregates"]["cancellation_rate"]["value"])
        self.assertEqual({"numerator": 1, "denominator": 2}, summary["aggregates"]["delay_rate"]["value"])
        expected = {"ord-1001": (0, 5, 0, 1), "ord-1002": (13, 0, 11, 13)}
        for oid, values in expected.items():
            actual = summary["orders"][oid]["indicators"]["metrics"]
            for name, value in zip(("delivery_delay", "delivery_earliness", "kitchen_delay", "courier_waiting_time"), values):
                self.assertEqual({"numerator": value, "denominator": 1}, actual[name]["value"])
                self.assertTrue(actual[name]["available"])
        self.assertEqual([], errors["diagnostics"])

    def test_aggregate_schema_preserves_eligibility(self):
        summary = json.loads(build_reports(*pipeline())["summary.json"])
        rate = summary["aggregates"]["delay_rate"]
        self.assertEqual((1, 2), (rate["numerator"], rate["denominator"]))
        self.assertEqual(["ord-1001", "ord-1002"], rate["denominator_order_ids"])
        self.assertEqual([{"order_id": "ord-1003", "reason": "NOT_DELIVERED"}], rate["excluded_orders"])
        self.assertEqual("COMPLETE", rate["evidence_quality"])
        for key in ("criteria", "formula", "unit", "supporting_events"):
            self.assertTrue(rate[key])

    def test_none_stays_null_and_unavailable(self):
        reports = build_reports(*pipeline())
        metric = json.loads(reports["summary.json"])["orders"]["ord-1003"]["indicators"]["metrics"]["delivery_delay"]
        self.assertIsNone(metric["value"])
        self.assertFalse(metric["available"])
        self.assertEqual("NOT_DELIVERED", metric["reason"])
        self.assertIn('"value": null', reports["summary.json"])
        self.assertIn("indisponível", reports["report.md"])

    def test_fraction_with_microseconds_has_no_float_conversion(self):
        events = history(delivered="2026-10-29T18:05:01.000001-03:00")
        summary = json.loads(build_reports(*pipeline(events))["summary.json"])
        value = summary["orders"]["o"]["indicators"]["metrics"]["delivery_delay"]["value"]
        self.assertEqual(Fraction(1_000_001, 60_000_000), Fraction(value["numerator"], value["denominator"]))

    def test_lineage_fields_timestamps_and_physical_origins(self):
        reports = build_reports(*pipeline())
        summary, errors = json.loads(reports["summary.json"]), json.loads(reports["errors.json"])
        sources = summary["orders"]["ord-1002"]["indicators"]["metrics"]["delivery_delay"]["sources"]
        self.assertEqual(["evt-004", "evt-020"], [source["event_id"] for source in sources])
        self.assertEqual("data.promised_delivery_at", sources[0]["field"])
        self.assertEqual("2026-10-29T18:52:00-03:00", sources[0]["timestamp"])
        catalog = {event["event_id"]: event for event in errors["evidence_catalog"]}
        self.assertEqual(20, catalog["evt-020"]["origins"][0]["line"])
        self.assertEqual(64, len(catalog["evt-020"]["origins"][0]["raw_text_sha256"]))
        self.assertNotIn("origins", sources[0])

    def test_duplicate_changes_audit_only(self):
        events = history()
        before = build_reports(*pipeline(events))
        after = build_reports(*pipeline(events + [deepcopy(events[-1])]))
        for name in ("summary.json", "report.md"):
            self.assertEqual(before[name], after[name])
        errors = json.loads(after["errors.json"])
        duplicate = next(d for d in errors["diagnostics"] if d["code"] == "DUPLICATE_EVENT")
        self.assertEqual(("INFO", "duplicate", 2), (duplicate["severity"], duplicate["classification"], len(duplicate["origins"])))
        self.assertFalse(duplicate["fatal"])

    def test_conflicts_preserve_audit_and_partial_quality(self):
        events = history()
        reports = build_reports(*pipeline(events + [conflict(events[-1])]))
        summary, errors = json.loads(reports["summary.json"]), json.loads(reports["errors.json"])
        self.assertEqual("PARTIAL", summary["aggregates"]["delay_rate"]["evidence_quality"])
        diagnostic = next(d for d in errors["diagnostics"] if d["code"] == "EVENT_ID_CONFLICT")
        self.assertEqual(("ERROR", ["o"], ["DELIVERED"]),
                         (diagnostic["severity"], diagnostic["affected_order_ids"], diagnostic["affected_event_types"]))
        self.assertEqual(2, len(diagnostic["origins"]))
        self.assertEqual(2, len({o["raw_text_sha256"] for o in diagnostic["origins"]}))
        self.assertNotIn(events[-1]["event_id"], [e["event_id"] for e in errors["evidence_catalog"]])
        self.assertTrue(any(d["code"] == "INCOMPLETE_EVIDENCE" for d in errors["diagnostics"]))
        self.assertIn("EVENT\\_ID\\_CONFLICT", reports["report.md"])

    def test_cancelled_courier_conflict_does_not_poison_complete_population(self):
        c = history("c")
        c[-1]["type"] = "ORDER_CANCELLED"
        reports = build_reports(*pipeline(history("d") + [c[0], c[2], conflict(c[2]), c[-1]]))
        summary = json.loads(reports["summary.json"])
        self.assertEqual("COMPLETE", summary["aggregates"]["delay_rate"]["evidence_quality"])
        self.assertEqual("INCOMPLETE", summary["orders"]["c"]["replay"]["evidence_quality"])

    def test_inconsistency_evidence_and_ambiguous_state(self):
        events = history()
        cancel = deepcopy(events[-1])
        cancel.update(event_id="cancel", type="ORDER_CANCELLED", occurred_at="2026-10-29T18:07:00-03:00")
        reports = build_reports(*pipeline(events + [cancel]))
        summary, errors = json.loads(reports["summary.json"]), json.loads(reports["errors.json"])
        self.assertIsNone(summary["orders"]["o"]["replay"]["status"])
        issue = next(d for d in errors["diagnostics"] if d["code"] == "CONFLICTING_TERMINALS")
        self.assertEqual("WARNING", issue["severity"])
        self.assertEqual({"o-6", "cancel"}, {e["event_id"] for e in issue["evidence"]})
        self.assertTrue(all(e["origins"] and e["occurred_at"] for e in issue["evidence"]))

    def test_invalid_lines_are_diagnostics_not_fake_orders(self):
        reports = build_reports(*pipeline(["not json", *history()]))
        errors = json.loads(reports["errors.json"])
        self.assertEqual(1, json.loads(reports["summary.json"])["order_count"])
        self.assertEqual("INVALID_JSON", errors["diagnostics"][0]["code"])

    def test_empty_snapshot_has_unavailable_complete_rates(self):
        summary = json.loads(build_reports(*pipeline([]))["summary.json"])
        rate = summary["aggregates"]["delay_rate"]
        self.assertIsNone(rate["value"])
        self.assertEqual(("COMPLETE", "ZERO_DENOMINATOR", 0), (rate["evidence_quality"], rate["reason"], rate["denominator"]))

    def test_orphans_and_only_excluded_events_are_visible(self):
        events = history()
        for data, reason in ((events[1:], "ORDER_NOT_CREATED"), ([events[0], conflict(events[0])], "NO_ACCEPTED_HISTORY")):
            with self.subTest(reason=reason):
                reports = build_reports(*pipeline(data))
                summary = json.loads(reports["summary.json"])
                self.assertEqual({}, summary["orders"])
                self.assertEqual(reason, summary["excluded_histories"][0]["reason"])
                self.assertIn(reason.replace("_", "\\_"), reports["report.md"])

    def test_markdown_values_sources_and_no_automatic_blame(self):
        report = build_reports(*pipeline())["report.md"]
        for text in ("ord-1001", "ord-1002", "ord-1003", "DELIVERED", "CANCELLED", "1/2", "1/3",
                     "13 minutes", "evt-004", "evt-020", "data.promised", "2026-10-29T19:05:00-03:00"):
            self.assertIn(text, report)
        self.assertIn("não é atribuída responsabilidade", report)

    def test_markdown_escapes_untrusted_ids_and_omits_payload_secrets(self):
        events = history("<script>|\n[click](https://bad.example)")
        events[0]["data"]["secret"] = "NEVER_EXPORT_PAYLOAD"
        reports = build_reports(*pipeline(events))
        self.assertNotIn("<script>", reports["report.md"])
        self.assertNotIn("[click](https://bad.example)", reports["report.md"])
        self.assertIn("&lt;script&gt;", reports["report.md"])
        for report in reports.values():
            self.assertNotIn("NEVER_EXPORT_PAYLOAD", report)

    def test_unicode_surrogate_ids_can_be_rendered(self):
        reports = build_reports(*pipeline(history("id\ud800")))
        for text in reports.values():
            text.encode("utf-8")
        self.assertIn("id\ud800", json.loads(reports["summary.json"])["orders"])

    def test_deterministic_render_and_semantic_shuffle(self):
        events = history()
        baseline = build_reports(*pipeline(events))
        self.assertEqual(baseline, build_reports(*pipeline(events)))
        for seed in range(5):
            shuffled = deepcopy(events)
            random.Random(seed).shuffle(shuffled)
            current = build_reports(*pipeline(shuffled))
            self.assertEqual(baseline["summary.json"], current["summary.json"])
            self.assertEqual(baseline["report.md"], current["report.md"])
            self.assertNotEqual(baseline["errors.json"], current["errors.json"])

    def test_inputs_are_not_mutated_or_aliased(self):
        inputs = pipeline()
        before = deepcopy(inputs)
        reports = build_reports(*inputs)
        self.assertEqual(before, inputs)
        reports.clear()
        self.assertEqual(before, inputs)


class ReportPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "events.jsonl"
        self.source.write_bytes(FIXTURE.read_bytes())
        self.output = self.root / "out"
        self.reports = build_reports(*pipeline())

    def publish(self):
        write_reports(self.reports, self.output, input_path=self.source)

    def test_three_files_deterministic_bytes_and_original_preserved(self):
        before = self.source.read_bytes()
        self.publish()
        first = {name: (self.output / name).read_bytes() for name in REPORT_NAMES}
        self.publish()
        self.assertEqual(first, {name: (self.output / name).read_bytes() for name in REPORT_NAMES})
        self.assertEqual(before, self.source.read_bytes())
        self.assertEqual(set(REPORT_NAMES), {p.name for p in self.output.iterdir()})
        self.assertTrue(all(b"\r\n" not in content for content in first.values()))

    def test_input_output_collision_is_rejected(self):
        self.output.mkdir()
        self.source = self.output / "summary.json"
        self.source.write_text("original", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual("original", self.source.read_text(encoding="utf-8"))

    def test_hardlink_to_input_is_rejected(self):
        self.output.mkdir()
        try:
            os.link(self.source, self.output / "report.md")
        except OSError as error:
            self.skipTest(str(error))
        before = self.source.read_bytes()
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(before, self.source.read_bytes())

    def test_output_directory_cannot_be_file(self):
        self.output.write_text("existing", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual("existing", self.output.read_text(encoding="utf-8"))

    def test_target_directory_rejected_before_writing(self):
        (self.output / "errors.json").mkdir(parents=True)
        with self.assertRaises(ValueError):
            self.publish()
        self.assertFalse((self.output / "summary.json").exists())

    def test_staging_failure_preserves_existing_bundle(self):
        self.publish()
        old = {name: (self.output / name).read_bytes() for name in REPORT_NAMES}
        with patch("rescueos.reporting.os.fsync", side_effect=OSError("simulated disk full")):
            with self.assertRaises(OSError):
                self.publish()
        self.assertEqual(old, {name: (self.output / name).read_bytes() for name in REPORT_NAMES})
        self.assertEqual(set(REPORT_NAMES), {p.name for p in self.output.iterdir()})

    def test_replace_failure_rolls_back_existing_outputs(self):
        self.publish()
        old = {name: (self.output / name).read_bytes() for name in REPORT_NAMES}
        self.reports = {name: "new" for name in REPORT_NAMES}
        real_replace = os.replace
        calls = 0

        def fail_second(source, destination):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("simulated replacement failure")
            return real_replace(source, destination)

        with patch("rescueos.reporting.os.replace", side_effect=fail_second):
            with self.assertRaisesRegex(OSError, "destinos anteriores preservados"):
                self.publish()
        self.assertEqual(old, {name: (self.output / name).read_bytes() for name in REPORT_NAMES})
        self.assertEqual(set(REPORT_NAMES), {p.name for p in self.output.iterdir()})

    def test_replace_failure_removes_only_new_outputs(self):
        real_replace = os.replace

        def fail_report(source, destination):
            if Path(destination).name == "report.md":
                raise OSError("simulated replacement failure")
            return real_replace(source, destination)

        with patch("rescueos.reporting.os.replace", side_effect=fail_report):
            with self.assertRaises(OSError):
                self.publish()
        self.assertEqual([], list(self.output.iterdir()))

    def test_writer_rejects_arbitrary_names(self):
        self.reports["../other"] = "text"
        with self.assertRaises(ValueError):
            self.publish()
        self.assertFalse(self.output.exists())

    def test_failure_after_one_staged_file_leaves_no_new_reports(self):
        from rescueos.reporting import _stage
        calls = 0

        def fail_second(directory, content):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("simulated disk full after first stage")
            return _stage(directory, content)

        with patch("rescueos.reporting._stage", side_effect=fail_second):
            with self.assertRaises(OSError):
                self.publish()
        self.assertEqual([], list(self.output.iterdir()))

    def test_rollback_failure_preserves_recovery_backup(self):
        self.publish()
        original = (self.output / "summary.json").read_bytes()
        self.reports = {name: "new" for name in REPORT_NAMES}
        real_replace = os.replace
        calls = 0

        def fail_after_first(source, destination):
            nonlocal calls
            calls += 1
            if calls > 1:
                raise OSError("simulated ongoing filesystem failure")
            return real_replace(source, destination)

        with patch("rescueos.reporting.os.replace", side_effect=fail_after_first):
            with self.assertRaisesRegex(OSError, "restauração incompleta"):
                self.publish()
        backups = list(self.output.glob(".rescueos-*.tmp"))
        self.assertEqual(1, len(backups))
        self.assertEqual(original, backups[0].read_bytes())

    def test_symbolic_destination_is_rejected(self):
        self.output.mkdir()
        other = self.root / "other.txt"
        other.write_text("keep", encoding="utf-8")
        try:
            (self.output / "report.md").symlink_to(other)
        except OSError as error:
            self.skipTest(str(error))
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual("keep", other.read_text(encoding="utf-8"))

    def test_symbolic_destination_guard_without_windows_privileges(self):
        real_is_symlink = Path.is_symlink

        def symbolic_target(path):
            return path.name == "report.md" or real_is_symlink(path)

        with patch.object(Path, "is_symlink", symbolic_target):
            with self.assertRaises(ValueError):
                self.publish()
        self.assertFalse(self.output.exists())

    def test_rollback_and_cleanup_failures_do_not_mask_publication_error(self):
        self.publish()
        old = {name: (self.output / name).read_bytes() for name in REPORT_NAMES}
        self.reports = {name: "new" for name in REPORT_NAMES}
        real_replace, real_unlink = os.replace, Path.unlink
        replacements = 0

        def fail_publish_and_rollback(source, destination):
            nonlocal replacements
            replacements += 1
            if replacements == 2:
                raise PermissionError("primary publication failure")
            if replacements > 2:
                raise PermissionError("secondary rollback failure")
            return real_replace(source, destination)

        def fail_cleanup(path, *args, **kwargs):
            if path.suffix == ".tmp" and path.exists():
                raise PermissionError("secondary cleanup failure")
            return real_unlink(path, *args, **kwargs)

        with patch("rescueos.reporting.os.replace", side_effect=fail_publish_and_rollback):
            with patch.object(Path, "unlink", fail_cleanup):
                with self.assertRaises(OSError) as caught:
                    self.publish()
        message = str(caught.exception)
        self.assertIn("primary publication failure", message)
        self.assertIn("restauração incompleta", message)
        self.assertIn("secondary rollback failure", message)
        self.assertIn("secondary cleanup failure", message)
        self.assertIsInstance(caught.exception.__cause__, PermissionError)
        self.assertEqual("primary publication failure", str(caught.exception.__cause__))
        self.assertIsInstance(caught.exception, ReportWriteError)
        self.assertFalse(caught.exception.publication_completed)
        self.assertEqual("summary.json", caught.exception.rollback_errors[0][0])
        self.assertEqual(4, len(caught.exception.cleanup_errors))
        self.assertEqual(1, len(caught.exception.recovery_backups))
        backups = [p for p in self.output.glob(".rescueos-*.tmp") if p.read_bytes() == old["summary.json"]]
        self.assertEqual(1, len(backups))
        self.assertIn(str(backups[0].resolve()), message)
        self.assertEqual(old["report.md"], (self.output / "report.md").read_bytes())
        self.assertEqual(old["errors.json"], (self.output / "errors.json").read_bytes())
        self.assertEqual(b"new", (self.output / "summary.json").read_bytes())

    def test_staging_cleanup_failure_preserves_original_cause(self):
        self.publish()
        old = {name: (self.output / name).read_bytes() for name in REPORT_NAMES}
        real_unlink = Path.unlink
        primary = PermissionError("primary staging failure")

        def fail_cleanup(path, *args, **kwargs):
            if path.suffix == ".tmp" and path.exists():
                raise PermissionError("secondary staging cleanup failure")
            return real_unlink(path, *args, **kwargs)

        with patch("rescueos.reporting.os.fsync", side_effect=primary), patch.object(Path, "unlink", fail_cleanup):
            with self.assertRaises(ReportWriteError) as caught:
                self.publish()
        error = caught.exception
        self.assertIs(primary, error.original_error)
        self.assertIs(primary, error.__cause__)
        self.assertIn("primary staging failure", str(error))
        self.assertIn("secondary staging cleanup failure", str(error))
        self.assertEqual(1, len(error.cleanup_errors))
        self.assertTrue(error.cleanup_errors[0][0].exists())
        self.assertEqual(old, {name: (self.output / name).read_bytes() for name in REPORT_NAMES})

    def test_successful_rollback_keeps_primary_error_and_continues_cleanup(self):
        self.publish()
        old = {name: (self.output / name).read_bytes() for name in REPORT_NAMES}
        real_replace, real_unlink = os.replace, Path.unlink
        primary = PermissionError("primary replacement failure")
        calls = 0
        cleanup_denied = []

        def fail_second(source, destination):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise primary
            return real_replace(source, destination)

        def fail_first_cleanup(path, *args, **kwargs):
            if path.suffix == ".tmp" and path.exists() and not cleanup_denied:
                cleanup_denied.append(path)
                raise PermissionError("one cleanup denied")
            return real_unlink(path, *args, **kwargs)

        with patch("rescueos.reporting.os.replace", side_effect=fail_second), patch.object(Path, "unlink", fail_first_cleanup):
            with self.assertRaises(ReportWriteError) as caught:
                self.publish()
        error = caught.exception
        self.assertIs(primary, error.__cause__)
        self.assertEqual((), error.rollback_errors)
        self.assertEqual(1, len(error.cleanup_errors))
        self.assertIn("destinos anteriores preservados", str(error))
        self.assertIn("primary replacement failure", str(error))
        self.assertEqual(old, {name: (self.output / name).read_bytes() for name in REPORT_NAMES})
        self.assertEqual([p.resolve() for p in cleanup_denied],
                         [p.resolve() for p in self.output.glob(".rescueos-*.tmp")])

    def test_cleanup_only_failure_distinguishes_completed_publication(self):
        self.publish()
        self.reports = {name: "new" for name in REPORT_NAMES}
        real_unlink = Path.unlink

        def deny_backup_cleanup(path, *args, **kwargs):
            if path.suffix == ".tmp" and path.exists():
                raise PermissionError("backup cleanup denied")
            return real_unlink(path, *args, **kwargs)

        with patch.object(Path, "unlink", deny_backup_cleanup):
            with self.assertRaises(ReportWriteError) as caught:
                self.publish()
        error = caught.exception
        self.assertTrue(error.publication_completed)
        self.assertIsNone(error.original_error)
        self.assertEqual((), error.rollback_errors)
        self.assertEqual(3, len(error.cleanup_errors))
        self.assertNotIn("destinos anteriores preservados", str(error))
        self.assertEqual({name: b"new" for name in REPORT_NAMES},
                         {name: (self.output / name).read_bytes() for name in REPORT_NAMES})


if __name__ == "__main__":
    unittest.main()
