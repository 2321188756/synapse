'use strict';

/**
 * 记忆引擎 — L1 短期上下文 + L3 SQLite 标签记忆
 * L2 向量检索留给 Phase 4 (Rust USearch)
 *
 * 修改此文件后检查: docs/架构设计.md §3.6 | docs/记忆系统设计.md
 */

const { v4: uuid } = require('uuid');
const database = require('./database');
const { child } = require('../modules/logger');
const log = child({ module: 'memory_engine' });

class MemoryEngine {
    constructor() {
        this.db = null;
    }

    init() {
        this.db = database.get();
        log.info('memory engine ready (L1 + L3)');
    }

    // ========== 写入 ==========

    /**
     * 写入一条记忆
     * @param {{ content: string, summary?: string, source?: string, tags?: string[], importance?: number }} entry
     */
    remember(entry) {
        const id = 'mem_' + uuid().slice(0, 8);
        const now = new Date().toISOString();
        const tags = entry.tags || this._extractKeywords(entry.content);

        const stmt = this.db.prepare(`
            INSERT INTO memories (id, content, summary, source, tags, importance, layer, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'l3', ?)
        `);
        stmt.run(id, entry.content, entry.summary || entry.content.slice(0, 100),
            entry.source || 'conversation', JSON.stringify(tags),
            entry.importance ?? 0.5, now);

        // 更新标签索引
        const tagStmt = this.db.prepare('INSERT OR IGNORE INTO memory_tags (tag, memory_id) VALUES (?, ?)');
        for (const tag of tags) {
            tagStmt.run(tag, id);
        }

        // 更新标签共现
        this._updateCoOccurrence(tags);

        log.info('memory saved: ' + id + ' (' + entry.content.slice(0, 40) + '...) tags=' + tags.join(','));
        return { id, tags };
    }

    // ========== 召回 ==========

    /**
     * 混合召回: 关键词匹配 + 最近记忆兜底 + 时间衰减
     *
     * 两层策略：
     *   1. 关键词搜索（扩展后的关键词 LIKE 匹配 tags + content）
     *   2. 召回不足 topK 时 → 用最近记忆/高重要度记忆兜底
     * 两层结果合并去重后评分排序，取 topK。
     *
     * @param {string} query - 用户当前消息
     * @param {number} topK - 返回条数
     */
    recall(query, topK = 5) {
        const kwSet = new Set(this._extractKeywords(query));
        // 中文单字兜底：拆所有 CJK 单字搜索
        const cjk = query.match(/[一-鿿]/g) || [];
        for (const ch of cjk) kwSet.add(ch);
        if (query.length >= 2) kwSet.add(query);

        // 关键词扩展：AI 用第三人称（"用户"）记录，用户用第一人称（"我"）提问
        this._expandKeywords(kwSet);

        // ---- 第一层：关键词搜索 ----
        const seen = new Set();
        let rows = this._searchByKeywords([...kwSet], topK * 2);
        for (const r of rows) seen.add(r.id);

        // ---- 第二层：召回不足时用最近/重要记忆兜底 ----
        if (rows.length < topK) {
            const recent = this._getRecentMemories(topK * 2);
            for (const r of recent) {
                if (!seen.has(r.id)) {
                    rows.push(r);
                    seen.add(r.id);
                }
                if (rows.length >= topK * 2) break;
            }
        }

        // ---- 评分排序 ----
        const scored = rows.map(row => {
            const tags = JSON.parse(row.tags || '[]');
            const matched = tags.filter(t => kwSet.has(t)).length;
            const daysOld = (Date.now() - new Date(row.created_at).getTime()) / 86400000;
            const timeDecay = Math.pow(0.5, daysOld / 7);
            const score = matched * 0.4 + row.importance * 0.4 + Math.min(row.recall_count / 10, 1) * 0.2;
            return { ...row, _score: score * timeDecay };
        });

        scored.sort((a, b) => b._score - a._score);
        const top = scored.slice(0, topK);

        // 更新召回统计
        const updateStmt = this.db.prepare('UPDATE memories SET last_recalled_at = ?, recall_count = recall_count + 1 WHERE id = ?');
        const now = new Date().toISOString();
        for (const m of top) {
            updateStmt.run(now, m.id);
        }

        return top.map(m => ({
            id: m.id, content: m.content, summary: m.summary,
            tags: JSON.parse(m.tags || '[]'), importance: m.importance,
            createdAt: m.created_at, recallCount: m.recall_count + 1,
        }));
    }

