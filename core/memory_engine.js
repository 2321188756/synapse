'use strict';

/**
 * 记忆引擎 — L1 短期上下文 + L2 向量检索 (Rust USearch) + L3 SQLite 标签记忆
 *
 * 检索策略（三层降级）：
 *   1. Rust USearch 向量语义检索（需要 rag_embedding 插件 + Rust 编译）
 *   2. 关键词扩展 + LIKE 匹配（Phase 3）
 *   3. 最近/重要记忆兜底
 *
 * 修改此文件后检查: docs/架构设计.md §3.6 | docs/记忆系统设计.md
 */

const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const database = require('./database');
const config = require('./config');
const { execute } = require('./plugin_executor');
const { child } = require('../modules/logger');
const log = child({ module: 'memory_engine' });

const VECTOR_INDEX_PATH = path.join(__dirname, '..', 'data', 'vectors.hnsw');

class MemoryEngine {
    constructor() {
        this.db = null;
        this.vectorIndex = null;   // fast-hnsw 索引实例
        this.embedder = null;      // rag_embedding 插件对象
        this._vectorReady = false;
    }

    init() {
        this.db = database.get();

        // ---- 加载 Rust 向量引擎 ----
        try {
            const { VectorIndex } = require('../rust-vector');
            const indexExists = fs.existsSync(VECTOR_INDEX_PATH);
            if (indexExists) {
                this.vectorIndex = VectorIndex.loadFromFile(VECTOR_INDEX_PATH);
                log.info('vector engine: loaded from ' + VECTOR_INDEX_PATH);
            } else {
                this.vectorIndex = new VectorIndex();
                log.info('vector engine: created new index');
            }
            this._vectorReady = true;
        } catch (e) {
            log.warn('vector engine: Rust module unavailable → keyword fallback');
            this._vectorReady = false;
        }

        // ---- 加载 RAG 嵌入插件 ----
        try {
            const pluginLoader = require('./plugin_loader');
            const internals = pluginLoader.getInternals();
            this.embedder = internals.find(p => p.manifest.name === 'rag_embedding') || null;
            if (this.embedder) {
                // 注入 embedding API 配置（从 config.yaml models.embedding + api_base/api_key）
                const cfg = config.get();
                if (cfg?.models) {
                    this.embedder.config = {
                        ...this.embedder.config,
                        model: cfg.models.embedding?.model || 'text-embedding-3-small',
                        api_base: cfg.models.api_base,
                        api_key: cfg.models.api_key,
                    };
                }
                log.info('embedder: rag_embedding ready (model=' + this.embedder.config.model + ')');
            } else {
                log.info('embedder: rag_embedding not found');
            }
        } catch (e) {
            log.warn('embedder: init failed — ' + e.message);
            this.embedder = null;
        }

        const status = this._vectorReady ? 'L1 + L2 + L3' : 'L1 + L3 (fallback)';
        log.info('memory engine ready (' + status + ')');
    }

    // ========== 写入 ==========

    /**
     * 写入一条记忆（含向量索引）
     * @param {{ content: string, summary?: string, source?: string, tags?: string[], importance?: number }} entry
     */
    remember(entry) {
        const id = 'mem_' + uuid().slice(0, 8);
        const now = new Date().toISOString();
        const tags = entry.tags || this._extractKeywords(entry.content);

        const stmt = this.db.prepare(`
            INSERT INTO memories (id, content, summary, source, tags, importance, layer, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, entry.content, entry.summary || entry.content.slice(0, 100),
            entry.source || 'conversation', JSON.stringify(tags),
            entry.importance ?? 0.5, 'l3', now);

        // 更新标签索引
        const tagStmt = this.db.prepare('INSERT OR IGNORE INTO memory_tags (tag, memory_id) VALUES (?, ?)');
        for (const tag of tags) tagStmt.run(tag, id);

        // 更新标签共现
        this._updateCoOccurrence(tags);

        log.info('memory saved: ' + id + ' (' + entry.content.slice(0, 40) + '...) tags=' + tags.join(','));

        // 异步生成向量（不阻塞返回）
        if (this._vectorReady && this.embedder) {
            this._indexVector(id, entry.content).catch(e =>
                log.warn('vector index skipped for ' + id + ': ' + e.message));
        }

        return { id, tags };
    }

    /** 异步：生成向量并写入 HNSW 索引 */
    async _indexVector(memoryId, content) {
        const vector = await this._embed(content);
        const key = this.vectorIndex.add(vector);  // fast-hnsw 返回自增 key

        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO embeddings (memory_id, key, model, dimension, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(memoryId, key,
            this.embedder.config.model || '',
            vector.length, now);

        // 持久化索引文件
        this.vectorIndex.save(VECTOR_INDEX_PATH);
        log.info('vector indexed: ' + memoryId + ' (key=' + key + ', dim=' + vector.length + ')');
    }

    /**
     * 重向量化 — daily_note 修改记忆后调用，保持向量与内容同步
     * fast-hnsw 不支持 remove，旧向量残留但新向量覆盖语义
     */
    async reindex(memoryId) {
        if (!this._vectorReady || !this.embedder) return;
        const row = this.db.prepare('SELECT content FROM memories WHERE id = ?').get(memoryId);
        if (!row) return;
        const vector = await this._embed(row.content);
        const key = this.vectorIndex.add(vector);

        // upsert embeddings 映射
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO embeddings (memory_id, key, model, dimension, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(memory_id) DO UPDATE SET key = excluded.key, model = excluded.model,
                dimension = excluded.dimension, created_at = excluded.created_at
        `).run(memoryId, key, this.embedder.config.model || '', vector.length, now);

        this.vectorIndex.save(VECTOR_INDEX_PATH);
        log.info('vector reindexed: ' + memoryId + ' (new key=' + key + ', dim=' + vector.length + ')');
    }

