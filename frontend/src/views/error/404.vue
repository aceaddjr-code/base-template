<template>

  <div class="flex flex-col items-center justify-center" style="min-height: 100dvh">
    <h1 class="text-6xl font-bold text-gray-300 mb-4">404</h1>
    <p class="text-gray-500 mb-6">页面不存在</p>
    <a-button type="primary" @click="$router.push('/')">返回首页</a-button>
  </div>
</template>
