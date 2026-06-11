'use strict';

/**
 * GET /v1/models — 可用模型列表
 *
 * 先从上游 API 拉取完整模型列表，排除 embedding/reranker/tts 类非对话模型，
 * 再与 config.yaml 中配置的模型合并去重。
 *
 * 修改此文件后检查: docs/接口设计.md §2.2
 */

const { Router } = require('express');
const axios = require('axios');

// 非对话模型的关键词匹配（embedding / reranker / tts 等）
const NON_CHAT_RE = /embed|bge|text-embed|ada|e5|gte|rerank|tts/i;

function createModelsRouter(modelConfig) {
    const router = Router();

    router.get('/models', async (_req, res) => {
        const seen = new Set(['auto']);
        const data = [{ id: 'auto', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'synapse' }];

        const add = name => {
            if (name && !seen.has(name)) { seen.add(name); data.push({ id: name, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'synapse' }); }
        };

        // 1. 从上游 API 拉取模型列表（自动发现 + 排除非对话模型）
        if (modelConfig?.api_base && modelConfig?.api_key) {
            try {
                const upstream = await axios.get(modelConfig.api_base.replace(/\/$/, '') + '/models', {
                    headers: { Authorization: 'Bearer ' + modelConfig.api_key },
                    timeout: 5000,
                });
                const upstreamModels = (upstream.data?.data || []).map(m => m.id);
                for (const name of upstreamModels) {
                    if (!NON_CHAT_RE.test(name)) add(name);
                }
            } catch (_) { /* 上游不可达时静默回退，不影响服务启动 */ }
        }

        // 2. 合并 config.yaml 中配置的模型（保证手动配置的模型始终可用）
        add(typeof modelConfig?.primary === 'string' ? modelConfig.primary : modelConfig?.primary?.model);
        (modelConfig?.fallback || []).forEach(f => add(typeof f === 'string' ? f : f.model));
        if (modelConfig?.routing) Object.values(modelConfig.routing).forEach(r => add(r.model));

        res.json({ object: 'list', data });
    });

    return router;
}

module.exports = createModelsRouter;
