import unittest

from orders import order_total


class OrderTests(unittest.TestCase):
    def test_total(self):
        """[order-total-shown] an order's total adds up every item"""
        self.assertEqual(order_total([{"price": 2, "quantity": 3}, {"price": 5, "quantity": 1}]), 11)
