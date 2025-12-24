/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  // 필요하면 계속 추가
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}