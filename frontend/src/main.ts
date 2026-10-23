import { createApp } from 'vue'
import { createPinia } from 'pinia'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import App from './App.vue'
import router from './router'
import './style.css'
import '@/utils/error-report'
import { hasAccessByCodes, hasAccessByRoles } from '@/utils/access'
import { initModalDrag } from '@/utils/modal-drag'
import { installUpdateReloadPrompt } from '@/utils/update-check'

// 日期组件统一使用中文
dayjs.locale('zh-cn')

const app = createApp(App)

// Vue 运行时异常）默认中断渲染队列——后续状态更新（弹窗关闭/loading 复位）全部失效，表现为
// 「保存一直转圈、其他按钮无反应」。全局 errorHandler 捕获后队列继续，只记录不阻塞。
app.config.errorHandler = (err, _instance, info) => {
  console.error('[vue-error]', info, err)
}

app.use(createPinia())
app.use(router)

// F32：懒加载资源因新版本部署失效时，一次性提示刷新（路由错误 + 未处理拒绝）
installUpdateReloadPrompt(router)

// 用法：v-access="['orders:delete']"（权限码） / v-access:role="['admin']"（角色）
app.directive('access', {
  mounted(el: HTMLElement, binding) {
    const { arg, value } = binding
    if (!value) return
    const ok = arg === 'role' ? hasAccessByRoles(value as string | string[]) : hasAccessByCodes(value as string | string[])
    if (!ok) el.remove()
  },
})

// Ant Design Vue 通过 unplugin-vue-components 按需自动导入，无需全量注册

// 且 MutationObserver 全文档扫描 + 行重建互相触发造成持续布局抖动。
// 「测量行撑高度」的正确解法已在 style.css 落地（.ant-table-measure-row td 清零 padding/height）

app.mount('#app')

initModalDrag()
