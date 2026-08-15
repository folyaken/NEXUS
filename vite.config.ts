import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Версия берётся из манифеста, а не дублируется в коде интерфейса: иначе после
// повышения версии окно «О программе» и боковая панель начинают показывать
// старое значение, и понять, что именно установлено, невозможно.
const manifestUrl = new URL('./package.json', import.meta.url);
const { version } = JSON.parse(readFileSync(fileURLToPath(manifestUrl), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
});
