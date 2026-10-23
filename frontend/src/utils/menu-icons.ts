import type { Component } from 'vue'
import {
  AppstoreOutlined,
  BarChartOutlined,
  BellOutlined,
  CalendarOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  FolderOutlined,
  HistoryOutlined,
  HomeOutlined,
  IdcardOutlined,
  LockOutlined,
  SaveOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons-vue'

/**
 * 菜单图标由后端下发组件名（如 HomeOutlined）。
 * 未知名称回退到「分类用文件夹、叶子用文档」，避免渲染空白。
 */
const ICONS: Record<string, Component> = {
  AppstoreOutlined,
  BarChartOutlined,
  BellOutlined,
  CalendarOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  FolderOutlined,
  HistoryOutlined,
  HomeOutlined,
  IdcardOutlined,
  LockOutlined,
  SaveOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
}

export function menuIcon(icon: string | null | undefined, hasChildren = false): Component {
  return ICONS[icon || ''] ?? (hasChildren ? FolderOutlined : FileTextOutlined)
}
