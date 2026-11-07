import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

// Root for normal builds. The manual GitHub Pages preview sets VITE_BASE=/<repo>/.
const base = process.env.VITE_BASE || '/'
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // "prompt": a new version waits until the student taps Reload, so an update never wipes a session in progress.
      registerType: 'prompt',
      injectRegister: false, // registered by src/pwa/register.ts
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'ShuvroMed',
        short_name: 'ShuvroMed',
        description: 'Free medical question bank for MBBS and international exam practice. Educational use only.',
        lang: 'en',
        start_url: `${base}app`,
        scope: base,
        id: base,
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#f7f8fa',
        theme_color: '#0f766e',
        categories: ['education', 'medical'],
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${base}icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. Question files are not precached: a large bank would be a huge first download.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['content/**'],
        navigateFallback: `${base}index.html`,
        // Never answer these with the app page; they are data files.
        navigateFallbackDenylist: [new RegExp(`^${escapeRe(base)}content/`)],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // These patterns are real regular expressions on purpose: the worker file is generated, and a function
            // written here would lose the variables it refers to.
            // Catalogue files: fresh when online, last copy when offline.
            urlPattern: new RegExp(`^https?://[^/]+${escapeRe(base)}content/(manifest|taxonomy)\\.json$`),
            handler: 'NetworkFirst',
            options: { cacheName: 'shuvromed-catalog', networkTimeoutSeconds: 4, expiration: { maxEntries: 8 } },
          },
          {
            // Question files are addressed as <file>?v=<contentVersion>, so one URL is one fixed version.
            urlPattern: new RegExp(`^https?://[^/]+${escapeRe(base)}content/questions/[^/?]+\\.json\\?v=`),
            handler: 'CacheFirst',
            options: { cacheName: 'shuvromed-questions', expiration: { maxEntries: 60 } },
          },
        ],
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        // Libraries change rarely, so putting them in their own files lets a phone keep them cached across app updates.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'vendor-supabase', test: /node_modules[\\/]@supabase[\\/]/, priority: 20 },
            { name: 'vendor-zod', test: /node_modules[\\/]zod[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  resolve: {
    // The real module only exists inside a PWA build; tests use a stub.
    alias: process.env.VITEST
      ? { 'virtual:pwa-register': fileURLToPath(new URL('./src/test/pwa-register-stub.ts', import.meta.url)) }
      : {},
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    exclude: [...configDefaults.exclude, 'supabase/**'],
  },
})
