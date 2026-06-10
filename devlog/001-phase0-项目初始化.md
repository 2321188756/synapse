# 开发日志 #001 — Phase 0：项目初始化

**日期**：2026-06-08
**状态**：✅ 完成

---

## 完成内容

### 项目创建
- 项目命名 **Synapse**（神经突触），定位为"个人 AI 中间层"
- 技术栈确认：**Node.js 主服务 + Rust 向量引擎 + Python 插件子进程**
- 对标 VCPToolBox 架构，取其精华简化实现

### 开发文档（6 份）
| 文档 | 内容 |
|------|------|
| `docs/架构设计.md` | 系统全景图、8 个核心模块职责、依赖关系、数据流、错误处理策略 |
| `docs/插件系统规范.md` | 3 种插件类型、manifest.yaml 规范、代码模板、stdin/stdout JSON 通信协议 |
| `docs/工具协议规范.md` | `<<<TOOL>>>...<<<END>>>` YAML 块协议、流式 StreamBuffer、双模策略 |
| `docs/记忆系统设计.md` | 3 层记忆模型（L1/L2/L3）、USearch 向量检索、SQLite 标签索引、时间衰减 |
| `docs/接口设计.md` | OpenAI/Anthropic 兼容接口、WebSocket 事件、管理 API、模型路由 + 容灾 |
| `docs/部署指南.md` | 本地/Docker/Nginx/systemd 部署、数据备份恢复 |

### 项目骨架
```
synapse/
├── package.json          # Node.js 依赖 (express, ws, better-sqlite3, winston...)
├── requirements.txt      # Python 插件依赖
├── config.example.yaml   # 配置模板 (支持 NewAPI/直连/本地三种模式)
├── .gitignore
├── core/                 # 核心模块目录 (空)
├── plugins/              # 插件目录 (空)
├── routes/               # 路由目录 (空)
├── rust-vector/           # Rust 向量引擎 (Cargo.toml + package.json)
│   └── Cargo.toml        # napi-rs + USearch
├── web/
│   └── index.html        # 内置调试聊天页面 (零依赖)
└── data/                 # 运行时数据 (gitignore)
```

### 两轮架构审计
- 第一轮：发现技术栈矛盾（Python vs Node.js）、命名不一致（AI Toolbox vs Synapse）、ChromaDB → USearch
- 第二轮：修复代码示例 Python 残留、伪代码标注、文件名引用
- 全部 P0/P1 问题已清零

### 关键设计决策记录
- **为什么 Node.js 做主服务**：SSE 长连接是 Node.js 天然优势，VCPToolBox 已验证
- **为什么 Rust 做向量引擎**：USearch 千万级亚毫秒检索，N-API 直调零 IPC 开销
- **为什么 Python 做插件**：AI 库生态全在 Python，spawn 子进程天然隔离
- **为什么不用 ChromaDB**：Node.js 主服务调 ChromaDB 需额外 HTTP 进程，USearch 更轻量
- **为什么自定义工具协议**：模型无关，换 LLM 不影响任何功能

---

### 最终收尾（2026-06-08，第三轮追溯验证）

**发现**：审计报告声称 R1-R8 未修复，但逐条读代码验证后确认全部已修。问题根源是多个 Agent 独立工作，改代码未同步审计报告。

**修复**：
| 文件 | 操作 | 说明 |
|------|------|------|
| `CLAUDE.md` | 新建 | Agent 入口规范：5 条铁律 + 文档同步矩阵 + 禁止行为清单 |
| `docs/开发规范.md` | 新建 | 详细流程手册：同步矩阵展开版、日志标准、审计流程、Phase 收尾检查清单 |
| `docs/audit/2026-06-08-架构审计报告.md` | 修改 | R1-R8 标记已修复，P0/P1 清零，更新至第三轮 |

**审计最终结论**：P0/P1 全部清零，Phase 0 正式收尾。仅剩 R9/R10/R11 为 Phase 1 中期可延后项。

---

## 下一步

**Phase 1：后端骨架**
- [ ] `server.js` — Express 主入口
- [ ] `core/llm_client.js` — LLM 调用 + SSE 流式
- [ ] `core/context_builder.js` — 上下文装配
- [ ] 内置调试页面可用（通过 server.js 挂载）
- [ ] `/api/health` 健康检查端点
- [ ] `/v1/chat/completions` 基本聊天（无工具调用）

**目标**：npm start 后打开浏览器就能聊天。

---

*Phase 0 归档人：项目架构师 | 2026-06-08*
