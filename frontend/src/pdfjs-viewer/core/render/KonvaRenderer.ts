// Initial placeholder for renderer extraction.
//
// Today, `KonvaAnnotationManager` still owns most Konva node creation/updates.
// This module exists to provide a stable import path as we progressively move
// rendering responsibilities out of the engine.

export type KonvaRendererOptions = {
  // reserved for future: pixelRatio, fonts, feature flags, etc.
};

