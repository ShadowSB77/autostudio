import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import cfg from './app.config.json' with { type: 'json' };

const supabaseHost = new URL(cfg.supabaseUrl).host.replace(/\./g, '\\.');

export default defineConfig({
  base: cfg.basePath,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // registered in src/lib/sw.ts
      manifest: false, // every studio gets its own manifest (scripts/postbuild.mjs)
      workbox: {
        globPatterns: ['**/*.{js,css,woff2,svg,png}'],
        globIgnores: ['**/s/**'],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        importScripts: ['push-sw.js'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'pages', networkTimeoutSeconds: 4, expiration: { maxEntries: 60 } },
          },
          {
            urlPattern: new RegExp(`^https://${supabaseHost}/rest/v1/(tenants|services|bays|gallery|days_off)`),
            handler: 'NetworkFirst',
            method: 'GET',
            options: { cacheName: 'studio-data', networkTimeoutSeconds: 5, expiration: { maxEntries: 200, maxAgeSeconds: 7 * 86400 } },
          },
          {
            urlPattern: new RegExp(`^https://${supabaseHost}/storage/v1/object/public/`),
            handler: 'CacheFirst',
            options: { cacheName: 'photos', expiration: { maxEntries: 300, maxAgeSeconds: 30 * 86400 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  test: { include: ['tests/unit/**/*.test.ts'] },
});
