'use strict';

/**
 * 对话管理 API — GET /api/conversations, GET/DELETE /api/conversations/:id
 *
 * 修改此文件后检查: docs/接口设计.md §4
 */

const { Router } = require('express');
const { v4: uuid } = require('uuid');
const router = Router();
const database = require('../core/database');

// GET 列表
router.get('/conversations', (_req, res) => {
    try {
        const db = database.get();
        const rows = db.prepare(
            'SELECT id, title, created_at, updated_at, length(messages) as msg_len FROM conversations ORDER BY updated_at DESC LIMIT 50'
        ).all();
        res.json({ count: rows.length, conversations: rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET 单条
router.get('/conversations/:id', (req, res) => {
    try {
        const db = database.get();
        const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
        if (!row) return res.status(404).json({ error: '对话不存在' });
        row.messages = JSON.parse(row.messages);
        res.json(row);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE
router.delete('/conversations/:id', (req, res) => {
    try {
        const db = database.get();
        db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 内部用：保存对话
function saveConversation(id, title, messages) {
    const db = database.get();
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id);
    if (existing) {
        db.prepare('UPDATE conversations SET title=?, messages=?, updated_at=? WHERE id=?')
            .run(title.slice(0, 100), JSON.stringify(messages), now, id);
    } else {
        db.prepare('INSERT INTO conversations (id, title, messages, created_at, updated_at) VALUES (?,?,?,?,?)')
            .run(id, title.slice(0, 100), JSON.stringify(messages), now, now);
    }
    return id;
}

module.exports = { router, saveConversation };
