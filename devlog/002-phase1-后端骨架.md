# 开发日志 #002 — Phase 1：后端骨架

**日期**：2026-06-08
**状态**：✅ 完成

---

## Phase 1 目标

> `npm start` 后打开浏览器就能聊天。不涉及工具调用、记忆系统、插件——只打通最基础链路。

---

## 完成内容

### server.js — Express 主入口
- [x] Express 应用初始化（v4.21）
- [x] 中间件注册（CORS、鉴权 Bearer Token、RequestID、请求日志）
- [x] 路由挂载（`/v1`、`/api`、静态文件 `web/`）
- [x] 生命周期管理（SIGINT/SIGTERM 优雅关闭，30s 超时强退）
- [x] `config.yaml` 加载 + 启动前安全检查（默认 api_key/admin.password 检测）
- **代码量**：~150 行

### core/llm_client.js — LLM 调用封装
- [x] 统一 LLM 调用接口（支持 OpenAI / Anthropic 格式）
- [x] SSE 流式解析 + AsyncGenerator 逐 token yield
- [x] Provider 自动推断（NewAPI → OpenAI 兼容；Anthropic → Messages API）
- [x] 容灾回退链（primary → fallback[0] → fallback[1] → 503，指数退避）
- [x] 关键词路由（coding / creative / fast / default 四档）
- **代码量**：~170 行

### core/context_builder.js — 上下文装配
- [x] system prompt 加载 + `{{Date}}` `{{Time}}` `{{Today}}` 占位符替换
- [x] 历史消息拼接（最近 N 轮，默认 20）
- [x] 额外变量注入接口（Phase 2 记忆/工具列表从此注入）
- **代码量**：~70 行

### routes/ — 路由
- [x] `routes/chat_handler.js`：`POST /v1/chat/completions`，流式 + 非流式双模式，编排 context_builder → llm_client
- [x] `routes/health.js`：`GET /api/health`，返回 status + version + uptime
- [x] `routes/models.js`：`GET /v1/models`，从 config 动态生成模型列表
- **代码量**：~200 行总计

### web/index.html — 调试页面
- [x] server.js 挂载为静态文件
- [x] 模型列表改为从 `/v1/models` 动态加载（带 fallback 硬编码列表）
- [x] 标题和侧栏已统一为 "Synapse"
- [x] SSE 流式聊天，工具调用检测

### package.json
- [x] 精简依赖（去掉 Phase 1 不用的 multer/sharp/cheerio/pm2/node-schedule）
- [x] Express 降级到 v4.21（v5 仍在 beta，npm 安装不稳定）
- [x] 新增 dayjs 依赖

---

## 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `server.js` | **新建** | Express 主入口 |
| `core/llm_client.js` | **新建** | LLM 调用 + SSE 流式 + 容灾回退 |
| `core/context_builder.js` | **新建** | 上下文装配 + 变量替换 |
| `routes/chat_handler.js` | **新建** | 聊天路由 |
| `routes/health.js` | **新建→修改** | 健康检查 + 上游 LLM 探测 |
| `routes/models.js` | **新建→修改** | 模型列表 + 新配置适配 |
| `web/index.html` | **修改×4** | 标题/SysPrompt即时保存/checkHealth重写/配置简化 |
| `package.json` | **修改** | 精简依赖 + 补 dayjs |
| `modules/logger.js` | **新建** | winston 封装 + 内存缓冲 + 文件轮转 |
| `start.bat` | **新建→修改×4** | Windows 启动脚本 (编码/CRLF/端口/工作目录) |
| `config.yaml` | **修改×3** | 日志文件/配置简化/NewAPI 适配 |
| `config.example.yaml` | **修改** | 配置简化，去掉 provider 模式切换 |

---

## 遇到的问题

### Express 5 版本不存在
- **现象**：`npm install express@^5.1.0` 失败，npm registry 尚无 v5 正式版
- **解决**：降级到 `express@^4.21.0`。API 完全兼容，无代码改动。Express 5 正式发布后升级。

### multer 版本冲突
- **现象**：`multer@^1.4.5` 不存在
- **解决**：Phase 1 不需要文件上传，从 dependencies 中移除。随用随加。

---

## 关键决策

- **Express 4 而非 5**：npm 上 v5 仍是 beta，安装失败。v4 API 已足够，v5 发布后再升。
- **AsyncGenerator 而非 ReadableStream**：`for await...of` 在路由层用起来比 Node.js Stream 的 `on('data')` 模式更直观，错误处理也更清晰。
- **Bearer Token 鉴权而非 API Key Header**：与 OpenAI 标准一致，所有客户端（ChatBox、LobeChat 等）零配置兼容。

---

## 验收结果

```bash
$ node server.js

  ⚡ Synapse 已启动
  ├─ 地址:    http://127.0.0.1:5890
  ├─ 调试页:  http://localhost:5890/
  ├─ API:     http://localhost:5890/v1/chat/completions
  └─ 健康检查: http://localhost:5890/api/health
```

