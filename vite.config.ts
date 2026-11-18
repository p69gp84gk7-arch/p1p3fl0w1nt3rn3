/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// La base est relative pour fonctionner aussi bien sur GitHub Pages
// (https://<compte>.github.io/<depot>/) qu'en local.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 900 },
  test: {
    environment: 'jsdom',
  },
});
