'use strict';

/**
 * GET /api/health — 健康检查
 *
 * 修改此文件后检查: docs/接口设计.md §4
 */

const { Router } = require('express');
const axios = require('axios');
const router = Router();
const startTime = Date.now();

router.get('/health', async (_req, res) => {
    const result = {
        status: 'ok',
        version: '1.0.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        upstream: { status: 'unknown', provider: '', latency_ms: 0 },
    };

    // 探测上游 LLM
    try {
        const m = require('../core/config').get().models;
        if (m && m.api_base && m.api_key) {
            result.upstream.provider = m.api_base.replace(/https?:\/\//, '').split('/')[0].split(':')[0];
            const t0 = Date.now();
            try {
                const r = await axios.get(m.api_base.replace(/\/$/, '') + '/models', {
                    headers: { Authorization: 'Bearer ' + m.api_key },
                    timeout: 5000,
                    validateStatus: s => s < 500,
                });
                result.upstream.latency_ms = Date.now() - t0;
                result.upstream.status = (r.status === 200) ? 'ok'
                    : (r.status === 401 || r.status === 403) ? 'auth_error' : 'error';
                if (r.status === 200) {
                    result.upstream.model_count = (r.data?.data || []).length;
                }
            } catch (e) {
                result.upstream.latency_ms = Date.now() - t0;
                result.upstream.status = 'unreachable';
                result.upstream.error = e.code === 'ETIMEDOUT' ? 'timeout' :
                    e.code === 'ECONNREFUSED' ? 'connection_refused' : e.message;
            }
        }
    } catch (_) { /* best-effort */ }

    // 插件状态
    try {
        const pl = require('../core/plugin_loader');
        result.plugins = {
            active: pl.plugins.size,
            tools: pl.getTools().length,
            internals: pl.getInternals().length,
        };
    } catch (_) { /* best-effort */ }

    // 记忆引擎状态
    try {
        const me = require('../core/memory_engine');
        result.memory = {
            ready: !!me.db,
            vector: me._vectorReady ? 'online' : 'offline',
        };
    } catch (_) { /* best-effort */ }

    res.json(result);
});

module.exports = router;
