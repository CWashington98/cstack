# Sample repositories for the spec compliance check

Two small projects the compliance check's tests run it on. They use different test runners, so the check is proved to work from a project's settings file alone.

| Sample | Test runner | Run one scenario's tests |
|---|---|---|
| `typescript/` | Node's built-in test runner, on TypeScript files | `--test-name-pattern`, which reads the name as a pattern, so the bracket is escaped |
| `python/` | `tests/run.py`, a short runner over Python's standard `unittest` | the name as the first argument, matched as plain text |

Neither needs anything installed beyond Node and Python 3.

Each sample is built into a throwaway repository one commit at a time:

1. `starting/` is the project before the change. Its code has stubs that give wrong answers, so the new tests fail by an assertion.
2. `change/1-spec/` adds the approved spec, its task list and `approval.json`. The fingerprint there is the spec file's sha256 hash.
3. `change/2-acceptance/` adds the tests, one per scenario. This commit is the one that locks them.
4. `change/3-build/` replaces the stubs with code that makes the tests pass.
