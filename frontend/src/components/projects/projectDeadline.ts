// FILE: frontend/src/components/projects/projectDeadline.ts

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function parseDeadline(v?: string | null): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;

  // date-only input
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    // treat as end-of-day local time
    return new Date(y, m - 1, d, 23, 59, 59, 999);
  }

  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

export function isPastProject(deadlineStr?: string | null): boolean {
  const dl = parseDeadline(deadlineStr);
  if (!dl) return false;
  return dl.getTime() < startOfToday().getTime();
}

export function daysLeft(deadlineStr?: string | null): number | null {
  const dl = parseDeadline(deadlineStr);
  if (!dl) return null;
  const today0 = startOfToday().getTime();
  return Math.ceil((dl.getTime() - today0) / MS_PER_DAY);
}

export function isDueSoon(deadlineStr?: string | null): boolean {
  const left = daysLeft(deadlineStr);
  if (left == null) return false;
  return left >= 0 && left <= 7;
}

/**
 * Pick the earliest valid deadline among candidates.
 * Useful if you later want "next upcoming deadline" logic.
 */
export function pickEarliestDeadline(...candidates: Array<string | null | undefined>): string | null {
  let best: { t: number; s: string } | null = null;
  for (const c of candidates) {
    const d = parseDeadline(c);
    if (!d) continue;
    const t = d.getTime();
    if (!best || t < best.t) best = { t, s: String(c).trim() };
  }
  return best ? best.s : null;
}

/**
 * Pick the latest valid deadline among candidates.
 */
export function pickLatestDeadline(...candidates: Array<string | null | undefined>): string | null {
  let best: { t: number; s: string } | null = null;
  for (const c of candidates) {
    const d = parseDeadline(c);
    if (!d) continue;
    const t = d.getTime();
    if (!best || t > best.t) best = { t, s: String(c).trim() };
  }
  return best ? best.s : null;
}

// // frontend/src/components/projects/projectDeadline.ts
// const MS_PER_DAY = 24 * 60 * 60 * 1000;

// export function startOfToday(): Date {
//   const now = new Date();
//   return new Date(now.getFullYear(), now.getMonth(), now.getDate());
// }

// export function parseDeadline(v?: string | null): Date | null {
//   if (!v) return null;
//   const s = String(v).trim();
//   if (!s) return null;

//   if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
//     const [y, m, d] = s.split("-").map(Number);
//     return new Date(y, m - 1, d, 23, 59, 59, 999);
//   }

//   const dt = new Date(s);
//   if (Number.isNaN(dt.getTime())) return null;
//   return dt;
// }

// export function isPastProject(deadlineStr?: string | null): boolean {
//   const dl = parseDeadline(deadlineStr);
//   if (!dl) return false;
//   return dl.getTime() < startOfToday().getTime();
// }

// export function daysLeft(deadlineStr?: string | null): number | null {
//   const dl = parseDeadline(deadlineStr);
//   if (!dl) return null;
//   const today0 = startOfToday().getTime();
//   return Math.ceil((dl.getTime() - today0) / MS_PER_DAY);
// }

// export function isDueSoon(deadlineStr?: string | null): boolean {
//   const left = daysLeft(deadlineStr);
//   if (left == null) return false;
//   return left >= 0 && left <= 7;
// }
