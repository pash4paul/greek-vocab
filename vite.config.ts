import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// На GitHub Pages сайт живёт по адресу /<repo>/, на Cloudflare/Netlify — в корне.
// BASE_PATH выставляется в CI, локально всегда корень.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  // Дата сборки видна в настройках. Без неё нельзя отличить «обновление
  // не доехало» от «слово в словаре так и не исправили» — а это разные поломки.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Регистрируем сами, в src/lib/pwa.ts: встроенный скрипт вешается
      // на событие load и потому спрашивает сервер о новой версии
      // единственный раз за всю жизнь установленного приложения.
      injectRegister: null,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Ελληνικά — словарь',
        short_name: 'Ελληνικά',
        description: 'Интервальные повторения греческих слов',
        lang: 'ru',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1115',
        theme_color: '#0f1115',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
});
