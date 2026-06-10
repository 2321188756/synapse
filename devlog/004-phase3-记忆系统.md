# 开发日志 #004 — Phase 3：记忆系统

**日期**：2026-06-10
**状态**：✅ 完成

---

## Phase 3 目标

> AI 能记住过去的对话，并在未来对话中自动召回相关信息。三层记忆模型（L1/L2/L3）落地。

---

## 今日启动内容

### 前置回顾
- Phase 2 已交付：工具协议解析 + 插件系统 + web_search 插件 + 调试页重写
- 昨日验收通过，文档同步完成，P0/P1 零问题

### Phase 3 计划任务

| 任务 | 文件 | 说明 |
|------|------|------|
| 记忆引擎 | `core/memory_engine.js` | 三层记忆：L1 短期上下文 / L2 中期向量 / L3 长期标签 |
| 数据库初始化 | `core/database.js` | SQLite (better-sqlite3) 建表 + 迁移 |
| 日记插件 | `plugins/daily_note/` | manifest.yaml + main.py，通过 AI 写入记忆 |
| 上下文集成 | `core/context_builder.js` 修改 | 记忆召回结果注入 system prompt |
| 管理 API | `routes/memories.js` | GET/PUT/DELETE `/api/memories` |
| 管理 API | `routes/logs.js` | (已内联在 server.js，本次确认完整) |

### 设计依据

参照 [docs/记忆系统设计.md](../docs/记忆系统设计.md)：

```
L1 短期上下文  → 内存消息数组，会话级，零成本
L2 中期记忆    → 向量相似度检索 (先 JS 实现，Phase 4 切 Rust USearch)
L3 长期记忆    → SQLite 标签索引 + 关键词检索，永久存储
```

**L2 向量引擎过渡方案**：Phase 4 才交付 Rust N-API USearch。Phase 3 先用纯 JS 实现余弦相似度（`computeCosineSimilarity`），数据量小（< 5000 条）时性能足够。Phase 4 直接替换底层，API 不变。

> **2026-06-10 收尾决策**：JS 余弦相似度过渡方案取消。原因：Embedding API 调用同样留给 Phase 4，没有向量则余弦相似度无法计算。Phase 3 实际采用关键词扩展 + 最近记忆兜底替代，效果满足当前需求。L2 向量检索在 Phase 4 与 Rust USearch 一并重新设计。

### 核心数据结构

```javascript
// MemoryEntry — 统一记忆条目
{
    id: "mem_xxx",           // UUID
    content: "...",          // 记忆原文
    summary: "...",          // 简短摘要 (< 100 字)
    source: "conversation",  // conversation | manual | ai_generated
    tags: ["用户信息"],       // 标签列表
    importance: 0.8,         // 0-1，默认 0.5
    createdAt: "ISO",        // 创建时间
    lastRecalledAt: "ISO",   // 最近召回时间
    recallCount: 0,          // 召回次数
    embedding: [0.1, ...],   // 向量 (L2)
    layer: "l2" | "l3"       // 当前所在层
}
```

---

## 文件变更计划

| 文件 | 操作 | 说明 |
|------|------|------|
| `core/memory_engine.js` | **新建** | 核心：remember / recall / forget / consolidate |
| `core/database.js` | **新建** | SQLite 初始化 + 建表 + 迁移 |
| `plugins/daily_note/manifest.yaml` | **新建** | 日记插件清单 |
| `plugins/daily_note/main.py` | **新建** | 日记插件入口 |
| `routes/memories.js` | **新建** | 记忆管理 CRUD |
| `core/context_builder.js` | **修改** | 注入记忆召回结果到 system prompt |
| `routes/chat_handler.js` | **修改** | 对话结束后触发自动记忆 |
| `server.js` | **修改** | 挂载 memories 路由 + 启动时初始化数据库 |
| `config.example.yaml` | **修改** | 确认 memory 配置段完整 |

---

## 不涉及（留给后续 Phase）

- ❌ Rust USearch N-API 绑定（Phase 4）
- ❌ Embedding API 调用（Phase 4，需等向量引擎就绪后统一处理）
- ❌ 记忆巩固自动任务（Phase 4+）
- ❌ 标签共现分析（Phase 4+）

