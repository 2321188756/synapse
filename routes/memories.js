'use strict';

/**
 * 记忆管理 API — GET/POST/DELETE /api/memories
 *
 * 修改此文件后检查: docs/接口设计.md §4.5-4.7
 */

const { Router } = require('express');
const router = Router();
const database = require('../core/database');
const memoryEngine = require('../core/memory_engine');

// ensure database is initialized before use
const db = () => database.get();

router.get('/memories', (req, res) => {
    try {
        const { layer, tags, q, owner, limit, offset } = req.query;
        const result = memoryEngine.list({
            layer, tags, q, owner,
            limit: parseInt(limit, 10) || 50,
            offset: parseInt(offset, 10) || 0,
        });
        res.json({ count: result.length, memories: result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/memories/:id', (req, res) => {
    try {
        const { tags, importance } = req.body;
        const updates = {};
        if (tags !== undefined) updates.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
        if (importance !== undefined) updates.importance = parseFloat(importance);
        if (Object.keys(updates).length === 0) return res.status(400).json({ error: '无有效更新字段' });
        const result = memoryEngine.modify(req.params.id, updates);
        res.json(result);
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

// POST /api/memories/consolidate — 手动触发记忆巩固（去重 + 合并）
router.post('/memories/consolidate', (_req, res) => {
    try {
        const db = database.get();
        // 简单去重：合并内容完全相同的记忆，保留最早的，删除其余的
        const dupes = db.prepare(`
            SELECT content, COUNT(*) as cnt, MIN(id) as keep_id
            FROM memories GROUP BY content HAVING cnt > 1
        `).all();
        let removed = 0;
        for (const d of dupes) {
            const toDelete = db.prepare(
                "SELECT id FROM memories WHERE content = ? AND id != ?"
            ).all(d.content, d.keep_id);
            for (const row of toDelete) {
                memoryEngine.forget(row.id);
                removed++;
            }
        }
        res.json({ status: 'ok', duplicates_found: dupes.length, removed });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/memories/related?tag=编程 — 标签共现分析
router.get('/memories/related', (req, res) => {
    try {
        const tag = req.query.tag;
        if (!tag) return res.status(400).json({ error: '需要 tag 参数' });
        const db = database.get();
        const rows = db.prepare(`
            SELECT tag_b as tag, weight FROM tag_co_occurrence WHERE tag_a = ?
            UNION
            SELECT tag_a as tag, weight FROM tag_co_occurrence WHERE tag_b = ?
            ORDER BY weight DESC LIMIT 10
        `).all(tag, tag);
        res.json({ tag, related: rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
