import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
    dedupe: ["react", "react-dom"], // 링크된 패키지 등에서 중복 로딩 방지
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // frontend는 /api/xxx로 호출하지만, backend 라우트는 /xxx 이므로 prefix 제거
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
})