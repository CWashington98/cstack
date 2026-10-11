"""Orders and their totals."""


def order_total(items):
    return sum(item["price"] * item["quantity"] for item in items)
