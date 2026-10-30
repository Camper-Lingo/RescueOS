from contextlib import redirect_stderr, redirect_stdout
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from rescueos.__main__ import main
from tests.test_metrics import history

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "demo_events.jsonl"


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "events.jsonl"
        self.source.write_bytes(FIXTURE.read_bytes())
        self.output = self.root / "output with spaces"

    def invoke(self, *args):
        return subprocess.run([sys.executable, "-B", "-m", "rescueos", *map(str, args)], cwd=ROOT,
                              capture_output=True, encoding="utf-8", errors="replace", timeout=20)

    def command(self):
        return self.invoke("--input", self.source, "--output-dir", self.output)

    def test_full_cli_fixture_and_repeated_execution(self):
        before = self.source.read_bytes()
        result = self.command()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("3 pedidos", result.stdout)
        summary = json.loads((self.output / "summary.json").read_text(encoding="utf-8"))
        self.assertEqual(3, summary["aggregates"]["total_created"]["value"])
        self.assertEqual(2, summary["aggregates"]["total_delivered"]["value"])
        self.assertEqual(1, summary["aggregates"]["total_cancelled"]["value"])
        first = {p.name: p.read_bytes() for p in self.output.iterdir()}
        self.assertEqual(0, self.command().returncode)
        self.assertEqual(first, {p.name: p.read_bytes() for p in self.output.iterdir()})
        self.assertEqual(before, self.source.read_bytes())

    def test_help(self):
        result = self.invoke("--help")
        self.assertEqual(0, result.returncode)
        self.assertIn("--input", result.stdout)
        self.assertIn("--output-dir", result.stdout)
        self.assertIn("relatórios", result.stdout)

    def test_missing_required_arguments(self):
        self.assertEqual(2, self.invoke().returncode)
        self.assertFalse(self.output.exists())

    def test_unknown_option(self):
        self.assertEqual(2, self.invoke("--unknown").returncode)

    def test_missing_input_file(self):
        self.source = self.root / "missing.jsonl"
        result = self.command()
        self.assertEqual(1, result.returncode)
        self.assertIn("RescueOS", result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertFalse(self.output.exists())

    def test_input_directory_is_invalid_parameter(self):
        self.source = self.root
        result = self.command()
        self.assertEqual(2, result.returncode)
        self.assertFalse(self.output.exists())

    def test_output_path_is_file(self):
        self.output.write_text("preserve", encoding="utf-8")
        result = self.command()
        self.assertEqual(2, result.returncode)
        self.assertNotIn("Traceback", result.stderr)
        self.assertEqual("preserve", self.output.read_text(encoding="utf-8"))

    def test_input_cannot_be_overwritten_by_report(self):
        self.output.mkdir()
        self.source = self.output / "errors.json"
        self.source.write_bytes(FIXTURE.read_bytes())
        before = self.source.read_bytes()
        self.assertEqual(2, self.command().returncode)
        self.assertEqual(before, self.source.read_bytes())

    def test_invalid_lines_are_nonfatal_and_diagnosed(self):
        self.source.write_text("not JSON\n" + FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
        result = self.command()
        self.assertEqual(0, result.returncode, result.stderr)
        errors = json.loads((self.output / "errors.json").read_text(encoding="utf-8"))
        self.assertEqual("INVALID_JSON", errors["diagnostics"][0]["code"])

    def test_all_invalid_input_still_publishes_diagnostics(self):
        self.source.write_text("not JSON\n", encoding="utf-8")
        self.assertEqual(0, self.command().returncode)
        summary = json.loads((self.output / "summary.json").read_text(encoding="utf-8"))
        self.assertEqual(0, summary["order_count"])
        self.assertIsNone(summary["aggregates"]["delay_rate"]["value"])

    def test_conflicting_data_is_nonfatal_with_partial_indicators(self):
        events = history()
        variant = dict(events[-1], occurred_at="2026-10-29T18:07:00-03:00")
        self.source.write_text("\n".join(json.dumps(e) for e in events + [variant]), encoding="utf-8")
        self.assertEqual(0, self.command().returncode)
        summary = json.loads((self.output / "summary.json").read_text(encoding="utf-8"))
        self.assertEqual("PARTIAL", summary["aggregates"]["delay_rate"]["evidence_quality"])

    def test_write_failure_returns_one_without_traceback(self):
        stderr = io.StringIO()
        with patch("rescueos.__main__.write_reports", side_effect=OSError("simulated permission denied")):
            with redirect_stderr(stderr), redirect_stdout(io.StringIO()):
                code = main(["--input", str(self.source), "--output-dir", str(self.output)])
        self.assertEqual(1, code)
        self.assertIn("simulated permission denied", stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())

    def test_closed_stdout_subprocess_returns_one_and_preserves_reports(self):
        result = self.command()
        self.assertEqual(0, result.returncode, result.stderr)
        previous = {p.name: p.read_bytes() for p in self.output.iterdir()}
        with subprocess.Popen(
                [sys.executable, "-B", "-m", "rescueos", "--input", str(self.source),
                 "--output-dir", str(self.output)], cwd=ROOT,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
            process.stdout.close()
            code = process.wait(timeout=20)
            stderr = process.stderr.read().decode("utf-8", errors="replace")
        self.assertEqual(1, code, stderr)
        self.assertNotIn("Exception ignored", stderr)
        self.assertNotIn("Traceback", stderr)
        self.assertEqual(previous, {p.name: p.read_bytes() for p in self.output.iterdir()})

    def test_stdout_write_errors_return_one(self):
        class FailedOutput(io.StringIO):
            def write(self, text):
                raise failure("stdout write denied")

        for failure in (BrokenPipeError, OSError, ValueError):
            with self.subTest(failure=failure):
                stderr = io.StringIO()
                with redirect_stdout(FailedOutput()), redirect_stderr(stderr):
                    code = main(["--input", str(self.source), "--output-dir", str(self.output)])
                self.assertEqual(1, code)
                self.assertIn("stdout write denied", stderr.getvalue())
                summary = json.loads((self.output / "summary.json").read_text(encoding="utf-8"))
                self.assertEqual(3, summary["order_count"])

    def test_stdout_flush_errors_return_one(self):
        class FailedFlush(io.StringIO):
            def flush(self):
                raise failure("stdout flush denied")

        for failure in (BrokenPipeError, OSError):
            with self.subTest(failure=failure):
                stderr = io.StringIO()
                with redirect_stdout(FailedFlush()), redirect_stderr(stderr):
                    code = main(["--input", str(self.source), "--output-dir", str(self.output)])
                self.assertEqual(1, code)
                self.assertIn("stdout flush denied", stderr.getvalue())
                errors = json.loads((self.output / "errors.json").read_text(encoding="utf-8"))
                self.assertEqual([], errors["diagnostics"])

    def test_publication_error_visible_without_attempting_success_output(self):
        class FailedOutput(io.StringIO):
            writes = 0

            def write(self, text):
                self.writes += 1
                raise BrokenPipeError("stdout is unavailable")

        stdout, stderr = FailedOutput(), io.StringIO()
        with patch("rescueos.__main__.write_reports", side_effect=PermissionError("primary publication failure")):
            with redirect_stdout(stdout), redirect_stderr(stderr):
                code = main(["--input", str(self.source), "--output-dir", str(self.output)])
        self.assertEqual(1, code)
        self.assertIn("primary publication failure", stderr.getvalue())
        self.assertEqual(0, stdout.writes)
        self.assertFalse(self.output.exists())

    def test_closed_stdout_help_returns_one_without_shutdown_error(self):
        with subprocess.Popen([sys.executable, "-B", "-m", "rescueos", "--help"], cwd=ROOT,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
            process.stdout.close()
            code = process.wait(timeout=20)
            stderr = process.stderr.read().decode("utf-8", errors="replace")
        self.assertEqual(1, code, stderr)
        self.assertNotIn("Exception ignored", stderr)
        self.assertFalse(self.output.exists())

    def test_closed_stdout_invalid_arguments_keep_code_two(self):
        with subprocess.Popen([sys.executable, "-B", "-m", "rescueos", "--unknown"], cwd=ROOT,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
            process.stdout.close()
            code = process.wait(timeout=20)
            stderr = process.stderr.read().decode("utf-8", errors="replace")
        self.assertEqual(2, code, stderr)
        self.assertNotIn("Exception ignored", stderr)


if __name__ == "__main__":
    unittest.main()
