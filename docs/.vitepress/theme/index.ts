import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import ExampleSentences from './components/ExampleSentences.vue'
import './custom.css'

// 站点骨架沿用 VitePress 默认主题；Layout 注入「相关语法」自动列表。
// ExampleSentences 注册为全局组件，供语法条目正文直接使用。
export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('ExampleSentences', ExampleSentences)
  },
}
