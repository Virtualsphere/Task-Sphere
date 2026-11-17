// Builds a single self-contained HTML demo (no server needed): npm run build:demo -> dist-demo/index-demo.html
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: [
      // Swap the real API, socket and Google login for in-browser mocks
      { find: /^(\.\.?\/)+api$/, replacement: r('./src/demo/mock.js') },
      { find: /^(\.\.?\/)+socket$/, replacement: r('./src/demo/mock.js') },
      { find: '@react-oauth/google', replacement: r('./src/demo/google.jsx') },
    ],
  },
  build: { outDir: 'dist-demo', rollupOptions: { input: r('./index-demo.html') } },
});
