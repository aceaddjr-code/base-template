/** 消费 ?detail=<id>，支持同页再次打开；打开失败由页面提示。 */
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/** 按 id 打开详情；tab 为 query 里的页签参数（多数页面用不到） */
export type OpenDetailById = (id: number, tab?: string) => void | Promise<void>

export function useDetailDeepLink(open: OpenDetailById) {
  const route = useRoute()
  const router = useRouter()

  /** 清掉直达参数（保留其它 query，如列表 keyword / 筛选条件），replace 不留历史记录 */
  function clearDirectQuery() {
    if (!route.query.detail && !route.query.tab) return
    const rest: Record<string, any> = { ...route.query }
    delete rest.detail
    delete rest.tab
    router.replace({ path: route.path, query: rest })
  }

  async function handle(detailId: unknown, tab: unknown) {
    const id = Number(detailId)
    if (!detailId || !Number.isInteger(id) || id <= 0) return
    try {
      await open(id, typeof tab === 'string' && tab ? tab : undefined)
    } catch {
      // 打开失败由页面自身提示；此处只保证直达参数被清理，便于用户再次点击重试
    } finally {
      clearDirectQuery()
    }
  }

  /** 由页面在列表数据就绪后调用一次：立即处理当前 query，并接管后续 query 变化 */
  function attach() {
    handle(route.query.detail, route.query.tab)
    watch(
      () => route.query.detail,
      (value, oldValue) => { if (value !== oldValue) handle(value, route.query.tab) },
    )
  }

  return { attach, clearDirectQuery }
}
