import { defineConfig, loadEnv } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath } from 'node:url';

// HTTPS so phones on the same Wi-Fi can use the live camera (browsers only allow it on https or localhost).
// Ports come from the shell or .env (shell wins): WEB_PORT for this page, PORT for the API. A second copy of the
// project (a git worktree for another agent) runs beside this one with its own pair, e.g. WEB_PORT=5174 PORT=8788.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  return {
    root: 'web',
    plugins: [basicSsl()],
    server: {
      host: true,
      port: Number(env.WEB_PORT || 5173),
      strictPort: true, // never move to the next port quietly: two copies on one port is a mistake to fix (set WEB_PORT), not to work around
      proxy: { '/api': { target: `http://localhost:${env.PORT || 8787}`, changeOrigin: true } }
    },
    build: {
      outDir: '../dist', emptyOutDir: true,
      // render.html is used by the server's compare pass (server/render.js)
      rollupOptions: { input: { main: fileURLToPath(new URL('./web/index.html', import.meta.url)), render: fileURLToPath(new URL('./web/render.html', import.meta.url)) } }
    }
  };
});
