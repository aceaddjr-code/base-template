<template>
  <!--
    默认品牌标记：一对直角方括号，中间一枚实心方块（一条被框住的记录）。
    全站唯一的图形语言就是方括号（[+] [x] [ 404 ]），所以 logo 不另起一套符号系统；
    纯几何、无文字，26px 下仍然可辨，也方便任何项目直接替换成自己的标记。

    颜色一律取 currentColor：侧栏是墨底反白，登录页是暖白底墨字，组件本身不关心主题。
  -->
  <svg
    class="brand-mark"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    role="img"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M9 3.6H5v16.8h4"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="butt"
      stroke-linejoin="miter"
    />
    <path
      d="M15 3.6h4v16.8h-4"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="butt"
      stroke-linejoin="miter"
    />
    <rect x="9.2" y="9.2" width="5.6" height="5.6" fill="currentColor" stroke="none" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 16 })
</script>

<style scoped>
.brand-mark { display: block; flex: none; }
</style>
