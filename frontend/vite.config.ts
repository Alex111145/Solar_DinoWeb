import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth':     'http://localhost:8000',
      '/missions': 'http://localhost:8000',
      '/payments': 'http://localhost:8000',
      '/admin':    'http://localhost:8000',
      '/reviews':  'http://localhost:8000',
    },
  },
  build: {
    outDir: '../static/app',
    emptyOutDir: true,
  },
})
