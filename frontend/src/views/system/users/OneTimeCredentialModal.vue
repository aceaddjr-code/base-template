<template>
  <a-modal
    :open="open"
    :closable="false"
    :mask-closable="false"
    :keyboard="false"
    width="480px"
  >
    <template #title>
      <div class="flex items-center gap-2">
        <KeyOutlined class="text-primary" />
        <span>一次性临时密码</span>
      </div>
    </template>
    <template #footer>
      <a-button type="primary" @click="close">{{ copied ? '已复制，我已保存，关闭' : '我已保存，关闭' }}</a-button>
    </template>

    <a-alert
      type="warning"
      show-icon
      message="临时密码仅本次显示"
      description="关闭后无法再次查看；如丢失，请对该账号重新执行重置密码。请立即复制并安全转交本人。"
      class="mb-4"
    />

    <div class="credential-row">
      <a-input :value="credential?.temporaryPassword" readonly aria-label="临时密码" class="credential-input" @focus="selectTarget" />
      <a-button type="primary" @click="copy"><CopyOutlined /> 复制</a-button>
    </div>
    <p class="credential-meta">
      {{ targetLabel }}的临时密码，有效期至 <strong>{{ formattedExpiry }}</strong>；
      首次登录后必须修改密码。
    </p>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { CopyOutlined, KeyOutlined } from '@ant-design/icons-vue'
import type { TemporaryCredential } from '@/api/user'
import { formatDateTime } from '@/utils/format'

/**
 * 一次性临时凭据展示（创建用户/重置密码共用）：明文只在本组件内存中出现，
 * 不落 localStorage/sessionStorage/控制台；仅「我已保存」按钮可关闭。
 */
const props = defineProps<{ open: boolean; credential: TemporaryCredential | null; targetLabel?: string }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const copied = ref(false)
const formattedExpiry = computed(() => (props.credential ? formatDateTime(props.credential.expiresAt) : '-'))

watch(() => props.open, (open) => { if (open) copied.value = false })

function selectTarget(event: FocusEvent) {
  ;(event.target as HTMLInputElement | null)?.select()
}

async function copy() {
  const value = props.credential?.temporaryPassword ?? ''
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
    } else {
      // 非安全上下文回退：临时 textarea 复制后立即移除
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    copied.value = true
    message.success('已复制临时密码')
  } catch {
    message.error('复制失败，请手动选中复制')
  }
}

function close() {
  emit('update:open', false)
}
</script>

<style scoped>
.credential-row { display: flex; gap: var(--space-2); align-items: center; }
.credential-input { flex: 1; font-family: var(--font-mono, monospace); letter-spacing: 0.05em; }
.credential-meta { margin: var(--space-3) 0 0; font-size: var(--text-aux); color: var(--color-text-secondary); line-height: var(--lh-base); }
</style>
