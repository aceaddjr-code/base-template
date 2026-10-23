import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAccessStore = defineStore('access', () => {
  const accessCodes = ref<string[]>([])

  function setAccessCodes(codes: string[]) {
    accessCodes.value = codes ?? []
  }

  /** 任一权限码命中（OR 语义） */
  function hasCode(codes: string | string[]): boolean {
    const list = Array.isArray(codes) ? codes : [codes]
    return list.some((c) => accessCodes.value.includes(c))
  }

  function clearCodes() {
    accessCodes.value = []
  }

  return { accessCodes, setAccessCodes, hasCode, clearCodes }
})
