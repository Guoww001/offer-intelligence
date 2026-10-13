import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import unittest
from unittest.mock import patch
from contextlib import nullcontext
import offer_db

class MerchantMonthlyTests(unittest.TestCase):
    def test_monthly_sql_preserves_missing_and_null_without_global_change(self):
        columns = {'advert_id', 'order_time_day', 'amount'}
        captured = []
        def fetch(conn, sql, params):
            captured.append(sql)
            return [{'month': '202610', 'revenue': None, 'orders': 0, 'payout': None, 'clicks': None}]
        with patch.object(offer_db, 'table_columns', return_value=columns), patch.object(offer_db, 'fetch_all', side_effect=fetch):
            row = offer_db.merchant_aggregate_metrics(None, '1')[0]
        self.assertIsNone(row['revenue'])
        self.assertEqual(row['orders'], 0)
        self.assertIn('NULL AS `payout`', captured[0])
        self.assertIn('SUM(`a`.`amount`)', captured[0])
        self.assertEqual(offer_db.sum_expr('a', set(), ['amount'], 'revenue'), '0 AS `revenue`')

    def test_amazon_click_fallback_and_missing_ratios(self):
        columns = {'advert_id', 'order_time_day', 'time_day', 'total_clicks', 'click'}
        rows = [[{'month': '202610', 'clicks': 0, 'orders': None, 'revenue': None, 'affiliatePayout': None, 'payout': None}], [{'month': '202610', 'rawClicks': 5697}]]
        with patch.object(offer_db, 'table_columns', return_value=columns), patch.object(offer_db, 'fetch_all', side_effect=rows):
            row = offer_db.merchant_amazon_metrics(None, '1')[0]
        self.assertEqual(row['clicks'], 5697)
        for key in ['orders', 'epc', 'affEpc', 'allEpc', 'aov', 'conversionRate']:
            self.assertIsNone(row[key], key)

    def test_click_only_real_zero_remains_available(self):
        with patch.object(offer_db, 'table_columns', side_effect=[set(), {'advert_id', 'time_day', 'click'}]), patch.object(offer_db, 'fetch_all', return_value=[{'month': '202610', 'rawClicks': 0}]):
            row = offer_db.merchant_amazon_metrics(None, '1')[0]
        self.assertEqual(row.get('clicks'), 0)
        self.assertIsNone(row['conversionRate'])

    def test_real_zero_numerator_is_preserved(self):
        with patch.object(offer_db, 'table_columns', side_effect=[{'advert_id', 'order_time_day'}, set()]), patch.object(offer_db, 'fetch_all', return_value=[{'month': '202610', 'clicks': 100, 'orders': 0, 'revenue': 0, 'affiliatePayout': 0, 'payout': 0}]):
            row = offer_db.merchant_amazon_metrics(None, '1')[0]
        self.assertEqual(row['epc'], 0)
        self.assertEqual(row['conversionRate'], 0)
        self.assertIsNone(row['aov'])

    def test_minimal_and_full_return_same_monthly_sources(self):
        offer_db._merchant_cache.clear()
        amazon = [{'month': '2026-10', 'clicks': 5697}]
        aggregate = [{'month': '2026-10', 'revenue': 100}]
        with patch.object(offer_db, 'db_connection', return_value=nullcontext(None)), patch.object(offer_db, 'merchant_amazon_metrics', return_value=amazon), patch.object(offer_db, 'merchant_aggregate_metrics', return_value=aggregate), patch.object(offer_db, 'merchant_base', return_value={}) as base, patch.object(offer_db, 'merchant_products', return_value=[]) as products:
            minimal = offer_db.merchant_payload('1', minimal=True)
            base.assert_not_called()
            products.assert_not_called()
            full = offer_db.merchant_payload('1')
        for key in ['monthlyAmazonMetrics', 'monthlyAggregateMetrics']:
            self.assertEqual(minimal[key], full[key])

if __name__ == '__main__':
    unittest.main()
