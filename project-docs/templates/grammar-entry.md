---
id: my-new-pattern            # 全局唯一；小写英文/数字/连字符；不要把等级或目录层级写进 ID
title: 〜〜                    # 页面标题，如 〜ことになる
reading: 〜〜                  # 检索用假名
jlpt: N4                      # N5–N1 之一
category: sentence-patterns   # 必须是分类注册表中已有的 ID（docs/.vitepress/categories.json）
tags:                         # 中文短词（1–4 字）；禁止写 JLPT 等级
  - 主题
forms:                        # 接续形式，一行一种
  - 动词辞书形＋〜
related:                      # 只能引用已存在的语法 ID；校验器会检查
  - koto-ni-naru
status: draft                 # draft / reviewed / needs-correction
---

# 〜〜

## 核心含义
一两句话说明主要意义；有多个用法时分开小段，先给最核心的。

## 接续
- 动词辞书形＋〜
- な形容词词干／名词＋〜

## 例句
<ExampleSentences />
配套例句写在 `docs/grammar/<id>.json`（格式见《内容数据规范》第 5 节）。

## 相似表达
只写与关联条目的差异说明，不要手写链接——相关条目列表由 frontmatter 的 `related` 自动渲染。

## 使用注意
常见误用、语境限制、正式程度等。

## 参考与补充
例句为原创时请说明；引用他人内容必须符合许可与署名要求（见 CONTRIBUTING.md）。
