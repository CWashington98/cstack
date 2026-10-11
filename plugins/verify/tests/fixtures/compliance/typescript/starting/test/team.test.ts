import { test } from "node:test";
import assert from "node:assert/strict";
import { teamName } from "../src/team.ts";

test("[team-name-shown] a team's name is shown without extra spaces", () => {
  assert.equal(teamName({ name: "  Blue  ", used: 0, limit: 3 }), "Blue");
});