    // ========== 召回 ==========

    /**
     * 混合召回：向量语义检索 → 关键词检索 → 最近记忆兜底
     * @param {string} query - 用户当前消息
     * @param {number} topK - 返回条数
     */
    async recall(query, topK = 5) {
        // ---- 第一层：向量语义检索 ----
        if (this._vectorReady && this.embedder) {
            try {
                return await this._vectorRecall(query, topK);
            } catch (e) {
                log.warn('vector recall failed, fallback to keyword: ' + e.message);
            }
        }

        // ---- 第二层 + 兜底：Phase 3 关键词检索 ----
        return this._keywordRecall(query, topK);
    }

    /** 向量语义检索 */
    async _vectorRecall(query, topK) {
        const vector = await this._embed(query);
        const results = this.vectorIndex.search(vector, topK);
        if (!results || results.length === 0) {
            log.info('vector search: 0 results → keyword fallback');
            return this._keywordRecall(query, topK);
        }

        // 从 SQLite 查元数据（一次 JOIN，不用二次查询）
        const keys = results.map(r => r.key);
        const placeholders = keys.map(() => '?').join(',');
        const rows = this.db.prepare(`
            SELECT m.*, e.key as embedding_key FROM memories m
            JOIN embeddings e ON e.memory_id = m.id
            WHERE e.key IN (${placeholders})
        `).all(...keys);

        // 按向量距离排序 + 标签加权
        const keyToDist = new Map(results.map(r => [r.key, r.distance]));
        const scored = rows.map(row => {
            const dist = keyToDist.get(row.embedding_key) || 1.0;
            const vectorScore = Math.max(0, 1.0 - dist); // 余弦距离 → 相似度
            const tags = JSON.parse(row.tags || '[]');
            const daysOld = (Date.now() - new Date(row.created_at).getTime()) / 86400000;
            const timeDecay = Math.pow(0.5, daysOld / 30); // 30 天半衰期
            const score = vectorScore * 0.6 + row.importance * 0.3 + Math.min(row.recall_count / 10, 1) * 0.1;
            return { ...row, _score: score * timeDecay, _vectorScore: vectorScore };
        });

        scored.sort((a, b) => b._score - a._score);
        const top = scored.slice(0, topK);

        log.info('vector recall: ' + top.length + ' results (query=' + query.slice(0, 30) + '...)');
        this._updateRecallStats(top);
        return top.map(m => this._formatResult(m));
    }

    /** Phase 3 关键词检索（保留完整逻辑作为降级层）*/
    _keywordRecall(query, topK = 5) {
        const kwSet = new Set(this._extractKeywords(query));
        const cjk = query.match(/[一-鿿]/g) || [];
        for (const ch of cjk) kwSet.add(ch);
        if (query.length >= 2) kwSet.add(query);
        this._expandKeywords(kwSet);

        const seen = new Set();
        let rows = this._searchByKeywords([...kwSet], topK * 2);
        for (const r of rows) seen.add(r.id);

        if (rows.length < topK) {
            const recent = this._getRecentMemories(topK * 2);
            for (const r of recent) {
                if (!seen.has(r.id)) { rows.push(r); seen.add(r.id); }
                if (rows.length >= topK * 2) break;
            }
        }

        const scored = rows.map(row => {
            const tags = JSON.parse(row.tags || '[]');
            const matched = tags.filter(t => kwSet.has(t)).length;
            const daysOld = (Date.now() - new Date(row.created_at).getTime()) / 86400000;
            const timeDecay = Math.pow(0.5, daysOld / 30); // 30 天半衰期
            const score = matched * 0.4 + row.importance * 0.4 + Math.min(row.recall_count / 10, 1) * 0.2;
            return { ...row, _score: score * timeDecay };
        });

        scored.sort((a, b) => b._score - a._score);
        const top = scored.slice(0, topK);

        this._updateRecallStats(top);
        return top.map(m => this._formatResult(m));
    }