- ✅ `npm start` 启动无报错
- ✅ `/api/health` 返回 `{"status":"ok","version":"1.0.0","uptime":...}`
- ✅ `/v1/models` 返回模型列表
- ✅ 默认 api_key 未修改时拒绝启动
- ✅ 调试页面通过 server.js 挂载，静态文件正常访问

---

## Phase 1 补充需求

### 运行时日志（2026-06-08 追加）

Phase 1 已打通基础链路，但缺少运行时可见性。当前服务跑起来后，除了控制台输出，没有结构化的运行时日志。

**需求**：

| 功能 | 说明 |
|------|------|
| 请求日志 | 每个 HTTP 请求记录 method、path、状态码、耗时 |
| 模块日志 | 核心模块（llm_client、context_builder、chat_handler）关键节点打日志 |
| 日志分级 | debug / info / warn / error，通过 config.yaml 控制 |
| 文件输出 | 支持输出到文件（按日轮转），`config.yaml` 中 `logging.file` 不为空时启用 |
| 日志查询 API | `GET /api/logs?level=error&lines=100` — 从管理面板查看最近日志 |

**涉及文件**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `modules/logger.js` | **新建** | winston 封装，统一日志格式 + 配置加载 |
| `server.js` | 修改 | 挂载请求日志中间件 |
| `core/llm_client.js` | 修改 | LLM 调用关键节点打日志 |
| `routes/chat_handler.js` | 修改 | 请求/响应日志 |
| `routes/logs.js` | **新建** | `GET /api/logs` 端点 |

### 运行时日志 — 已完成 ✅（2026-06-08）

| 功能 | 实现 |
|------|------|
| 请求日志 | `server.js` 中间件：`method path → statusCode (duration)` 格式，级别根据 4xx/5xx 自动判断 |
| 模块日志 | `llm_client.js`：调用开始/完成/失败/容灾切换；`chat_handler.js`：聊天完成/异常 |
| 日志分级 | 通过 `config.yaml` 中 `logging.level` 控制（debug/info/warn/error） |
| 文件输出 | `logging.file` 不为空时启用，10MB 轮转，最多 7 个文件 |
| 日志查询 API | `GET /api/logs?level=error&lines=100&requestId=xxx`，Basic Auth 鉴权 |
| 内存缓冲 | 保留最近 5000 条，超限自动裁剪 |

**实现方式**：
- `modules/logger.js`：winston 封装（`createLogger` / `child` / `queryLogs`），含内存 BufferTransport
- `server.js`：请求日志中间件（res.on('finish') 记录状态码耗时）；`/api/logs` 内联路由（免新建文件）
- `core/llm_client.js`：child logger 在 stream 前后打点，记录 provider/model/duration
- `routes/chat_handler.js`：接收 log 参数，流式/非流式完成时记录耗时
- 去除了所有 `console.log` 原始输出

**参考**：设计文档已有预留 — `docs/架构设计.md` §8 指定用 winston；`docs/接口设计.md` §4.9 定义了 `/api/logs`；`config.example.yaml` 已有 `logging.level` 和 `logging.file` 配置项。

---

### Windows 启动脚本（2026-06-08 追加）

**需求**：项目根目录放一个 `start.bat`，Windows 用户双击即可启动。

**脚本行为**：

| 步骤 | 说明 |
|------|------|
| 检查 Node.js | `node --version` 不可用时提示安装 |
| 检查 config.yaml | 不存在时自动从 `config.example.yaml` 复制，提示编辑 |
| 安全检查 | 检测 `api_key` / `admin.password` 是否为默认值，是则警告并等待确认 |
| 安装依赖 | `node_modules` 不存在时自动 `npm install` |
| 启动服务 | `node server.js`，窗口显示运行日志 |
| 打开调试页 | 启动成功后自动打开浏览器到 `http://localhost:5890` |

**异常处理**：

| 场景 | 行为 |
|------|------|
| 端口被占用 | 提示"端口 5890 已被占用"，不自动退出，等用户按任意键 |
| Node.js 未安装 | 提示下载链接 `https://nodejs.org/`，按任意键退出 |
| config.yaml 默认值未改 | 警告后等待 5 秒，用户按任意键继续（允许开发环境跳过） |
| npm install 失败 | 显示错误，按任意键退出 |
| server.js 崩溃 | 窗口保留错误输出，不闪退 |

**脚本模板参考**（`start.bat`）：

```batch
@echo off
chcp 65001 >nul
title Synapse

echo.
echo   ╔══════════════════════════════════╗
echo   ║         Synapse 启动中...        ║
echo   ╚══════════════════════════════════╝
echo.

:: 1. 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装：https://nodejs.org/
    pause
    exit /b 1
)

:: 2. 检查 config.yaml
if not exist config.yaml (
    echo [信息] config.yaml 不存在，从模板复制...
    copy config.example.yaml config.yaml >nul
    echo [警告] 请编辑 config.yaml，填入 API Key 后重新运行！
    start notepad config.yaml
    pause
    exit /b 0
)

:: 3. 安装依赖
if not exist node_modules (
    echo [信息] 安装依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] npm install 失败
        pause
        exit /b 1
    )
)

:: 4. 启动
echo [信息] 启动服务...
echo.
node server.js

:: 如果 server.js 异常退出，保留窗口
echo.
echo [信息] Synapse 已停止
pause
```

