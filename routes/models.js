'use strict';

/**
 * GET /v1/models — 可用模型列表
 *
 * 修改此文件后检查: docs/接口设计.md §2.2
 */

const { Router } = require('express');
const router = Router();

function createModelsRouter(modelConfig) {
    router.get('/models', (_req, res) => {
        const data = [{ id: 'auto', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'synapse' }];
        const seen = new Set(['auto']);

        const add = name => { if (name && !seen.has(name)) { seen.add(name); data.push({ id: name, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'synapse' }); } };

        add(typeof modelConfig?.primary === 'string' ? modelConfig.primary : modelConfig?.primary?.model);
        (modelConfig?.fallback || []).forEach(f => add(typeof f === 'string' ? f : f.model));
        if (modelConfig?.routing) Object.values(modelConfig.routing).forEach(r => add(r.model));

        res.json({ object: 'list', data });
    });
    return router;
}

module.exports = createModelsRouter;
