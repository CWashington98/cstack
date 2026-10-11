import unittest

from exporter import to_csv


class ExportTests(unittest.TestCase):
    def test_header_row(self):
        """[export-has-header-row] the first line names the columns, then one line per order"""
        lines = to_csv([{"name": "Ada", "total": 3}, {"name": "Grace", "total": 5}]).splitlines()
        self.assertEqual(lines[:1], ["name,total"])
        self.assertEqual(len(lines), 3)

    def test_empty_refused(self):
        """[export-empty-refused] an export with no orders is refused"""
        with self.assertRaises(ValueError) as refused:
            to_csv([])
        self.assertIn("nothing to export", str(refused.exception))