---

## 验收标准

1. 对话中 AI 能通过 `daily_note` 工具写入记忆
2. 下次对话时，相关记忆自动召回并注入 system prompt
3. `GET /api/memories` 返回记忆列表，支持 `tags` / `q` / `layer` 筛选
4. `DELETE /api/memories/:id` 删除指定记忆
5. L2 向量检索返回语义相似的记忆（JS 余弦相似度实现）

---

*Phase 3 启动人：项目架构师 | 2026-06-10*

---

## 2026-06-10 实战调试记录

### 问题 1：记忆召回但 LLM 收不到（P0 阻塞）

**现象**：日志显示 `memories: 2`，记忆召回成功，但 AI 回答"你是谁"时完全不引用记忆内容。

**排查**：加诊断日志打印 system prompt 前 300 字符，发现系统消息里只有「你的名字是Nova」和工具指令，**没有记忆文本**。

**根因**：`context_builder.js` 中，`messages.push()` 在第 80 行用 `sysParts.join('\n\n')` 创建了系统消息字符串。然后第 88 行 `sysParts[sysParts.length - 1] += '\n' + memText` 修改的是数组元素，但 `messages[0].content` 已经是旧的字符串引用。JS 字符串不可变，数组元素的重新赋值不影响已经 push 进去的对象。

**修复**：调整装配顺序——先完成 sysParts 的全部拼接（systemPrompt → memories → toolPrompt → date），最后才 `messages.push()`。

### 问题 2：日期幻觉

**现象**：AI 保存记忆时瞎编日期，比如把"昨天吃肉夹馍"记成"2025年6月24日"。

**根因**：系统提示里没有告诉 AI 当前时间，AI 凭训练数据瞎猜。

**修复**：`context_builder.js` 中始终注入 `当前时间：2026年X月X日 星期X HH:mm:ss（北京时间）`。

### 问题 3：前端工具卡片解析脆弱

**现象**：工具卡片有时不显示，有时解析错乱。用户看不到工具执行结果。

**根因**：
- 旧协议用 `🔧TOOL|name|status|preview` 以 `|` 分隔字段，工具返回内容中若包含 `|`（表格、代码等）就解析错乱
- HTML 模板里写了 onclick，JS 又覆盖一个 onclick，两个冲突

**修复**：
- 协议改为 JSON：`🔧TOOL{"t":"name","s":"ok","p":"preview"}`（`|` 随便出现不影响）
- 前端用大括号计数找完整 JSON，不暴力 `split('|')`
- 加了 `toolBuf` 跨 chunk 缓冲，防止 TCP 分包切断 emoji
- 工具卡片默认展开（能看到结果），5 秒后自动折叠

### 问题 4：重复 LLM 调用

**现象**：工具执行后，`chatStreamWithFallback` 又被调用了一次，等于同一个问题问了 LLM 两遍。

**修复**：用 `fakeStream(fullContent)` 把工具循环最后一轮已获取的回复模拟成流式输出，不再重复调 LLM。

### 问题 5：AI 幻觉

**现象**：AI 在没有记忆的情况下编造用户信息（叫用户"小王"），或编造不存在的记忆。

**修复**：
- `tool_protocol.js`：工具指令从激进的「web_search 必须使用，不要凭记忆回答」改为行为准则——不编造、不知道就说不知道、用户信息只从已记录信息引用
- `context_builder.js`：每条系统消息末尾注入三条防幻觉准则

### 问题 6：记忆缺少更新功能

**现象**：用户说"我改名叫XX了"，AI 只能创建新记忆，导致新旧名称共存冲突。

**修复**：
- `memory_engine.js`：新增 `modify(id, updates)` 方法
- `formatForContext()`：记忆注入文本中附带 ID（`- [mem_xxx] 内容`），AI 知道该更新哪条
- `daily_note/main.py`：新增 `cmd_update(params)`，支持 `command=update` + `id`
- `daily_note/manifest.yaml`：更新指令说明 update 用法
- `database.js`：迁移添加 `updated_at` 列

