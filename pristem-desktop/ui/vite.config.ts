import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The desktop shell serves `dist/` over 127.0.0.1 from the Rust process (wry/tao window).
// During development the same API is proxied to that Rust process.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    // Hashed asset names never collide; skipping the bulk delete keeps the build
    // compatible with environments that guard mass file deletions.
    emptyOutDir: false,
    target: 'es2022',
    // The window renders with the OS WebView, not a bundled Chromium. esbuild
    // lowers modern CSS *syntax* (nesting, :is(), logical shorthands) to this
    // floor so an old WebView2 / WKWebView / WebKitGTK can still parse the
    // stylesheet. Value-level features (color-mix, corner-shape, @property)
    // cannot be polyfilled here — those are gated by @supports and covered by
    // literal fallbacks in styles.css / polish.css (see capabilities.ts).
    cssTarget: ['chrome100', 'safari15'],
    chunkSizeWarningLimit: 4000,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
