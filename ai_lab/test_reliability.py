import asyncio
import tempfile
import unittest
from pathlib import Path

from reliability import CASES, evaluate_all, write_report


class ReliabilityBenchmarkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = asyncio.run(evaluate_all())

    def test_all_expected_outcomes(self):
        failures = [x for x in self.result['cases'] if not x['passed']]
        self.assertEqual([], failures)

    def test_contains_true_and_adversarial_cases(self):
        expected = [r['expected'] for r in self.result['cases']]
        self.assertGreaterEqual(expected.count('completed'), 4)
        self.assertGreaterEqual(len(expected) - expected.count('completed'), 10)
        self.assertEqual(len(CASES), self.result['counts']['total'])

    def test_attack_rejections_are_not_claimed_as_model_quality(self):
        self.assertEqual('offline-stub-no-llm', self.result['mode'])
        self.assertEqual(self.result['counts']['adversarial_total'], self.result['counts']['rejected_adversarial'])
        with tempfile.TemporaryDirectory() as d:
            write_report(self.result, Path(d))
            report = (Path(d) / 'reliability-report.md').read_text(encoding='utf-8')
            self.assertIn('Não mede a acurácia de um LLM real', report)
            self.assertIn('não são latência real de LLM', report)

    def test_reproducible_case_outcomes(self):
        again = asyncio.run(evaluate_all())
        self.assertEqual([(r['id'], r['observed']) for r in self.result['cases']],
                         [(r['id'], r['observed']) for r in again['cases']])


if __name__ == '__main__':
    unittest.main()
