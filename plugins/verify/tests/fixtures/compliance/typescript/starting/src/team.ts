export type Team = { name: string; used: number; limit: number };

export function teamName(team: Team): string {
  return team.name.trim();
}
