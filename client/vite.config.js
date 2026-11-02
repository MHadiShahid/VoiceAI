import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Express API runs on :3001; proxy /api so the browser
// sees a single origin, exactly like production on Vercel.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
});
