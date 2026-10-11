import type { Team } from "./team.ts";

export function addSeat(team: Team): Team & { refused?: boolean } {
  if (team.used >= team.limit) return { ...team, refused: true };
  return { ...team, used: team.used + 1 };
}

export function seatsLeft(team: Team): number {
  return team.limit - team.used;
}
