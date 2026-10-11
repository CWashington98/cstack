"""Runs the sample's tests. Given a name, runs only the tests whose description contains it.

Exit codes follow the common convention: 0 when every test passed, 1 when a
test failed, 2 when a test file could not be loaded, 5 when no test matched.
"""
import sys
import unittest


def each_test(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from each_test(item)
        else:
            yield item


loader = unittest.TestLoader()
suite = loader.discover("tests", pattern="test_*.py", top_level_dir=".")
if loader.errors:
    for error in loader.errors:
        print(error, file=sys.stderr)
    sys.exit(2)

name = sys.argv[1] if len(sys.argv) > 1 else ""
picked = [t for t in each_test(suite) if name in (t.shortDescription() or t.id())]
if not picked:
    print(f"No test matches {name!r}.", file=sys.stderr)
    sys.exit(5)

result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(picked))
sys.exit(0 if result.wasSuccessful() else 1)
