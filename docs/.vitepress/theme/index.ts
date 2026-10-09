import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import './custom.css'

// 站点骨架沿用 VitePress 默认主题；Layout 注入「相关语法」自动列表。
// 后续自定义组件（例句展示、练习）在此扩展注册。
export default {
  extends: DefaultTheme,
  Layout,
}
