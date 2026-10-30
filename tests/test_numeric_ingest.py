"""Regressões da Code Review #001, sem alterar fixtures."""

import json
import unittest

from rescueos.ingest import ingest_lines
from tests.test_ingest import event


def numeric_line(token, **changes):
    return json.dumps(event(**changes))[:-1] + ', "extra": ' + token + '}'


class NumericRegressionTests(unittest.TestCase):
    def test_extreme_positive_exponent_continues(self):
        result = ingest_lines([numeric_line('0e99999999999999999999'), json.dumps(event(event_id='evt-next'))])
        self.assertEqual(['evt-next'], [e['event_id'] for e in result.events])
        self.assertEqual('INVALID_NUMBER', result.errors[0].code)
        self.assertEqual('evt-example', result.errors[0].event_id)

    def test_extreme_negative_exponent_continues(self):
        result = ingest_lines([numeric_line('1e-99999999999999999999'), json.dumps(event(event_id='evt-next'))])
        self.assertEqual(['evt-next'], [e['event_id'] for e in result.events])
        self.assertEqual('INVALID_NUMBER', result.errors[0].code)

    def test_overflow_variant_conflicts_in_both_orders(self):
        valid, invalid = json.dumps(event()), numeric_line('1e999', order_id='ord-other', type='DELIVERED', data={})
        for lines in ([valid, invalid], [invalid, valid]):
            with self.subTest(lines=lines):
                result = ingest_lines(lines, source='regression.jsonl')
                self.assertEqual((), result.events)
                conflict, = [e for e in result.errors if e.code == 'EVENT_ID_CONFLICT']
                self.assertEqual(lines, [o.raw for o in conflict.origins])
                self.assertEqual([1, 2], [o.line for o in conflict.origins])
                self.assertEqual(('ord-example', 'ord-other'), conflict.affected_order_ids)
                self.assertEqual(('DELIVERED', 'ORDER_CREATED'), conflict.affected_event_types)
                self.assertEqual(2, len(result.origins_by_id['evt-example']))

    def test_overflow_without_conflict_has_numeric_diagnostic_and_continues(self):
        result = ingest_lines([numeric_line('1e999'), json.dumps(event(event_id='evt-next'))])
        self.assertEqual(['evt-next'], [e['event_id'] for e in result.events])
        self.assertEqual(['INVALID_NUMBER'], [e.code for e in result.errors])
        self.assertEqual('evt-example', result.errors[0].event_id)


