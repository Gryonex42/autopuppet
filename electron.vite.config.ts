import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: 'src/main/main.ts',
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: 'src/preload/index.ts',
      },
    },
  },
  renderer: {
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: 'src/renderer/index.html',
      },
    },
  },
})
