import type { Team } from "./team.ts";

export function addSeat(team: Team): Team & { refused?: boolean } {
  return team;
}

export function seatsLeft(team: Team): number {
  return 0;
}
