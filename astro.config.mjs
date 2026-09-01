// @ts-check
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'

// https://astro.build/config
export default defineConfig({
  output: 'static', // every page is client-driven; the relay owns all game state
  server: { port: 4331, host: true },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
})
