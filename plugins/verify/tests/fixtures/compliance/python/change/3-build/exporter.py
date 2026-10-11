"""Turns orders into a file people can open in a spreadsheet."""


def to_csv(orders):
    if not orders:
        raise ValueError("There is nothing to export.")
    lines = ["name,total"] + [f"{order['name']},{order['total']}" for order in orders]
    return "\n".join(lines) + "\n"
