import json
import tempfile
import unittest
from pathlib import Path

from train import NUMERIC, fixed_rule, read_rows, split_by_seed, training_report


class AILabTests(unittest.TestCase):
    def row(self, seed, scenario='medium', late=0):
        return {'schema':'rescueos.delivery_risk.v1', 'seed':seed, 'scenario':scenario,
                'order_id':f'sim-{seed}', 'label_late':late,
                'features':{key:1 for key in NUMERIC}}

    def test_seed_is_never_in_both_splits(self):
        data = [self.row(s, scenario=sc) for s in range(1000,1020) for sc in ('quiet','medium','busy')]
        train, test = split_by_seed(data)
        self.assertFalse({r['seed'] for r in train} & {r['seed'] for r in test})
        self.assertEqual(len(train)+len(test), len(data))

    def test_rejects_future_features(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'invalid.jsonl'
            bad = self.row(1001)
            bad['features']['deliveredAt'] = 50
            p.write_text(json.dumps(bad)+'\n', encoding='utf8')
            with self.assertRaisesRegex(ValueError, 'Feature incorreta'):
                read_rows(p)

    def test_rejects_label_inside_features(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'invalid.jsonl'
            bad = self.row(1001)
            bad['features']['label_late'] = 1
            p.write_text(json.dumps(bad)+'\n', encoding='utf8')
            with self.assertRaisesRegex(ValueError, 'Feature incorreta'):
                read_rows(p)

    def test_pendings_not_labeled_as_on_time(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'valid.jsonl'
            p.write_text(json.dumps(self.row(1001, late=None))+'\n', encoding='utf8')
            data = read_rows(p)
            self.assertIsNone(data[0]['label_late'])

    def test_rule_is_repeatable(self):
        row = self.row(1001)
        self.assertEqual(fixed_rule(row), fixed_rule(row))


if __name__ == '__main__':
    unittest.main()
