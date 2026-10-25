import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const uiToken = process.env.UI_TOKEN;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.SERVER_URL ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure: (proxy) => {
          if (uiToken) proxy.on('proxyReq', (proxyReq, req) => {
            const isRead = req.method === 'GET' || req.method === 'HEAD';
            if (isRead || req.headers['x-requested-with'] !== undefined) {
              proxyReq.setHeader('Authorization', `Bearer ${uiToken}`);
            }
          });
        },
      },
    },
  },
});
