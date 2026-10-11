import { test } from "node:test";
import assert from "node:assert/strict";
import { addSeat, seatsLeft } from "../../src/seats.ts";

test("[seat-added-under-limit] a team under its limit gets the seat", () => {
  assert.equal(addSeat({ name: "Blue", used: 2, limit: 3 }).used, 3);
});

test("[seat-refused-at-limit] a team at its limit is refused the seat", () => {
  const after = addSeat({ name: "Blue", used: 3, limit: 3 });
  assert.equal(after.refused, true);
  assert.equal(after.used, 3);
});

test("[seats-left-shown] a team sees how many seats it has left", () => {
  assert.equal(seatsLeft({ name: "Blue", used: 1, limit: 3 }), 2);
});
