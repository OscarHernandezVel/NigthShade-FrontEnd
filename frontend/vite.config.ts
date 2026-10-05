import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base: the build works on any host or sub-path (Netlify, Vercel, GitHub Pages, Nginx).
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
  server: { port: 5173, fs: { allow: ['..'] } },
  test: { include: ['tests/**/*.test.ts'], environment: 'happy-dom' },
});
