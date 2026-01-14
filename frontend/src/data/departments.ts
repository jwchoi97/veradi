// FILE: frontend/src/data/departments.ts

export type Department =
  | "PHYSICS_1"
  | "CHEMISTRY_1"
  | "BIOLOGY_1"
  | "EARTH_1"
  | "CHEMISTRY_2"
  | "SOCIOCULTURE"
  | "MATH"
  | "INTEGRATED_SCIENCE"
  | "INTEGRATED_SOCIAL"
  | "ADMIN"; // keep for compatibility (role-ish), but UI usually filters out

export const DEPARTMENTS: Department[] = [
  "PHYSICS_1",
  "CHEMISTRY_1",
  "BIOLOGY_1",
  "EARTH_1",
  "CHEMISTRY_2",
  "SOCIOCULTURE",
  "MATH",
  "INTEGRATED_SCIENCE",
  "INTEGRATED_SOCIAL",
];

export const DEPARTMENT_LABEL: Record<Department, string> = {
  PHYSICS_1: "물리1",
  CHEMISTRY_1: "화학1",
  BIOLOGY_1: "생물1",
  EARTH_1: "지구1",
  CHEMISTRY_2: "화학2",
  SOCIOCULTURE: "사회문화",
  MATH: "수학",
  INTEGRATED_SCIENCE: "통합과학",
  INTEGRATED_SOCIAL: "통합사회",
  ADMIN: "관리",
};

export function prettyDepartment(dep?: string | null): string {
  if (!dep) return "-";
  const k = dep as Department;
  return DEPARTMENT_LABEL[k] ?? dep;
}

export function isDepartment(v: unknown): v is Department {
  if (typeof v !== "string") return false;
  return Object.prototype.hasOwnProperty.call(DEPARTMENT_LABEL, v);
}




// // FILE: src/data/departments.ts

// export type Department =
//   | "PHYSICS_1"
//   | "CHEMISTRY_1"
//   | "CHEMISTRY_2"
//   | "BIOLOGY_1"
//   | "EARTH_1"
//   | "SOCIOCULTURE"
//   | "MATH"
//   | "INTEGRATED_SCIENCE"
//   | "INTEGRATED_SOCIAL";

// export const DEPARTMENTS: Department[] = [
//   "PHYSICS_1",
//   "CHEMISTRY_1",
//   "CHEMISTRY_2",
//   "BIOLOGY_1",
//   "EARTH_1",
//   "SOCIOCULTURE",
//   "MATH",
//   "INTEGRATED_SCIENCE",
//   "INTEGRATED_SOCIAL",
// ];

// export const DEPARTMENT_LABEL: Record<Department, string> = {
//   PHYSICS_1: "물리1",
//   CHEMISTRY_1: "화학1",
//   CHEMISTRY_2: "화학2",
//   BIOLOGY_1: "생물1",
//   EARTH_1: "지구1",
//   SOCIOCULTURE: "사회문화",
//   MATH: "수학",
//   INTEGRATED_SCIENCE: "통합과학",
//   INTEGRATED_SOCIAL: "통합사회",
// };

// export function isDepartment(v: unknown): v is Department {
//   return typeof v === "string" && (DEPARTMENTS as unknown as string[]).includes(v);
// }

// export function prettyDepartment(v: unknown): string {
//   if (typeof v !== "string") return "-";
//   if (v === "ADMIN") return "관리자";
//   if (isDepartment(v)) return DEPARTMENT_LABEL[v];
//   return v || "-";
// }
