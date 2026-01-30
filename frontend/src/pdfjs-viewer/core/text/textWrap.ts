export function wrapTextToWidth(params: { text: string; maxWidth: number; font: string }): string {
  const { text, maxWidth, font } = params;
  if (!text) return "";
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return text;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return text;
  ctx.font = font;

  const measure = (s: string) => ctx.measureText(s).width;
  const inputLines = text.replace(/\r\n/g, "\n").split("\n");
  const outLines: string[] = [];

  for (const line of inputLines) {
    // 공백이 있으면 단어 단위로, 없으면 글자 단위로 랩
    const hasSpace = /\s/.test(line);
    if (hasSpace) {
      const words = line.split(/\s+/).filter(Boolean);
      let cur = "";
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (measure(next) <= maxWidth) {
          cur = next;
        } else {
          if (cur) outLines.push(cur);
          // 단어가 너무 길면 글자 단위로 잘라 넣기
          if (measure(w) > maxWidth) {
            let tmp = "";
            for (const ch of Array.from(w)) {
              const t2 = tmp + ch;
              if (measure(t2) <= maxWidth) tmp = t2;
              else {
                if (tmp) outLines.push(tmp);
                tmp = ch;
              }
            }
            cur = tmp;
          } else {
            cur = w;
          }
        }
      }
      outLines.push(cur);
    } else {
      let cur = "";
      for (const ch of Array.from(line)) {
        const next = cur + ch;
        if (measure(next) <= maxWidth) cur = next;
        else {
          if (cur) outLines.push(cur);
          cur = ch;
        }
      }
      outLines.push(cur);
    }
  }

  return outLines.join("\n");
}

