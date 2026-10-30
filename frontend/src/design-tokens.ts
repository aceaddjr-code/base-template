import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context'

/**
 * 设计令牌 —— JS 侧的唯一定义。
 *
 * antd 的 ThemeConfig 只吃 JS 值，CSS 变量只吃字符串，两边各抄一份必然漂移
 * （改主色时只改一半，链接色因此出现过「antd 墨色 / CSS 蓝色」两套）。
 * 这里集中定义，右侧注释对应 style.css 里的变量名，改动时两处一起看。
 */
export const FONT_UI =
  "'Berkeley Mono', 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'Noto Sans Mono CJK SC', 'Sarasa Mono SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'HarmonyOS Sans SC', 'Noto Sans SC', sans-serif"

export const palette = {
  primary: '#201d1d', // --color-primary
  primaryLight: '#302c2c', // --color-primary-light
  primaryActive: '#0f0000', // --color-primary-active
  textPrimary: '#201d1d', // --color-text-primary
  textSecondary: '#424245', // --color-text-secondary
  textTertiary: '#646262', // --color-text-tertiary
  textPlaceholder: '#6e6e73', // --color-text-placeholder
  textDisabled: '#9a9898', // --color-text-disabled
  success: '#30d158', // --color-success
  warning: '#ff9f0a', // --color-warning
  danger: '#ff3b30', // --color-danger
  accent: '#007aff', // --color-accent
  link: '#0056b3', // --color-link
  linkHover: '#004085', // --color-link-hover
  canvas: '#fdfcfc', // --color-bg-page / --color-surface
  layer01: '#f8f7f7', // --color-layer-01
  layerHover: '#f1eeee', // --color-layer-hover
  hairline: 'rgba(15,0,0,0.12)', // --color-border-subtle
} as const

/** OpenCode 风格；原始规范见 docs/design/DESIGN.md。 */
export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: palette.primary,
    colorPrimaryHover: palette.primaryLight,
    colorPrimaryActive: palette.primaryActive,
    colorLink: palette.link,
    colorLinkHover: palette.linkHover,
    colorSuccess: palette.success,
    colorWarning: palette.warning,
    colorError: palette.danger,
    colorInfo: palette.accent,
    colorText: palette.textPrimary,
    colorTextSecondary: palette.textSecondary,
    colorTextTertiary: palette.textTertiary,
    colorTextQuaternary: palette.textDisabled,
    colorBorder: palette.hairline,
    colorBorderSecondary: palette.hairline,
    colorBgContainer: palette.canvas,
    colorBgElevated: palette.canvas,
    colorBgLayout: palette.canvas,
    colorFillAlter: palette.layer01,
    colorFillSecondary: palette.layerHover,
    controlItemBgActive: palette.layerHover,
    controlItemBgHover: palette.layer01,
    controlOutline: 'transparent',
    borderRadius: 4,
    borderRadiusSM: 4,
    borderRadiusLG: 0,
    fontSize: 16,
    fontSizeSM: 14,
    lineHeight: 1.5,
    controlHeight: 40,
    controlHeightSM: 32,
    controlHeightLG: 44,
    boxShadow: 'none',
    boxShadowSecondary: 'none',
    fontFamily: FONT_UI,
  },
  components: {
    Button: { controlHeight: 36 },
    Menu: {
      colorItemBg: palette.canvas,
      colorSubItemBg: palette.canvas,
      colorItemBgSelected: palette.primary,
      colorItemTextSelected: palette.canvas,
      radiusItem: 0,
    },
    Table: { colorFillAlter: palette.layer01 },
    Card: { borderRadiusLG: 0 },
    Modal: { borderRadiusLG: 0 },
  },
}
