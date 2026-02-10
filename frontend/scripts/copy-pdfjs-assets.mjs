import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  // Node 18+ supports fs.cp
  await fs.cp(src, dest, { recursive: true, force: true });
}

async function main() {
  const srcCmaps = path.join(root, "node_modules", "pdfjs-dist", "cmaps");
  const srcFonts = path.join(root, "node_modules", "pdfjs-dist", "standard_fonts");
  const destCmaps = path.join(root, "public", "cmaps");
  const destFonts = path.join(root, "public", "standard_fonts");

  if (!(await exists(srcCmaps))) {
    console.warn(`[copy-pdfjs-assets] Missing source: ${srcCmaps}`);
    process.exit(0);
  }
  if (!(await exists(srcFonts))) {
    console.warn(`[copy-pdfjs-assets] Missing source: ${srcFonts}`);
    process.exit(0);
  }

  await copyDir(srcCmaps, destCmaps);
  await copyDir(srcFonts, destFonts);
  console.log("[copy-pdfjs-assets] Copied pdf.js assets to public/ (cmaps, standard_fonts).");
}

main().catch((err) => {
  console.error("[copy-pdfjs-assets] Failed:", err);
  process.exit(1);
});

