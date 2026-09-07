import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:5000',
        changeOrigin: true,
        secure: false
      },
      // Imágenes subidas (perfil, elementos, evidencias): el backend ahora
      // devuelve rutas relativas /uploads/... y el proxy las resuelve.
      '/uploads': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:5000',
        changeOrigin: true,
        secure: false
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
