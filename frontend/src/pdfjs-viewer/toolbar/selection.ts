import type { KonvaAnnotationManager } from "../main";

// Back-compat wrapper. Selection logic is now owned by the engine.
export function deleteSelected(manager: KonvaAnnotationManager) {
  manager.deleteSelected();
}