**涉及文件**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `start.bat` | **新建** | Windows 启动脚本，根目录 |

### Windows 启动脚本 — 已完成 ✅（2026-06-08）

`start.bat` 已创建，完整覆盖需求模板中的 5 个步骤 + 异常处理：

| 步骤 | 状态 |
|------|:--:|
| 检查 Node.js → 未安装提示 `https://nodejs.org/` + 退出 | ✅ |
| 检查 config.yaml → 不存在自动复制模板 + 打开记事本 | ✅ |
| 安全检查 → 默认 api_key 警告 + 5 秒倒计时确认 | ✅ |
| 安装依赖 → node_modules 不存在自动 npm install | ✅ |
| 启动服务 → `node server.js`，窗口显示日志 | ✅ |
| 打开调试页 → 自动 `start "" http://localhost:5890` | ✅ |
| 端口占用 → 检测 LISTENING 端口 5890 并提示 | ✅ |
| 异常退出 → 保留窗口 + pause，不闪退 | ✅ |
| npm install 失败 → 显示错误 + 退出 | ✅ |

**额外实现**：`choice /t 5 /d n` 实现超时自动取消；`cd /d "%~dp0"` 解决双击时工作目录错误。

**修复记录**（2026-06-08/09）：
1. 中文编码 → cmd.exe GBK 乱码，中文被当成命令执行 → 全部改为英文 ASCII
2. LF 换行 → Write 工具写 Unix 换行，cmd.exe 无法解析 → sed 转 CRLF
3. 端口残留 → 旧进程不释放 → start.bat 增加 `netstat` 检测 + `taskkill` 自动杀
4. 健康检查用 `/api/health` → 不依赖页面填的 Key → 改为 `/v1/models` + Bearer Token
5. 配置三段式 → 用户需手动注释切换 → 统一 `api_base` + `api_key`，去掉 provider 字段
6. textarea 失焦才存 → 点发送瞬间 System Prompt 未持久化 → `input` 事件即时保存

### 第二轮审计修复（2026-06-09 归档）

| # | 来源 | 问题 | 修复 |
|---|------|------|------|
| 1 | 旧 R3 | usage token 写死 0 | 非流式路径 chars/4 估算 |
| 2 | 旧 R5 | config 缺 system_prompt | config.example.yaml 新增字段 |
| 3 | 旧 R7 | server.js 冗余 dotenv | 删除，纯 YAML 加载 |
| 4 | 新 R1 | llm_client `max_tokens \|\| maxTokens` 重复 | → `config.max_tokens \|\| 4096` |
| 5 | 新 R2 | 架构文档 logger 示例与实际 API 不符 | 重写 §3.9 为 `{ createLogger, queryLogs, child }` |
| 6 | 新 R3 | `global.__synapse_config` 与工厂模式不一致 | 新建 `core/config.js` 单例，统一引用 |

### 补充需求全记录

| 需求 | 状态 |
|------|:--:|
| 运行时日志 (winston + 分级 + 文件 + /api/logs) | ✅ |
| Windows 启动脚本 (start.bat + CRLF + 端口检测) | ✅ |
| 健康检查增强 (上游 LLM 探测 + /v1/models 检测) | ✅ |
| 配置简化 (去 provider + 统一 api_base/api_key) | ✅ |
| System Prompt 即时保存 (input 事件) | ✅ |
| 日志文件路径修正 (项目根 logs/) | ✅ |
| core/config.js 工厂模式 | ✅ |

### 最终文件清单（30 个源文件）

```
synapse/
├── server.js                 Express 主入口
├── start.bat                 Windows 一键启动 (CRLF)
├── config.yaml               用户配置
├── config.example.yaml       配置模板 (含 system_prompt)
├── .gitignore
├── package.json
├── requirements.txt
│
├── core/
│   ├── config.js             配置单例 (init/get)
│   ├── llm_client.js         LLM 调用 + SSE + 容灾 + 自动协议检测
│   └── context_builder.js    上下文装配 + 变量替换
│
├── modules/
│   └── logger.js             winston 封装 + 内存缓冲 + 文件轮转
│
├── routes/
│   ├── chat_handler.js       聊天接口 (流式/非流式 + token计数)
│   ├── health.js             健康检查 + 上游 LLM 探测
│   └── models.js             模型列表 (适配新配置)
│
├── web/
│   └── index.html            内置调试页面
│
├── docs/                     6 份设计文档 + 审计报告
├── devlog/                   开发日志 #000-#002
└── rust-vector/              Rust 向量引擎骨架
```

---

## 下一步

**Phase 2：工具协议**
- [ ] `core/tool_protocol.js` — `<<<TOOL>>>...<<<END>>>` YAML 块解析
- [ ] `core/plugin_loader.js` — 扫描 plugins/、加载 manifest
- [ ] `plugins/web_search/` — 第一个插件（联网搜索）
- [ ] chat_handler.js 增加工具调用循环（最多 5 轮）
- [ ] 调试页面支持工具调用可视化

---

*Phase 1 完成 | 2026-06-08*
