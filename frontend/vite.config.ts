import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'
import { resolve } from 'path'

// 隔离验收可用 VITE_PROXY_TARGET 指向独立后端；默认指向本机 3010 开发后端
const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:3010'

// F32 构建标识：构建期生成（可用 VITE_BUILD_ID 固定），注入源码并写入 dist/version.json；
// 运行时轮询比较，变化后提示刷新。开发构建固定 'dev' 不轮询；VITE_UPDATE_CHECK_INTERVAL_MS=0 关闭。
const buildId = process.env.NODE_ENV === 'production' ? (process.env.VITE_BUILD_ID || String(Date.now())) : 'dev'
const updateCheckIntervalMs = Number(process.env.VITE_UPDATE_CHECK_INTERVAL_MS ?? 300000)

function appVersionFile(): Plugin {
  return {
    name: 'app-version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId }) })
    },
  }
}

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    appVersionFile(),
    // Ant Design Vue 按需导入（只打包用到的组件，减小体积）
    Components({
      resolvers: [
        AntDesignVueResolver({
          importStyle: false, // 由全局主题管理组件样式
        }),
      ],
      dts: 'src/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __UPDATE_CHECK_INTERVAL_MS__: JSON.stringify(updateCheckIntervalMs),
  },
  server: {
    port: 5174,
    // 2026-08-27 手机调试：允许局域网访问（手机连同一 WiFi 直接看移动端）
    host: true,
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
      },
      // 2026-08-11 问题反馈图片静态访问（dev 直连后端 uploads）
      '/uploads': {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
    // 开发安全头
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
      },
      '/uploads': {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
})
