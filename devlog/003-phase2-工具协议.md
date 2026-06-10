# 开发日志 #003 — Phase 2：工具协议

**日期**：2026-06-09
**状态**：✅ 完成

---

## Phase 2 目标

> AI 能调用工具完成实际任务。打通全链路：协议解析 → 插件发现 → 插件执行 → 结果注入 → 二次 LLM。

---

## 完成内容

### core/tool_protocol.js
- `<<<TOOL>>>...<<<END>>>` YAML 块解析（`parseToolCalls` / `hasToolCalls`）
- AI 工具描述生成（`generateToolPrompt`），注入 system prompt
- 强制指令："必须使用工具，不要凭记忆回答"

### core/plugin_loader.js
- 扫描 `plugins/`，解析 `manifest.yaml`
- 配置合并：manifest schema 默认值 → config.yaml 覆盖
- `getTools()` / `getPreprocessors()` / `getStatics()` + `reload()`

### core/plugin_executor.js
- spawn 子进程 stdin/stdout JSON + 超时控制（manifest 秒→毫秒）
- Windows `python` vs Linux `python3` 适配
- `PYTHONIOENCODING=utf-8` + TextIOWrapper 解决 GBK 编码

### plugins/web_search/
- manifest.yaml + main.py（Tavily API，httpx + urllib 双回退）

### routes/chat_handler.js
- 工具调用循环（最多 5 轮）
- SSE 流注入工具卡片（`🔧TOOL|name|status|preview`）

### web/index.html
- 深色主题重写 + 侧栏可折叠
- 工具卡片（success/fail 色边 + 展开收起 + 5s 自动折叠）
- 思考动画 + 智能滚动（不抢焦点）
- 连接检测用页面 Key 调 `/v1/models`

### core/llm_client.js
- 流/非流统一 + 协议自动检测（Anthropic vs OpenAI 兼容）
- expandCandidate 仅传非空字段 + spread 顺序修正
- DeepSeek `tool_call_id` 兼容（`role: user` 替代 `role: tool`）
- `family: 4` 强制 IPv4

### config
- 去 `provider`，`api_base` + `api_key` 通吃 OpenAI 兼容服务
- 加 `system_prompt` 字段

---

## 文件变更

| 文件 | 操作 |
|------|------|
| `core/tool_protocol.js` | **新建** |
| `core/plugin_loader.js` | **新建** |
| `core/plugin_executor.js` | **新建** |
| `core/config.js` | **新建** |
| `plugins/web_search/manifest.yaml` | **新建** |
| `plugins/web_search/main.py` | **新建** |
| `routes/chat_handler.js` | **重写** |
| `core/context_builder.js` | **修改** |
| `core/llm_client.js` | **重写** |
| `web/index.html` | **重写** |
| `server.js` | **修改** |
| `config.example.yaml` | **修改** |
| `config.yaml` | **修改** |

---

## 踩坑记录

| 坑 | 解决 |
|-----|------|
| 配置三段式太复杂 | 统一 `api_base` + `api_key` |
| Gemini 不听话 → DeepSeek | 强制 "必须使用工具" 指令 |
| `stream: false` 传丢 | expandCandidate 不传 undefined |
| `model: auto` 覆盖真实模型名 | spread 顺序修正 ×3 |
| `role: tool` DeepSeek 不兼容 | 改 `role: user [工具结果]` |
| timeout 30 秒当 30ms | manifest 秒 ×1000 |
| Windows python3 → python | platform 检测 |
| Python GBK 编码炸 | PYTHONIOENCODING + TextIOWrapper |
| 调试页直连 NewAPI 绕过 | 改回 localhost:5890 |
| `🔧TOOL|` 前导 `\n` 不匹配 | 去前导换行 |
| 侧栏 toggle 飞走 | position: relative |
| 流式抢滚动 | atBottom 阈值判断 |

---

## 代码审计修复（2026-06-10）

| # | 文件 | 问题 | 状态 |
|---|------|------|:--:|
| B1 | `llm_client.js:124-130` | `validateStatus` 重复声明 | ✅ |
| B2 | `tool_protocol.js:14` | `TOOL_RE.lastIndex` 跨调用污染 | ✅ |
| R1 | `main.py:72` | `or True` 死代码 | ✅ |
| R2 | `main.py:33-34` | 函数内重复 import | ✅ |
| R3 | `plugin_executor.js:72` | 回调内 require | ✅ |
| R4 | `chat_handler.js:108` | toolNames 二次解析 | ✅ → toolRounds |
| R5 | `chat_handler.js:118` | 中文硬编码错误检测 | ✅ → status 字段 |
| R6 | `chat_handler.js` | modelName 重复 6 次 | ✅ → 函数提取 |
| R7 | `chat_handler.js:152` | 错误 SSE 不用 sseWrite | ✅ |
| R8 | `tool_protocol.js:53` | unshift 事后调整 | ✅ |
| — | `web/index.html` | pendingToolCards 死代码 | ✅ |

---

## 下一步

**Phase 3：记忆系统**
- `core/memory_engine.js` — 三层记忆 + 向量检索 + 标签索引
- `plugins/daily_note/` — 日记插件

---

*Phase 2 完成 | 2026-06-09*
