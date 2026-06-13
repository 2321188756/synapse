'use strict';

/**
 * Synapse — 个人 AI 中间层
 * server.js — Express 主入口
 *
 * 修改此文件后检查: docs/架构设计.md §3.1 | docs/接口设计.md
 */

// 配置由 config.yaml 加载，无需 dotenv

// ========== 依赖 ==========
const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const config = require('./core/config');
const { createLogger, queryLogs } = require('./modules/logger');

// 全局连接池（防止底层排队阻塞）
http.globalAgent.maxSockets = 10000;

// ========== 配置加载 ==========
const CONFIG = config.init();
const PORT = CONFIG.server?.port || 5890;
const HOST = CONFIG.server?.host || '0.0.0.0';
const API_KEY = CONFIG.api_key;
const DEFAULT_SYSTEM_PROMPT = CONFIG.system_prompt || '你是一个有用的 AI 助手。';

// ========== 日志初始化 ==========
const log = createLogger(CONFIG);

// ========== 插件初始化 ==========
const pluginLoader = require('./core/plugin_loader');

// 注入 embedding 配置到 RAGNova 插件（支持独立 API 地址或复用 models.api_base）
const pluginConfig = { ...(CONFIG.plugins || {}) };
if (CONFIG.models?.embedding) {
    const emb = CONFIG.models.embedding;
    pluginConfig.RAGNova = {
        model: emb.model,
        dimension: emb.dimension,
        api_base: emb.api_base || CONFIG.models.api_base,
        api_key: emb.api_key || CONFIG.models.api_key,
    };
}
pluginLoader.discover(pluginConfig);

// ========== 记忆引擎初始化 ==========
const database = require('./core/database');
database.init();
const memoryEngine = require('./core/memory_engine');
memoryEngine.init();

// Agent 系统
const agentManager = require('./core/agent_manager');
agentManager.init();

// ========== Express 初始化 ==========
const app = express();
const httpServer = http.createServer(app);

// WebSocket 服务（复用 HTTP 端口，/ws 升级）
const wsServer = require('./core/ws_server');
wsServer.init(httpServer, API_KEY);

// 中间件
app.use(cors({ origin: CONFIG.security?.cors_origins || ['*'] }));
app.use(express.json({ limit: '1mb' }));

// Request ID
app.use((req, _res, next) => {
    req.requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    req._startTime = Date.now();
    next();
});

// 请求日志中间件 — method + path + 状态码 + 耗时
app.use((req, res, next) => {
    const start = req._startTime || Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        log[level](`${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`, {
            requestId: req.requestId,
            statusCode: res.statusCode,
            duration,
        });
    });
    next();
});

// ========== 鉴权中间件 ==========

function authMiddleware(req, res, next) {
    // 健康检查不需要鉴权
    if (req.path === '/api/health') return next();

    // 日志查询接口用 Basic Auth
    if (req.path === '/api/logs') {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Basic ')) {
            return res.status(401).json({ error: { code: 'unauthorized', message: '需要管理员认证' } });
        }
        const decoded = Buffer.from(auth.slice(6), 'base64').toString();
        const [user, pass] = decoded.split(':');
        if (user === CONFIG.admin?.username && pass === CONFIG.admin?.password) {
            return next();
        }
        return res.status(401).json({ error: { code: 'unauthorized', message: '管理员凭据无效' } });
    }

    // 调试页面和相关资源不需要鉴权
    if (req.path === '/' || req.path.startsWith('/index.html') ||
        req.path.match(/\.(css|js|html|ico|svg|png|woff2?)$/)) {
        return next();
    }

    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: { code: 'unauthorized', message: '缺少 Authorization header' } });
    }
    const token = auth.slice(7);
    if (token !== API_KEY) {
        return res.status(401).json({ error: { code: 'unauthorized', message: 'API Key 无效' } });
    }
    next();
}

app.use(authMiddleware);

// ========== 路由挂载 ==========

// 静态文件 — 内置调试页面 (UTF-8, 禁用缓存)
app.use(express.static(path.join(__dirname, 'web'), {
    setHeaders: (res) => {
        var ct = res.getHeader('Content-Type');
        if (ct && ct.indexOf('charset') === -1) res.setHeader('Content-Type', ct + '; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
    }
}));

// 日志查询 — GET /api/logs?level=error&lines=100
app.get('/api/logs', (req, res) => {
    const { level, lines, requestId } = req.query;
    const result = queryLogs({
        level: level || null,
        lines: parseInt(lines, 10) || 100,
        requestId: requestId || null,
    });
    res.json({
        count: result.length,
        filter: { level: level || 'all', lines: parseInt(lines, 10) || 100 },
        logs: result,
    });
});

// API 路由
const healthRouter = require('./routes/health');
const createModelsRouter = require('./routes/models');
const createChatRouter = require('./routes/chat_handler');

const memoriesRouter = require('./routes/memories');

const pluginsRouter = require('./routes/plugins');
const configRouter = require('./routes/config');

app.use('/api', healthRouter);
app.use('/api', memoriesRouter);
app.use('/api', pluginsRouter);
app.use('/api', configRouter);
app.use('/api', require('./routes/conversations').router);
app.use('/api', require('./routes/toolboxes'));
app.use('/v1', createModelsRouter(CONFIG.models));
app.use('/v1', createChatRouter(CONFIG.models, DEFAULT_SYSTEM_PROMPT, log));

// 根路径 → 调试页面
app.get('/', (_req, res) => {
    res.redirect('/index.html');
});

// 404
app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: '端点不存在' } });
});

// 全局错误处理
app.use((err, req, res, _next) => {
    log.error(`未处理异常: ${err.message}`, { requestId: req.requestId, stack: err.stack });
    if (res.headersSent) return;
    res.status(500).json({
        error: {
            code: 'internal_error',
            message: process.env.NODE_ENV === 'production' ? '内部错误' : err.message,
            request_id: req.requestId,
        },
    });
});

// ========== 生命周期 ==========

const SERVER_LIFECYCLE = { RUNNING: 'RUNNING', DRAINING: 'DRAINING' };
let lifecycleState = SERVER_LIFECYCLE.RUNNING;

const server = httpServer.listen(PORT, HOST, () => {
    log.info(`Synapse 启动: http://${HOST}:${PORT}`);
    log.info(`  调试页: http://localhost:${PORT}/`);
    log.info(`  API:    http://localhost:${PORT}/v1/chat/completions`);
    log.info(`  日志:   http://localhost:${PORT}/api/logs`);
    log.info(`  健康:   http://localhost:${PORT}/api/health`);
});

// 优雅关闭
async function gracefulShutdown(signal) {
    if (lifecycleState !== SERVER_LIFECYCLE.RUNNING) return;
    lifecycleState = SERVER_LIFECYCLE.DRAINING;
    log.info(`收到 ${signal}，正在优雅关闭...`);

    server.close(() => {
        log.info('HTTP 服务已关闭');
        process.exit(0);
    });

    setTimeout(() => {
        log.warn('关闭超时，强制退出');
        process.exit(1);
    }, 30_000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = { app, server };
