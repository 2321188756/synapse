# Synapse — AI 开发规范

> **给你的话**：你是 Synapse 项目的开发 Agent。这份文件是你在项目中的"交通规则"——每次修改代码前先读它，修改后按它检查。

---

## 项目定位

Synapse 是一个**个人 AI 中间层**，连接 AI 与外部世界（工具调用、记忆系统、插件生态）。

- **技术栈**：Node.js 主服务 + Rust 向量引擎 + Python 插件子进程
- **架构哲学**：模型无关、插件即目录、记忆分层、三语言协同
- **对标项目**：VCPToolBox（取其精华，简化实现）

---

## 铁律（违反会导致返工）

### 法则 1：文档-代码一致性

**修改代码后，必须检查并同步关联文档。** 参考下方的[文档同步矩阵](#文档同步矩阵)。

> 你改了 `core/memory_engine.js` 的函数签名 → 必须同步更新 `docs/记忆系统设计.md` 中的对应代码示例。

### 法则 2：变更必须写日志

**每个非琐碎的变更，必须在 `devlog/` 中记录。** 琐碎变更 = 修正错别字、格式化调整。其他一切变更都要写日志。

日志命名规则：`devlog/XXX-phaseN-简短描述.md`，如 `devlog/002-phase1-后端骨架.md`。

日志模板：`devlog/000-模板.md`。

### 法则 3：完成一个 Phase 后三件事

1. 更新 `README.md` 路线图的 checkbox
2. 写 devlog 总结本轮完成内容
3. 检查审计报告是否需要更新（新问题？旧问题已修复？）

### 法则 4：Git 操作后记录日志

**每次 `git commit` 后，必须在 `logs/git.log` 追加一行记录。** 格式：

```
| 日期 | Commit | 说明 |
```

`logs/` 已在 `.gitignore` 中，不推远程，纯本地溯源用。

### 法则 5：发现不一致立即修正

如果你在阅读文档时发现它和代码不一致，**不要忽略**。立即修正文档，并在变更说明中标注。

### 法则 6：不要重复信息

- 架构细节 → 放 `docs/架构设计.md`，CLAUDE.md 只做索引
- 接口细节 → 放 `docs/接口设计.md`
- 不要在多个文档中维护同一份信息

---

## 文档同步矩阵

修改代码后，查这张表，检查**必须检查**列的每一份文档：

| 你修改了... | 必须检查... | 说明 |
|------------|-----------|------|
| `core/config.js` | `docs/部署指南.md` §2.2<br>`config.example.yaml` | 配置加载逻辑 → 部署文档 + 配置模板 |
| `core/database.js` | `docs/记忆系统设计.md` §3.2 | SQLite 表结构 → 设计文档定义 |
| `core/plugin_loader.js` | `docs/架构设计.md` §3.2<br>`docs/插件系统规范.md` | 模块职责描述；插件发现规则 |
| `core/plugin_executor.js` | `docs/架构设计.md` §3.3<br>`docs/插件系统规范.md` §4.1 | 执行器描述；ToolResult 结构 |
| `core/tool_protocol.js` | `docs/架构设计.md` §3.4<br>`docs/工具协议规范.md` | 协议解析逻辑；协议规范 |
| `core/context_builder.js` | `docs/架构设计.md` §3.5 | 上下文装配流程 |
| `core/memory_engine.js` | `docs/架构设计.md` §3.6<br>`docs/记忆系统设计.md` | 记忆引擎描述；数据结构/算法 |
| `core/llm_client.js` | `docs/架构设计.md` §3.7<br>`docs/接口设计.md` §5 | LLM 调用封装；模型路由 |
| `core/ws_server.js` | `docs/架构设计.md` §3.8<br>`docs/接口设计.md` §3 | WS 服务描述；WS 接口 |
| `routes/` 下任何文件 | `docs/接口设计.md` | 路由定义 → 接口文档 |
| `plugins/*/manifest.yaml` | `docs/插件系统规范.md` | manifest 规范一致性 |
| `config.example.yaml` | `docs/部署指南.md` §2.2 | 配置模板 → 部署文档 |
| `docs/` 下任何设计文档 | `docs/audit/*.md` | 设计变更 → 审计报告 |
| `web/index.html` | `docs/架构设计.md` | 调试页面描述 |
| `rust-vector/Cargo.toml` | `docs/架构设计.md` §3.6<br>`docs/记忆系统设计.md` | 向量引擎描述 |
| `modules/logger.js` | `docs/架构设计.md` §3.9 | 日志模块描述、级别规则 |
| `modules/` 下新增模块 | `docs/架构设计.md` §3（新增子节）<br>`docs/接口设计.md`（如涉及 API） | 模块注册 + 接口文档 |

**如果检查出不一致**：立即修正，除非你确定该不一致是有意为之（此时在 devlog 中记录决策理由）。

---

## 关键文件索引

```
synapse/
├── CLAUDE.md                  ← 你在这里。Agent 入口规范
├── README.md                  ← 项目说明 + 路线图
├── start.bat                  ← Windows 一键启动脚本
├── config.example.yaml        ← 配置模板
├── package.json               ← Node.js 依赖
│
├── devlog/                    ← 开发日志（每 Phase 一篇）
│   ├── 000-模板.md
│   ├── 001-phase0-项目初始化.md
│   ├── 002-phase1-后端骨架.md
│   ├── 003-phase2-工具协议.md
│   ├── 004-phase3-记忆系统.md
│   ├── 005-phase4-Rust向量引擎.md
│   ├── 006-phase5-WebSocket推送.md
│   ├── 007-phase6-管理API.md
│   ├── 008-phase7-Docker部署.md
│   ├── 009-phase8-稳定性加固.md
│   ├── 010-phase9-插件补全.md
│   └── 011-phase10-记忆完善.md
│
├── docs/                      ← 设计文档（代码的"说明书"）
│   ├── 架构设计.md             ← 最核心：全景图 + 模块职责 + 数据流
│   ├── 插件系统规范.md         ← manifest.yaml 规范 + 插件代码模板
│   ├── 工具协议规范.md         ← <<<TOOL>>> YAML 协议 + 解析算法
│   ├── 记忆系统设计.md         ← 三层记忆模型 + 数据结构 + 召回算法
│   ├── 接口设计.md             ← API 端点 + WebSocket + 模型路由
│   ├── 部署指南.md             ← 本地/Docker/Nginx 部署
│   ├── 开发规范.md             ← 本文档的详细展开版
│   └── audit/                 ← 架构审计报告（每 Phase 更新）
│
├── core/                      ← 核心模块（Node.js）
│   ├── config.js              ← YAML 配置加载 + 安全检查
│   ├── database.js            ← SQLite 初始化 + 建表 + 迁移
│   ├── llm_client.js          ← LLM 调用 + SSE 流式 + 容灾
│   ├── context_builder.js     ← 上下文装配 + 变量替换
│   ├── memory_engine.js       ← 三层记忆 (remember/recall/forget/modify)
│   ├── tool_protocol.js       ← <<<TOOL>>> YAML 块解析
│   ├── plugin_loader.js       ← 插件扫描 + manifest 加载
│   └── plugin_executor.js     ← spawn 子进程执行插件
├── modules/                   ← 可复用模块
│   └── logger.js              ← winston 封装 + 内存缓冲
├── plugins/                   ← 插件目录
│   ├── WebSearch/            ← 联网搜索 (Tavily)
│   ├── DailyNote/            ← 日记插件 (记忆写入/更新)
│   ├── FileManager/          ← 文件管理 (读写/列表/mkdir/删除)
│   ├── Weather/              ← 天气占位符 (type: static)
│   ├── SystemInfo/           ← 系统状态占位符 (type: static)
│   └── RAGNova/              ← RAG 向量化 (type: internal)
├── rust-vector/               ← Rust 向量引擎（N-API）
│   ├── Cargo.toml
│   ├── src/lib.rs             ← fast-hnsw 索引核心
│   └── index.js               ← N-API 加载桥接
├── routes/                    ← Express 路由
│   ├── chat_handler.js        ← POST /v1/chat/completions
│   ├── health.js              ← GET /api/health (+上游探测)
│   ├── models.js              ← GET /v1/models (从上游拉取)
│   ├── memories.js            ← 记忆管理 CRUD + consolidate
│   ├── plugins.js             ← 插件管理 (列表/重载/启禁)
│   ├── conversations.js       ← 对话历史 CRUD
│   └── config.js              ← 系统配置 (脱敏查询/更新)
├── scripts/                   ← 运维脚本
│   └── migrate-embeddings.js  ← 批量向量化迁移
├── web/                       ← 内置调试页面
│   ├── index.html             ← HTML 骨架 (58行)
│   ├── style.css              ← 深色主题样式
│   └── app.js                 ← 聊天逻辑 + 工具卡片
```

---

## 开发日志规范

### 何时创建

- 开始一个新 Phase → 新建 `devlog/XXX-phaseN-描述.md`
- Phase 中发生重大设计变更 → 在同一日志中追加"中途调整"章节
- Phase 完成 → 将状态改为 ✅ 完成，总结文件变更

### 文件命名

```
devlog/001-phase0-项目初始化.md
devlog/002-phase1-后端骨架.md
devlog/003-phase2-工具协议.md
...
```

编号统一用三位数 `00X`。

### 每篇日志必须包含

1. 日期 + 状态（进行中 / 已完成）
2. 完成内容（按功能模块列举）
3. 文件变更表（文件路径、新增/修改/删除、说明）
4. 遇到的问题 + 解决方案（如有）
5. 关键决策 + 理由（如有）
6. 下一步计划

---

## 禁止行为清单

- ❌ 改代码不检查文档同步矩阵
- ❌ 改设计文档不更新审计报告
- ❌ 完成 Phase 不更新 README 路线图
- ❌ 完成 Phase 不写 devlog
- ❌ 在多个文档中重复同一份信息（一份信息一个权威来源）
- ❌ 用 Python 语法写 Node.js 代码示例（反之亦然）
- ❌ 代码示例不标注语言（用 ````javascript` / ````python` / ````yaml`）
- ❌ 添加新的核心模块但不在 `docs/架构设计.md` 注册
- ❌ 添加新插件但不在 `docs/插件系统规范.md` 的内置插件表中注册
- ❌ 忽略审计报告中的问题——要么修复，要么标注"已知，Phase X 处理"

---

## 快速启动检查表

开始任何编码任务前，用 30 秒确认：

- [ ] 我读了这个 CLAUDE.md
- [ ] 我知道当前是哪个 Phase
- [ ] 我知道要修改的文件在文档同步矩阵里对应哪些文档
- [ ] 我知道修改后需要更新哪些 devlog

结束后：

- [ ] 关联文档已检查/更新
- [ ] devlog 已记录
- [ ] 如果是 Phase 收尾 → README + 审计报告已更新