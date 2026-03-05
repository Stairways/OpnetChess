import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // Required for opnet / btc-vision packages that use Node globals
    global: 'globalThis',
    'process.env': {},
  },
  resolve: {
    alias: {
      // Polyfill Buffer for browser
      buffer: 'buffer/',
    },
  },
  optimizeDeps: {
    include: ['buffer'],
    esbuildOptions: {
      target: 'esnext',
      define: {
        global: 'globalThis',
      },
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          opnet: ['opnet', '@btc-vision/transaction', '@btc-vision/bitcoin'],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