class NumericPolicyTests(unittest.TestCase):
    def test_int64_boundaries(self):
        for token in ['-9223372036854775808', '9223372036854775807']:
            with self.subTest(token=token):
                result = ingest_lines([numeric_line(token)])
                self.assertEqual([], result.errors)
                self.assertEqual(int(token), result.events[0]['extra'])

    def test_int64_overflow_and_very_long_integer_continue(self):
        for token in ['-9223372036854775809', '9223372036854775808', '9' * 5000]:
            with self.subTest(length=len(token)):
                result = ingest_lines([numeric_line(token), json.dumps(event(event_id='evt-next'))])
                self.assertEqual(['evt-next'], [e['event_id'] for e in result.events])
                self.assertEqual('INVALID_NUMBER', result.errors[0].code)

    def test_float_boundaries_and_zero(self):
        for token in ['1e308', '1e-308', '0e308', '-0.0', '1.2345', '0.' + '1' * 99]:
            with self.subTest(token=token):
                result = ingest_lines([numeric_line(token)])
                self.assertEqual([], result.errors)
                self.assertIs(type(result.events[0]['extra']), float)

    def test_float_range_coefficient_and_underflow(self):
        for token in ['9e308', '1e309', '1e-309', '0e-309',
                      '0.' + '1' * 100, '0.' + '0' * 98 + '1e-308']:
            with self.subTest(token=token):
                result = ingest_lines([numeric_line(token)])
                self.assertEqual((), result.events)
                self.assertEqual(['INVALID_NUMBER'], [e.code for e in result.errors])

    def test_literal_length_boundary(self):
        for length in [128, 129]:
            token = '1e+' + '0' * (length - 4) + '1'
            with self.subTest(length=length):
                result = ingest_lines([numeric_line(token)])
                self.assertEqual(length == 128, bool(result.events))
                self.assertEqual(length == 129, bool(result.errors))

    def test_nested_invalid_numbers_keep_paths_and_origins(self):
        raw = numeric_line('1e999').replace('"extra": 1e999', '"extra": {"values": [1e999, 0e99999999999999999999]}')
        result = ingest_lines([raw], source='numbers.jsonl')
        self.assertEqual(2, len(result.errors))
        for index, error in enumerate(result.errors):
            self.assertEqual('INVALID_NUMBER', error.code)
            self.assertIn(f'$.extra.values[{index}]', error.message)
            self.assertEqual('evt-example', error.event_id)
            self.assertEqual(raw, error.origins[0].raw)
            self.assertEqual('numbers.jsonl', error.origins[0].source)

    def test_extreme_exponents_conflict_in_both_orders(self):
        for token in ['0e99999999999999999999', '1e-99999999999999999999']:
            valid, invalid = json.dumps(event()), numeric_line(token)
            for lines in ([valid, invalid], [invalid, valid]):
                with self.subTest(token=token, invalid_first=lines[0] == invalid):
                    result = ingest_lines(lines)
                    self.assertEqual((), result.events)
                    conflict, = [e for e in result.errors if e.code == 'EVENT_ID_CONFLICT']
                    self.assertEqual(lines, [o.raw for o in conflict.origins])

    def test_invalid_variants_and_repeats_preserve_all_evidence(self):
        lines = [numeric_line('1e999'), numeric_line('1e998'), numeric_line('1e999')]
        result = ingest_lines(lines)
        self.assertEqual((), result.events)
        conflict, = [e for e in result.errors if e.code == 'EVENT_ID_CONFLICT']
        self.assertEqual(lines, [o.raw for o in conflict.origins])
        self.assertEqual([], result.duplicates)

    def test_identical_invalid_numbers_reject_without_conflict(self):
        raw = numeric_line('1e999')
        result = ingest_lines([raw, raw])
        self.assertEqual((), result.events)
        self.assertEqual(['INVALID_NUMBER', 'INVALID_NUMBER'], [e.code for e in result.errors])
        self.assertEqual(2, len(result.origins_by_id['evt-example']))

    def test_malformed_json_and_duplicate_keys_do_not_supply_trusted_ids(self):
        valid = json.dumps(event())
        for bad in [valid[:-1] + ',"extra":1e}',
                    valid[:-1] + ',"extra":NaN}',
                    valid[:-1] + ',"event_id":"evt-example"}']:
            with self.subTest(bad=bad):
                result = ingest_lines([bad, valid])
                self.assertEqual((event(),), result.events)
                self.assertEqual(['INVALID_JSON'], [e.code for e in result.errors])
                self.assertIsNone(result.errors[0].event_id)
                self.assertEqual(1, len(result.origins_by_id['evt-example']))

    def test_numeric_id_cannot_be_used_as_string_id(self):
        raw = numeric_line('1e999', event_id=123)
        result = ingest_lines([raw])
        self.assertEqual((), result.events)
        self.assertIsNone(result.errors[0].event_id)
        self.assertEqual({}, result.origins_by_id)

    def test_numeric_policy_does_not_depend_on_decimal_context(self):
        from decimal import InvalidOperation, localcontext
        for trap in [True, False]:
            with self.subTest(trap=trap), localcontext() as context:
                context.prec = 2
                context.traps[InvalidOperation] = trap
                result = ingest_lines([numeric_line('0e99999999999999999999'), numeric_line('1.2345', event_id='evt-next')])
                self.assertEqual(['evt-next'], [e['event_id'] for e in result.events])
                self.assertEqual(['INVALID_NUMBER'], [e.code for e in result.errors])


if __name__ == '__main__':
    unittest.main()
