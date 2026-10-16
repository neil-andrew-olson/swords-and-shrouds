import { defineConfig } from 'vite';
export default defineConfig({build:{outDir:'dist/client',chunkSizeWarningLimit:800},server:{host:'0.0.0.0'}});
