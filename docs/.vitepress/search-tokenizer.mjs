// CJK 感知的分词器，供 VitePress 本地搜索（MiniSearch）使用。
//
// 背景：MiniSearch 默认按空白与标点切词，日语句子会被切成少数几个长 token，
// 导致「留学する」「しましょう」这类句中片段无法命中（VitePress 构建端与
// 客户端均按 themeConfig.search.options.miniSearch.options.tokenize 分词，
// 函数经 _vp-fn_ 序列化保留，见 vitepress 源码 build.ts / VPLocalSearchBox.vue）。
//
// 策略：拉丁字母与数字按连续段整体成词（转小写）；假名＋汉字的连续段做
// 重叠二元切分（bigram），单个字符自成一词。这样「結婚する」→
// [結婚,婚す,する]，查询「結婚」「婚する」「する」都能命中。
//
// 验证脚本：scripts/verify-search.mjs（M3 验收）。

// 平假名 \u3041-\u3096、片假名 \u30a1-\u30fa、长音符 \u30fc、
// 々 \u3005、CJK 统一汉字 \u4e00-\u9fff（含扩展 A \u3400-\u4dbf、兼容区 \uf900-\ufaff）。
const CJK_RUN = '[\\u3041-\\u3096\\u30a1-\\u30fa\\u30fc\\u3005\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]+'
const TOKEN_RE = new RegExp(`([a-zA-Z0-9]+)|(${CJK_RUN})`, 'g')

/** @param {string} text @returns {string[]} */
export function cjkTokenize(text) {
  const tokens = []
  for (const match of String(text).matchAll(TOKEN_RE)) {
    if (match[1]) {
      tokens.push(match[1].toLowerCase())
    } else if (match[2]) {
      const run = match[2]
      if (run.length === 1) {
        tokens.push(run)
      } else {
        for (let i = 0; i < run.length - 1; i++) {
          tokens.push(run.slice(i, i + 2))
        }
      }
    }
  }
  return tokens
}
