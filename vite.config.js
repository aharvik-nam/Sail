import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'SeilNav',
        short_name: 'SeilNav',
        description: 'Seilapp for fritidsbåt',
        theme_color: '#0a1628',
        background_color: '#0a1628',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cache\.kartverket\.no\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'kartverket-tiles',
              expiration: { maxEntries: 3000, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            }
          },
          {
            urlPattern: /^https:\/\/tiles\.openseamap\.org\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'openseamap-tiles',
              expiration: { maxEntries: 1500, maxAgeSeconds: 14 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            }
          },
          {
            urlPattern: /^https:\/\/api\.met\.no\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'yr-weather',
              expiration: { maxEntries: 10, maxAgeSeconds: 30 * 60 },
              networkTimeoutSeconds: 8,
            }
          },
          {
            urlPattern: /^https:\/\/api\.sehavniva\.no\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'tide-data',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 },
              networkTimeoutSeconds: 8,
            }
          },
        ]
      }
    })
  ]
})
