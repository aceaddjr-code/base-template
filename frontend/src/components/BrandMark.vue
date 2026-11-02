<template>
  <!--
    品牌标记：BS 字母组合（蓝青渐变位图），全站唯一入口就是本组件。
    浅色背景用原版 bs-logo.png；深色背景传 on-dark 用提亮版 bs-logo-dark.png（否则深蓝笔画沉底）。
    标记直接裸放，不垫色块；替换品牌时只改这里与 public/favicon.png。
  -->
  <img
    class="brand-mark"
    :src="onDark ? bsLogoDark : bsLogo"
    :style="{ height: `${size}px` }"
    alt=""
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import bsLogo from '@/assets/bs-logo.png'
import bsLogoDark from '@/assets/bs-logo-dark.png'

withDefaults(defineProps<{ size?: number; onDark?: boolean }>(), { size: 16, onDark: false })
</script>

<style scoped>
.brand-mark { display: block; flex: none; width: auto; }
</style>
