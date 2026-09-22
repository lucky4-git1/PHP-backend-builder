import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@analyzer': path.resolve(__dirname, './src/analyzer'),
      '@generator': path.resolve(__dirname, './src/generator'),
      '@integration': path.resolve(__dirname, './src/integration'),
      '@testing': path.resolve(__dirname, './src/testing'),
      '@security': path.resolve(__dirname, './src/security'),
      '@projects': path.resolve(__dirname, './src/projects'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@templates': path.resolve(__dirname, './src/templates'),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});