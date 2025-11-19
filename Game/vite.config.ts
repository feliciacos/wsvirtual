import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const PUBLIC_HOST = process.env.VITE_PUBLIC_HOST || 'localhost';
const HMR_PROTOCOL = process.env.VITE_HMR_PROTOCOL || 'wss';
const HMR_CLIENT_PORT = Number(process.env.VITE_HMR_CLIENT_PORT || 443);

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ["**/DB-ENG/**", "**/DB-JP/**"],
    },
    host: true,          // bind 0.0.0.0 in the container
    port: 5173,
    strictPort: true,
    hmr: {
      protocol: HMR_PROTOCOL,  // 'wss' behind HTTPS
      host: PUBLIC_HOST,       // your public hostname
      clientPort: HMR_CLIENT_PORT, // 443 when proxied
    },
  },
});