    /** 关键词 LIKE 搜索（关键词为空时直接返回 []） */
    _searchByKeywords(keywords, limit) {
        if (keywords.length === 0) return [];
        const likeClauses = keywords.map(() => '(tags LIKE ? OR content LIKE ?)').join(' OR ');
        const params = keywords.flatMap(k => ['%' + k + '%', '%' + k + '%']);
        return this.db.prepare(`
            SELECT * FROM memories
            WHERE ${likeClauses}
            ORDER BY importance DESC, recall_count DESC, created_at DESC
            LIMIT ?
        `).all(...params, limit);
    }

    /** 最近/重要记忆兜底（按 importance DESC, created_at DESC） */
    _getRecentMemories(limit) {
        return this.db.prepare(`
            SELECT * FROM memories
            ORDER BY importance DESC, created_at DESC
            LIMIT ?
        `).all(limit);
    }

    /**
     * 关键词扩展：桥接用户第一人称 ↔ AI 第三人称
     * - 用户说"我"/"我的" → 补充搜索"用户"（AI 记录中的主语）
     * - 反之亦然
     */
    _expandKeywords(kwSet) {
        const hasFirstPerson = kwSet.has('我') || kwSet.has('我的');
        const hasUser = kwSet.has('用户');
        if (hasFirstPerson && !hasUser) kwSet.add('用户');
        if (hasUser && !hasFirstPerson) kwSet.add('我');
    }

    // ========== 删除 ==========

    forget(id) {
        this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
        this.db.prepare('DELETE FROM memory_tags WHERE memory_id = ?').run(id);
        log.info('memory deleted: ' + id);
    }

    // ========== 查询 ==========

    list({ layer, tags, q, limit = 50, offset = 0 } = {}) {
        const conditions = [];
        const params = [];
        if (layer) { conditions.push('layer = ?'); params.push(layer); }
        if (tags) {
            const tagList = tags.split(',');
            conditions.push('(' + tagList.map(() => 'tags LIKE ?').join(' OR ') + ')');
            tagList.forEach(t => params.push('%' + t.trim() + '%'));
        }
        if (q) { conditions.push('content LIKE ?'); params.push('%' + q + '%'); }
        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const rows = this.db.prepare(`SELECT * FROM memories ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
            .all(...params, limit, offset);
        return rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
    }

    // ========== 工具 ==========

    _extractKeywords(text) {
        // 简单分词：中文字符 + 英文单词
        const cn = text.match(/[一-鿿]{2,}/g) || [];
        const en = text.match(/[a-zA-Z]{3,}/g) || [];
        return [...new Set([...cn, ...en])].slice(0, 10);
    }

    _updateCoOccurrence(tags) {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
            INSERT INTO tag_co_occurrence (tag_a, tag_b, weight, last_updated)
            VALUES (?, ?, 1.0, ?)
            ON CONFLICT(tag_a, tag_b) DO UPDATE SET weight = weight + 0.5, last_updated = ?
        `);
        for (let i = 0; i < tags.length; i++) {
            for (let j = i + 1; j < tags.length; j++) {
                const [a, b] = tags[i] < tags[j] ? [tags[i], tags[j]] : [tags[j], tags[i]];
                stmt.run(a, b, now, now);
            }
        }
    }

    /** 更新已有记忆 */
    modify(id, updates) {
        const fields = [];
        const params = [];
        if (updates.content !== undefined) { fields.push('content = ?'); params.push(updates.content); }
        if (updates.summary !== undefined) { fields.push('summary = ?'); params.push(updates.summary); }
        if (updates.tags !== undefined) {
            fields.push('tags = ?');
            params.push(JSON.stringify(updates.tags));
            // 更新标签索引：先删后插
            this.db.prepare('DELETE FROM memory_tags WHERE memory_id = ?').run(id);
            const tagStmt = this.db.prepare('INSERT OR IGNORE INTO memory_tags (tag, memory_id) VALUES (?, ?)');
            for (const tag of updates.tags) { tagStmt.run(tag, id); }
        }
        if (updates.importance !== undefined) { fields.push('importance = ?'); params.push(updates.importance); }
        if (fields.length === 0) return { id, changed: false };

        fields.push('updated_at = ?');
        params.push(new Date().toISOString());
        params.push(id);
        const result = this.db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...params);
        log.info('memory updated: ' + id + ' (' + result.changes + ' rows)');
        return { id, changed: result.changes > 0 };
    }

    /** 生成记忆注入文本（注入 system prompt 的格式）*/
    formatForContext(memories) {
        if (memories.length === 0) return '';
        return '\n## 已记录的信息\n\n以下是关于用户的信息，这些是你已经知道的，直接引用即可，不需要再搜索：\n\n' +
            memories.map(m =>
                `- [${m.id}] ${m.content}`
            ).join('\n') + '\n';
    }
}

module.exports = new MemoryEngine();