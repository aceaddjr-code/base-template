<template>
  <div v-if="items.length" class="form-feedback" role="alert" tabindex="-1" data-feedback-summary>
    <strong>请检查以下内容</strong>
    <ul><li v-for="(item, index) in items" :key="index"><button v-if="item.field" type="button" @click="emit('focus', item.field)">{{ item.label }}：{{ item.message }}</button><span v-else>{{ item.message }}</span></li></ul>
    <small v-if="requestId">请求号：{{ requestId }}</small>
  </div>
</template>
<script setup lang="ts">
import type { FeedbackItem } from '@/composables/useFormFeedback'
defineProps<{ items: FeedbackItem[]; requestId?: string }>()
const emit = defineEmits<{ focus: [field: string] }>()
</script>
<style scoped>
.form-feedback { border: 1px solid var(--color-text-secondary); border-left: 3px solid #b42318; padding: var(--space-3); margin-bottom: var(--space-3); overflow-wrap: anywhere; }
ul { margin: var(--space-2) 0 0; padding-left: var(--space-4); }
button { padding: 0; border: 0; background: transparent; color: inherit; text-align: left; text-decoration: underline; cursor: pointer; }
small { display: block; margin-top: var(--space-2); color: var(--color-text-tertiary); }
</style>
