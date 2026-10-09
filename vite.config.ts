import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({ root: 'web', plugins: [react()], build: { outDir: '../web-dist', emptyOutDir: true }, server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4173' } } });
