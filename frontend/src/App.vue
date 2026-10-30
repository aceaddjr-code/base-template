<template>
  <a-config-provider :locale="zhCN" :theme="themeConfig">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { themeConfig } from '@/design-tokens'
import { showUpdatePrompt, startUpdateCheck } from '@/utils/update-check'

// token 集中在 design-tokens.ts，避免与 style.css 的 CSS 变量各写一份而漂移。

// F32 版本更新提醒：构建实例才轮询；提示交给用户确认刷新，未保存内容由既有保护接管
let stopUpdateCheck: (() => void) | undefined
onMounted(() => { stopUpdateCheck = startUpdateCheck({ onUpdate: showUpdatePrompt }).stop })
onBeforeUnmount(() => stopUpdateCheck?.())
</script>
