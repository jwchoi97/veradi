export type PointerKind = "mouse" | "touch" | "pen" | "unknown";

export function getPointerKind(evt: any): PointerKind {
  const pt = String(evt?.pointerType || "").toLowerCase();
  if (pt === "mouse") return "mouse";
  if (pt === "touch") return "touch";
  if (pt === "pen") return "pen";
  return "unknown";
}

export function isTouchPointer(evt: any): boolean {
  return getPointerKind(evt) === "touch";
}

export function isPenPointer(evt: any): boolean {
  return getPointerKind(evt) === "pen";
}

