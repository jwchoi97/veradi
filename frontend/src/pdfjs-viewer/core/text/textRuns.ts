export type TextRun = {
  text: string;
  color: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  italic?: boolean;
  underline?: boolean;
};

export function normalizeTextRuns(params: { runs: TextRun[]; fallbackStyle: Omit<TextRun, "text"> }): TextRun[] {
  const { runs, fallbackStyle } = params;
  // merge adjacent runs with identical style
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r?.text) continue;
    const last = out[out.length - 1];
    if (
      last &&
      last.color === r.color &&
      last.fontSize === r.fontSize &&
      last.fontWeight === r.fontWeight &&
      !!last.italic === !!r.italic &&
      !!last.underline === !!r.underline
    ) {
      last.text += r.text;
    } else {
      out.push({ ...r });
    }
  }
  return out.length ? out : [{ text: "", ...fallbackStyle }];
}

export function applyStyleToRuns(params: {
  runs: TextRun[];
  start: number;
  end: number;
  style: Partial<Pick<TextRun, "color" | "fontSize" | "fontWeight" | "italic" | "underline">>;
  fallbackStyle: Omit<TextRun, "text">;
}): TextRun[] {
  const { runs, start, end, style, fallbackStyle } = params;
  const s = Math.max(0, Math.min(start, end));
  const e = Math.max(0, Math.max(start, end));
  if (e <= s) return runs;

  // flatten into segments with global offsets
  const segs: Array<{ run: TextRun; from: number; to: number }> = [];
  let pos = 0;
  for (const r of runs) {
    const len = (r.text || "").length;
    segs.push({ run: r, from: pos, to: pos + len });
    pos += len;
  }

  const out: TextRun[] = [];
  for (const seg of segs) {
    const r = seg.run;
    if (seg.to <= s || seg.from >= e) {
      out.push({ ...r });
      continue;
    }
    const a = Math.max(seg.from, s);
    const b = Math.min(seg.to, e);
    const leftCount = a - seg.from;
    const midCount = b - a;
    const rightCount = seg.to - b;

    if (leftCount > 0) out.push({ ...r, text: r.text.slice(0, leftCount) });
    if (midCount > 0) {
      out.push({
        ...r,
        ...style,
        text: r.text.slice(leftCount, leftCount + midCount),
      });
    }
    if (rightCount > 0) out.push({ ...r, text: r.text.slice(leftCount + midCount) });
  }

  return normalizeTextRuns({ runs: out, fallbackStyle });
}

