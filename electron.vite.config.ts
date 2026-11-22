import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        // 行为探针单独打进 worker 产物，主进程不直接加载原生输入钩子
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          inputProbeWorker: resolve(__dirname, 'src/main/recognition/inputProbeWorker.ts')
        },
        output: { entryFileNames: '[name].js' }
      }
    },
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload' },
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          motion: resolve(__dirname, 'src/renderer/motion.html'),
          pet: resolve(__dirname, 'src/renderer/pet.html'),
          widget: resolve(__dirname, 'src/renderer/widget.html'),
          dialog: resolve(__dirname, 'src/renderer/dialog.html'),
          todoWidget: resolve(__dirname, 'src/renderer/todoWidget.html'),
          vrmPreview: resolve(__dirname, 'src/renderer/vrm-preview.html')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src')
      }
    }
  }
})
