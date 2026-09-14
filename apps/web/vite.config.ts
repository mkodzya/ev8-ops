import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// /api is proxied so the browser talks to one origin — no CORS anywhere.
// In compose the target is the api service; locally it is localhost:8082.
const target = process.env.API_PROXY_TARGET ?? 'http://localhost:8082';

// Hostnames this server answers to beyond localhost and bare IPs. `.local`
// lets a phone reach the laptop stand by its Bonjour name; the stands add
// their domains through ALLOWED_HOSTS.
const allowedHosts = [
  '.local',
  ...(process.env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean),
];

export default defineConfig({
  plugins: [react()],
  // @ev8/shared is reached through a workspace symlink; excluded from
  // pre-bundling so Vite reads its source directly and a new export shows
  // up without a restart.
  optimizeDeps: { exclude: ['@ev8/shared'] },
  server: {
    allowedHosts,
    proxy: { '/api': { target, changeOrigin: true } },
  },
  preview: {
    allowedHosts,
    proxy: { '/api': { target, changeOrigin: true } },
  },
});