### 当前状态 — 全部清零 ✅

- 记忆召回 → 注入系统提示 ✅
- 日期自动注入 ✅
- 工具卡片渲染 ✅
- 防幻觉准则 ✅
- 记忆更新功能 ✅
- ~~记忆召回偶发不一致~~ ✅ 已修复（关键词扩展 + 兜底检索）
- ~~前端渲染偶发问题~~ ✅ 已修复（JSON.parse 替代大括号计数）

### 修改文件汇总

| 文件 | 变更 |
|------|------|
| `core/context_builder.js` | 修复记忆注入顺序 + 日期注入（含昨天/明天显式参照 + 准则#4）|
| `core/memory_engine.js` | 新增 modify() + formatForContext 附带 ID + 召回双层策略 + 关键词扩展 + 兜底 |
| `core/tool_protocol.js` | 工具指令改为防幻觉行为准则 |
| `core/database.js` | 迁移添加 updated_at 列 |
| `routes/chat_handler.js` | 工具卡片 JSON 协议 + fakeStream 消除重复 LLM 调用 |
| `plugins/daily_note/main.py` | 新增 cmd_update 函数 + execute 路由 |
| `plugins/daily_note/manifest.yaml` | 新增 command/id 参数 + update 示例 |
| `web/index.html` | 拆分为 HTML(58行) + style.css + app.js；工具卡片改用 JSON.parse |
| `web/style.css` | **新建** — 样式独立文件 |
| `web/app.js` | **新建** — 逻辑独立文件 |

---

## 2026-06-10 下午修复记录

### 修复 7：记忆召回偶发不一致 ✅
- **根因**：召回纯粹靠字符级 LIKE 交集。用户用第一人称（"告诉我关于我的事"）而 AI 用第三人称存储（"用户叫弦丝泪"）→ 零字符重叠 → `memories: 0`
- **修复** (`memory_engine.js`)：
  1. `_expandKeywords()` — "我"/"我的" → 自动补充 "用户"，反之亦然
  2. `_getRecentMemories()` — 关键词召回不足时用最近/重要记忆兜底
  3. `_searchByKeywords()` — 提取为独立方法，空关键词返回 [] 防 SQL 语法错误

### 修复 8：AI 日期幻觉 ✅
- **根因**：系统提示只注入"当前时间：2026年6月10日"，AI 需自行推算"昨天=几号"
- **修复** (`context_builder.js`)：显式注入"昨天是 2026年6月9日，明天是 2026年6月11日"，并加准则#4"将相对时间转换为具体日期"

### 修复 9：前端工具卡片解析脆弱 ✅
- **根因**：大括号计数器解析 JSON 边界，preview 里含 `{`/`}` 就错位
- **修复** (`web/app.js`)：直接用 `JSON.parse(jsonStr)`，利用原生解析器处理全部 JSON 语法

### 重构：前端文件拆分
- `web/index.html` 444 行 → 拆为 HTML(58) + style.css(154) + app.js(228)

---

## Phase 3 补充需求

### Git 版本管理（2026-06-10 追加）

项目已完成 Phase 0-3，代码量 ~2000 行、文件 ~30 个，但尚未纳入版本控制。

**需求**：

| 步骤 | 说明 |
|------|------|
| `git init` | 在 `synapse/` 根目录初始化仓库 |
| `.gitignore` 审查 | 已有基础版，需补：`*.log`、`rust-vector/target/`、`.claude/` |
| 初始提交 | 全部源码 + 文档 + 配置模板，排除 `config.yaml` 和 `data/` |
| 后续规范 | 每 Phase 完成后至少一次提交，devlog 记录 commit hash |

**`.gitignore` 补充项**：

| 新增 | 原因 |
|------|------|
| `*.log` | 日志文件不提交 |
| `rust-vector/target/` | Rust 编译产物 |
| `.claude/` | Claude Code 本地配置 |

**涉及文件**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `.gitignore` | 修改 | 补日志/Rust 编译产物/Claude 配置 |

---

*Phase 3 归档人：项目主手开发 | 2026-06-10*