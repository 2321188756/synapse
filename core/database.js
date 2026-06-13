'use strict';

/**
 * SQLite 初始化 + 建表
 * Phase 3: L3 长期记忆表 + 标签索引
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'memory.db');
let db = null;

function init() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // 长期记忆主表
    db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            summary TEXT DEFAULT '',
            source TEXT DEFAULT 'conversation',
            tags TEXT DEFAULT '[]',
            importance REAL DEFAULT 0.5,
            layer TEXT DEFAULT 'l3',
            created_at TEXT NOT NULL,
            last_recalled_at TEXT,
            recall_count INTEGER DEFAULT 0
        )
    `);

    // 标签索引
    db.exec(`
        CREATE TABLE IF NOT EXISTS memory_tags (
            tag TEXT NOT NULL,
            memory_id TEXT NOT NULL,
            PRIMARY KEY (tag, memory_id),
            FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        )
    `);

    // 标签共现
    db.exec(`
        CREATE TABLE IF NOT EXISTS tag_co_occurrence (
            tag_a TEXT NOT NULL,
            tag_b TEXT NOT NULL,
            weight REAL DEFAULT 1.0,
            last_updated TEXT NOT NULL,
            PRIMARY KEY (tag_a, tag_b)
        )
    `);

    // 迁移：添加 updated_at 列（Phase 3.1 记忆更新功能）
    try { db.exec(`ALTER TABLE memories ADD COLUMN updated_at TEXT`); } catch (_) { /* 列已存在 */ }
    // Phase 11: Agent 记忆隔离
    try { db.exec(`ALTER TABLE memories ADD COLUMN owner TEXT DEFAULT 'Nova'`); } catch (_) { /* 列已存在 */ }
    try { db.exec(`ALTER TABLE conversations ADD COLUMN owner TEXT DEFAULT 'Nova'`); } catch (_) { /* 列已存在 */ }

    // 向量索引表（Phase 4: 关联 USearch 索引 key 与记忆 ID）
    db.exec(`
        CREATE TABLE IF NOT EXISTS embeddings (
            memory_id TEXT PRIMARY KEY,
            key INTEGER UNIQUE NOT NULL,
            model TEXT NOT NULL DEFAULT '',
            dimension INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_embeddings_key ON embeddings(key)`);

    // 对话历史表（Phase 10）
    db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT DEFAULT '',
            messages TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC)`);

    // 索引
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories(tags)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC)`);

    return db;
}

function get() {
    if (!db) throw new Error('database not initialized — call init() first');
    return db;
}

module.exports = { init, get };