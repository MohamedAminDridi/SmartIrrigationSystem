import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Pre-bundle the 3D-twin deps at startup so Vite doesn't re-optimize mid-
  // navigation and 504 the in-flight chunk ("Outdated Optimize Dep"). We import
  // drei via deep submodule paths (NOT the barrel) because the barrel pulls
  // @mediapipe/tasks-vision + hls.js, which crash esbuild's optimizer here.
  optimizeDeps: {
    include: [
      'three',
      '@react-three/fiber',
      '@react-three/drei/core/OrbitControls',
      '@react-three/drei/core/PerspectiveCamera',
      '@react-three/drei/core/OrthographicCamera',
      '@react-three/drei/core/Grid',
      '@react-three/drei/core/Line',
      '@react-three/drei/web/Html',
    ],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      // Proxy Socket.IO WebSocket connections to the backend
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        ws: true,   // ← this is what makes WebSocket proxy work
      },
    }
  }
});