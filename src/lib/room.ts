export type Role = "candidate" | "interviewer";

export function otherRole(role: Role): Role {
  return role === "candidate" ? "interviewer" : "candidate";
}

export function parseRole(value: unknown): Role | null {
  return value === "candidate" || value === "interviewer" ? value : null;
}
