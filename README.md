# Synapse — 个人 AI 中间层

面向个人用户的 AI 能力增强中间层。像神经突触一样，连接 AI 与外部世界——工具调用、记忆系统、插件生态。

**名字的由来**：Synapse（神经突触）是神经元之间传递信号的关键结构。这个项目就是 AI 的突触层——连接 AI 与工具、AI 与记忆、AI 与真实世界。

---

## 项目定位

```
┌──────────────────────────────────────────────────────────┐
│                     前端 (任意客户端)                       │
│   自研客户端   │   VCPChat    │   ChatBox  │   LobeChat   │
└──────────────────────┬───────────────────────────────────┘
                       │  HTTP + SSE + WebSocket
┌──────────────────────┴───────────────────────────────────┐
│                     Synapse (本仓库)                       │
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ 插件运行时 │  │ 记忆引擎  │  │ 上下文装配 │  │ 调试页面  │ │
│  │ 工具调用  │  │ 向量检索  │  │ 变量替换   │  │ (内置)   │ │
│  │ 协议解析  │  │ 标签索引  │  │ 占位符注入 │  │          │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────────────┐
│                     上游 LLM API                          │
│    NewAPI / one-api  │  直连厂商  │  本地 Ollama/vLLM       │
└──────────────────────────────────────────────────────────┘
```

**核心理念**：
- **模型无关** — 自定义文本协议实现工具调用，换模型不影响任何功能
- **插件即目录** — 加能力 = 新建文件夹 + manifest.yaml，删能力 = 删文件夹
- **记忆分层** — 短期上下文 / 中期向量 / 长期标签，各司其职
- **三语言协同** — Node.js 主服务 + Rust 向量引擎 + Python 插件，各取所长

---

## 快速开始

### Docker 一键启动（推荐）

```bash
git clone https://github.com/2321188756/synapse.git
cd synapse
cp config.example.yaml config.yaml
# 编辑 config.yaml，填入 LLM API Key
docker-compose up -d
# 打开 http://localhost:5890
```

### 本地开发启动

```bash
git clone https://github.com/2321188756/synapse.git
cd synapse
cp config.example.yaml config.yaml
# 编辑 config.yaml，填入 LLM API Key

npm install
npm run build:rust
pip install -r requirements.txt

npm start
# 打开 http://localhost:5890
```

---

## 项目结构

```
synapse/
├── README.md
├── config.example.yaml          # 配置模板
├── package.json                 # Node.js 依赖 + 脚本
├── requirements.txt             # Python 插件依赖
├── server.js                    # 主入口 (Express)
│
├── devlog/                      # 开发日志
│   ├── 000-模板.md
│   └── 001-phase0-项目初始化.md
│
├── docs/                        # 开发文档 (中文命名)
│   ├── 架构设计.md
│   ├── 插件系统规范.md
│   ├── 工具协议规范.md
│   ├── 记忆系统设计.md
│   ├── 接口设计.md
│   ├── 部署指南.md
│   └── 架构审计报告.md
│
├── core/                        # 核心模块 (Node.js)
│   ├── plugin_loader.js         # 插件加载器
│   ├── plugin_executor.js       # 插件执行器
│   ├── tool_protocol.js         # 工具协议解析
│   ├── context_builder.js       # 上下文装配
│   ├── memory_engine.js         # 记忆引擎
│   ├── ws_server.js             # WebSocket 服务
│   └── llm_client.js            # LLM 调用封装
│
├── rust-vector/                 # Rust 向量引擎 (N-API)
│   ├── Cargo.toml
│   └── src/
│
├── plugins/                     # 插件目录 (Python/Node 混合)
│   ├── web_search/
│   │   ├── manifest.yaml
│   │   └── main.py              # 子进程执行
│   ├── file_manager/
│   ├── image_gen/
│   └── daily_note/
│
├── routes/                      # Express 路由
├── modules/                     # 可复用内部模块
│   ├── logger.js
│   ├── message_processor.js
│   └── agent_manager.js
│
├── web/                         # 内置调试页面
│   └── index.html
│
└── data/                        # 运行时数据 (gitignore)
    ├── memory.db
    └── vectors/
```

---

## 技术栈