    // ========== 辅助方法 ==========

    /** 调用 rag_embedding 插件生成向量 */
    async _embed(text) {
        const result = await execute(this.embedder, { name: 'rag_embedding', params: { text } });
        if (result.status !== 'success') {
            throw new Error(result.error || 'embedding failed');
        }
        // execute() 的 normalizeResult 把 stdout JSON 对象直接展开到 result 上
        if (result.vector && Array.isArray(result.vector)) return result.vector;
        // 备用：content 字段里是 JSON 字符串
        if (typeof result.content === 'string') {
            try { const p = JSON.parse(result.content); if (p.vector) return p.vector; } catch (_) {}
            if (result.content.startsWith('[')) return JSON.parse(result.content);
        }
        throw new Error('embedding returned no vector');
    }

    /** 更新召回统计 */
    _updateRecallStats(memories) {
        const updateStmt = this.db.prepare(
            'UPDATE memories SET last_recalled_at = ?, recall_count = recall_count + 1 WHERE id = ?');
        const now = new Date().toISOString();
        for (const m of memories) updateStmt.run(now, m.id);
    }

    /** 统一输出格式 */
    _formatResult(m) {
        return {
            id: m.id, content: m.content, summary: m.summary,
            tags: JSON.parse(m.tags || '[]'), importance: m.importance,
            createdAt: m.created_at, recallCount: m.recall_count + 1,
        };
    }

    /** 关键词 LIKE 搜索 */
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

    /** 最近/重要记忆兜底 */
    _getRecentMemories(limit) {
        return this.db.prepare(`
            SELECT * FROM memories
            ORDER BY importance DESC, created_at DESC
            LIMIT ?
        `).all(limit);
    }

    /** 关键词扩展：第一人称 ↔ 第三人称 */
    _expandKeywords(kwSet) {
        const hasFirstPerson = kwSet.has('我') || kwSet.has('我的');
        const hasUser = kwSet.has('用户');
        if (hasFirstPerson && !hasUser) kwSet.add('用户');
        if (hasUser && !hasFirstPerson) kwSet.add('我');
    }

    _extractKeywords(text) {
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

    // ========== 删除 ==========

    forget(id) {
        // 清理向量映射（fast-hnsw 无 remove，仅删除 SQLite 映射，索引文件下次 save 时自然收缩）
        this.db.prepare('DELETE FROM embeddings WHERE memory_id = ?').run(id);
        this.db.prepare('DELETE FROM memory_tags WHERE memory_id = ?').run(id);
        this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
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
        const rows = this.db.prepare(
            `SELECT * FROM memories ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
            .all(...params, limit, offset);
        return rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
    }

    // ========== 更新 ==========

    modify(id, updates) {
        const fields = [];
        const params = [];
        if (updates.content !== undefined) { fields.push('content = ?'); params.push(updates.content); }
        if (updates.summary !== undefined) { fields.push('summary = ?'); params.push(updates.summary); }
        if (updates.tags !== undefined) {
            fields.push('tags = ?'); params.push(JSON.stringify(updates.tags));
            this.db.prepare('DELETE FROM memory_tags WHERE memory_id = ?').run(id);
            const tagStmt = this.db.prepare('INSERT OR IGNORE INTO memory_tags (tag, memory_id) VALUES (?, ?)');
            for (const tag of updates.tags) tagStmt.run(tag, id);
        }
        if (updates.importance !== undefined) { fields.push('importance = ?'); params.push(updates.importance); }
        if (fields.length === 0) return { id, changed: false };

        fields.push('updated_at = ?');
        params.push(new Date().toISOString());
        params.push(id);
        const result = this.db.prepare(
            `UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...params);
        log.info('memory updated: ' + id + ' (' + result.changes + ' rows)');
        return { id, changed: result.changes > 0 };
    }

    /** 生成记忆注入文本 */
    formatForContext(memories) {
        if (memories.length === 0) return '';
        return '\n## 已记录的信息\n\n以下是关于用户的信息，这些是你已经知道的，直接引用即可，不需要再搜索：\n\n' +
            memories.map(m => `- [${m.id}] ${m.content}`).join('\n') + '\n';
    }
}

module.exports = new MemoryEngine();