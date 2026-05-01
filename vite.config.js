import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  
  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      proxy: isDev ? {
        '/api': {
          target: 'http://192.168.1.79:3001',
          changeOrigin: true,
        },
        '/socket.io': {
          target: 'http://192.168.1.79:3001',
          ws: true,
        }
      } : undefined,
      historyApiFallback: {
        rewrites: [
          { from: /^\/login/, to: '/index.html' },
          { from: /^\/manager/, to: '/index.html' },
          { from: /^\/employee/, to: '/index.html' },
          { from: /./, to: '/index.html' }
        ]
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: false
    }
  };
});
