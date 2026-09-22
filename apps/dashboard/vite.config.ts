import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const bff = process.env['DASHBOARD_DEV_BFF_URL'] ?? 'http://localhost:3002';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: bff, changeOrigin: true },
      '/config.json': { target: bff, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Long-lived vendor chunks cache well; zod arrives via runtime enums in @localstripe/contracts.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](zod|@localstripe)[\\/]/.test(id)) return 'contracts';
          if (/[\\/](react|react-dom|scheduler|react-router)[\\/]/.test(id)) return 'react';
          return 'vendor';
        },
      },
    },
  },
});
