# The proof standard

These ten rules apply to every check, by every agent, and to every "Proof it works" section in a pull request. A check that breaks one of them is not evidence.

## 1. Drive the real user path

Do what a user does: press the button, fill the field, open the screen. Inspect state afterwards if you need to, but never fake the action with internal setters or test-only endpoints. Use mocks only where a production boundary already keeps the outside system apart, such as a payment provider's test mode.

## 2. Show the trigger and the end state together

Capture the action and its result in the same recording, or in a pair of screenshots taken before and after. A final screen alone proves nothing about what caused it.

## 3. Read back side effects

Check what the action changed behind the screen: the row written, the file stored, the message sent. A drive that changes data with nothing read back is incomplete.

## 4. Wait for the real end state

Wait for the thing you expect to see, never for a fixed number of seconds. A fixed pause is either too short, so the check fails at random, or too long, so it hides slowness.

## 5. Run the health check first

Before any evidence, confirm the running copy is the one you mean to test: the right build for the current commit, the right port, signed in. Evidence from a stale build, the wrong port or another checkout's server isn't evidence. Run the health check again after anything surprising.

## 6. Test properties, not exact values

A test that checks fixed text stays true when the feature is broken. "The audio address equals this text" passed while every audio request failed. "Requesting what the page plays returns the stored file's bytes" proves the feature.

## 7. Ask what would make the test fail

For every test, name the change to the product that would make it fail. If the only answer is "changing this text", or the test would still pass if every function returned nothing, rewrite the test or delete it.

## 8. Break it to prove it

Before trusting a new test, change the code so the test should fail, and watch it fail. Then put the code back. A test you never saw fail has not shown it can catch anything.

## 9. A runner must prove it ran everything

A test runner reports how many checks it ran against how many exist, and fails when the two differ. An empty run is a failure, not a pass. A harness once reported success after running 2 of 5 scenarios.

## 10. Never put personal data in evidence

No patient or customer data in screenshots, recordings, logs or pull request text. Use IDs and counts, and fake fixtures.

## Where evidence goes

Each app's verification skill names its evidence folder. By default it is `.verify/runs/<app>/`, which is kept out of git. The plugin's `scripts/evidence.mjs` records each step of a run, so a reviewer can check what was driven, what was read back and which commit it ran on. Clean-up stops only what the run started, and never deletes evidence.
