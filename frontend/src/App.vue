<template>
  <a-config-provider :locale="zhCN" :theme="themeConfig">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context'
import { showUpdatePrompt, startUpdateCheck } from '@/utils/update-check'

// OpenCode 风格；原始规范见 docs/design/DESIGN.md，配合 style.css 的同名色板。
const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: '#201d1d',
    colorPrimaryHover: '#302c2c',
    colorPrimaryActive: '#0f0000',
    colorLink: '#201d1d',
    colorLinkHover: '#646262',
    colorSuccess: '#30d158',
    colorWarning: '#ff9f0a',
    colorError: '#ff3b30',
    colorInfo: '#007aff',
    colorText: '#201d1d',
    colorTextSecondary: '#424245',
    colorTextTertiary: '#646262',
    colorTextQuaternary: '#9a9898',
    colorBorder: 'rgba(15,0,0,0.12)',
    colorBorderSecondary: 'rgba(15,0,0,0.12)',
    colorBgContainer: '#fdfcfc',
    colorBgElevated: '#fdfcfc',
    colorBgLayout: '#fdfcfc',
    colorFillAlter: '#f8f7f7',
    colorFillSecondary: '#f1eeee',
    controlItemBgActive: '#f1eeee',
    controlItemBgHover: '#f8f7f7',
    controlOutline: 'transparent',
    borderRadius: 4,
    borderRadiusSM: 4,
    borderRadiusLG: 0,
    fontSize: 16,
    fontSizeSM: 14,
    lineHeight: 1.5,
    controlHeight: 40,
    controlHeightSM: 32,
    controlHeightLG: 44,
    boxShadow: 'none',
    boxShadowSecondary: 'none',
    fontFamily: "'Berkeley Mono', 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'Noto Sans Mono CJK SC', 'Sarasa Mono SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'HarmonyOS Sans SC', 'Noto Sans SC', sans-serif",
  },
  components: {
    Button: { controlHeight: 36 },
    Menu: { colorItemBg: '#fdfcfc', colorSubItemBg: '#fdfcfc', colorItemBgSelected: '#201d1d', colorItemTextSelected: '#fdfcfc', radiusItem: 0 },
    Table: { colorFillAlter: '#f8f7f7' },
    Card: { borderRadiusLG: 0 },
    Modal: { borderRadiusLG: 0 },
  },
}

// F32 版本更新提醒：构建实例才轮询；提示交给用户确认刷新，未保存内容由既有保护接管
let stopUpdateCheck: (() => void) | undefined
onMounted(() => { stopUpdateCheck = startUpdateCheck({ onUpdate: showUpdatePrompt }).stop })
onBeforeUnmount(() => stopUpdateCheck?.())
</script>
