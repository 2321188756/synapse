'use strict';

/**
 * 记忆管理 API — GET/POST/DELETE /api/memories
 *
 * 修改此文件后检查: docs/接口设计.md §4.5-4.7
 */

const { Router } = require('express');
const router = Router();
const memoryEngine = require('../core/memory_engine');

router.get('/memories', (req, res) => {
    try {
        const { layer, tags, q, limit, offset } = req.query;
        const result = memoryEngine.list({
            layer, tags, q,
            limit: parseInt(limit, 10) || 50,
            offset: parseInt(offset, 10) || 0,
        });
        res.json({ count: result.length, memories: result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/memories/:id', (req, res) => {
    try {
        memoryEngine.forget(req.params.id);
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
