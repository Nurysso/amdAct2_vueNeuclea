import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://dummy-backend-amdact2-vueneuclea.onrender.com/',
        changeOrigin: true,
      },
      '/.well-known': {
        target: 'https://dummy-backend-amdact2-vueneuclea.onrender.com/',
        changeOrigin: true,
      },
    },
  },
});
