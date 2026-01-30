import type { KonvaAnnotationManager } from "../main";

// Back-compat wrapper. Clipboard logic is now owned by the engine.
export function copySelectedToClipboard(manager: KonvaAnnotationManager) {
  manager.copySelectedToClipboard();
}

export function cutSelectedToClipboard(manager: KonvaAnnotationManager) {
  manager.cutSelectedToClipboard();
}

export async function pasteFromClipboard(manager: KonvaAnnotationManager, targetPage: number) {
  await manager.pasteFromClipboard(targetPage);
}

