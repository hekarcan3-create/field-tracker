import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';

  // In dev, proxy to local backend (or set VITE_API_URL in .env.local)
  const backendUrl = process.env.VITE_API_URL || 'http://localhost:3001';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      proxy: isDev ? {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/socket.io': {
          target: backendUrl,
          ws: true,
          changeOrigin: true,
        }
      } : undefined,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});