| 层次 | 技术 | 选型理由 |
|------|------|----------|
| 主服务 | **Node.js + Express 4** | 异步 I/O 天然适合 SSE 流式；生态成熟 |
| 向量引擎 | **Rust (napi-rs)** | 极致性能，C++ FFI 零开销；对标 VCP 的 rust-vexus |
| 插件运行 | **Python 子进程 (spawn)** | 语言无关；Python 是 AI 库的第一语言 |
| 向量索引 | **fast-hnsw** (via Rust) | 纯 Rust HNSW，零 C 依赖，Windows 编译友好 |
| 关系存储 | **SQLite** (better-sqlite3) | 单文件，同步 API 简单可靠 |
| 进程管理 | **PM2** | Node.js 生态标配 |
| 调试页面 | **原生 HTML + vanilla JS** | 零依赖 |
| 容器化 | **Docker Compose** | 一键部署 |

---

## 为什么 Node.js + Rust + Python？

```
Node.js  →  主服务、SSE 流式、WebSocket、路由
             异步 I/O 是你的全部需求，Express 生态二十年积累

Rust    →  向量索引、Embedding 运算、文本分块
             N-API 直接调用，比 IPC 快 100 倍；对标 VCP 的 rust-vexus-lite

Python  →  AI 插件 (生图、搜索、数据分析)
             spawn 子进程通过 stdio JSON 通信，完全语言无关
             崩溃不影响主进程，天然隔离
```

---

## 与同类项目的区别

| | Synapse | VCPToolBox | LangChain | Dify |
|------|:--:|:--:|:--:|:--:|
| 定位 | 个人 AI 中间层 | AI 存在基础设施 | 开发框架 | 企业平台 |
| 主语言 | **Node.js** | **Node.js** | Python | Python |
| 向量引擎 | Rust fast-hnsw | Rust USearch | 无内置 | 向量库 |
| 插件化 | 目录即插件 | 目录即插件 | 代码级 | 可视化 |
| 调试页面 | **内置** | 需独立前端 | 无 | 内置 |
| 模型无关 | ✅ 自定义协议 | ✅ 自定义协议 | ⚠️ | ⚠️ |
| 记忆系统 | 轻量 3 层 RAG | 浪涌算法 | 无内置 | 向量库 |
| 学习成本 | **中** | 极高 | 中 | 中 |

---

## 开发路线图

- [x] Phase 0: 开发文档 + 项目骨架
- [x] Phase 1: server.js + LLM 调用 + SSE 流式 + 调试页面可聊天
- [x] Phase 2: 工具协议解析 + 第一个插件 (web_search)
- [x] Phase 3: 记忆系统 — 向量检索 + 标签索引 + 日记插件
- [x] Phase 4: Rust 向量引擎 — N-API 绑定 + fast-hnsw 集成
- [x] Phase 5: WebSocket 推送 + 异步工具回调
- [x] Phase 6: 管理 API — 插件热重载 + 记忆管理
- [x] Phase 7: Docker 一键部署

---

## V0.2 路线图（beta → 稳定）

| 优先级 | Phase | 内容 |
|:--:|------|------|
| 🔴 P0 | 测试体系 | Jest 单元测试 + 集成测试，覆盖率 > 70% |
| 🔴 P0 | 错误处理加固 | config schema 校验、上游降级提示、插件崩溃恢复 |
| 🟡 P1 | 日志强化 | requestId 贯穿全链路，结构化日志 |
| 🟡 P1 | file_manager 插件 | 文件读写/列表，限定安全目录 |
| 🟡 P1 | static 插件落地 | weather / time / system_info 注入 |
| 🟡 P1 | 记忆自动巩固 | node-schedule 定时 L2→L3 提升 |
| 🟡 P1 | 对话持久化 | 会话历史保存 + 恢复 |
| 🟢 P2 | Agent 模式 | AI 自主多步任务执行 |
| 🟢 P2 | image_gen 插件 | DALL-E / Stable Diffusion |
| 🟢 P2 | CLI 工具 | 插件脚手架、记忆查询、配置管理 |
| 🟢 P2 | 多模态支持 | 图片理解 + 文件上传 |
| 🟢 P2 | OpenAPI 文档 | Swagger 自动生成 |

**V0.2-beta 里程碑**：前 3 项 P0 完成后发布。

---

## 许可证

MIT License

---

## 致谢

架构设计深受 [VCPToolBox](https://github.com/lioensky/VCPToolBox) 启发。
