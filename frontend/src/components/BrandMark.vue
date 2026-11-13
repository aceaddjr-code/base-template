<template>
  <img
    class="brand-mark"
    src="/logo.ico?v=20261104"
    :style="{ height: `${size}px` }"
    alt=""
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number; onDark?: boolean }>(), { size: 16, onDark: false })
</script>

<style scoped>
.brand-mark { display: block; flex: none; width: auto; }
</style>
