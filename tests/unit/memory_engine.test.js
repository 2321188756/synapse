'use strict';

// 使用内存数据库进行测试
const Database = require('better-sqlite3');

let db, me;

beforeEach(() => {
    jest.resetModules();
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');

    // 建表
    db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY, content TEXT NOT NULL, summary TEXT DEFAULT '',
            source TEXT DEFAULT 'conversation', tags TEXT DEFAULT '[]',
            importance REAL DEFAULT 0.5, layer TEXT DEFAULT 'l3',
            created_at TEXT NOT NULL, last_recalled_at TEXT,
            recall_count INTEGER DEFAULT 0, updated_at TEXT
        )
    `);
    db.exec(`CREATE TABLE IF NOT EXISTS memory_tags (tag TEXT NOT NULL, memory_id TEXT NOT NULL, PRIMARY KEY (tag, memory_id))`);
    db.exec(`CREATE TABLE IF NOT EXISTS tag_co_occurrence (tag_a TEXT NOT NULL, tag_b TEXT NOT NULL, weight REAL DEFAULT 1.0, last_updated TEXT NOT NULL, PRIMARY KEY (tag_a, tag_b))`);
    db.exec(`CREATE TABLE IF NOT EXISTS embeddings (memory_id TEXT PRIMARY KEY, key INTEGER UNIQUE NOT NULL, model TEXT, dimension INTEGER, created_at TEXT)`);

    jest.mock('../../core/config', () => ({
        init: () => ({}),
        get: () => ({ models: { embedding: { model: 'test', dimension: 128 } } }),
    }));
    jest.mock('../../core/plugin_loader', () => ({
        getInternals: () => [],
    }));
    jest.mock('../../modules/logger', () => ({
        child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
    }));

    const database = require('../../core/database');
    database.init = () => db;
    database.get = () => db;
    jest.doMock('../../core/database', () => database);
    jest.doMock('../rust-vector', () => ({}), { virtual: true });

    me = require('../../core/memory_engine');
    me.db = db;
    me._vectorReady = false;
});

describe('memory_engine', () => {
    describe('remember', () => {
        test('writes a memory to db', () => {
            const result = me.remember({ content: 'test content', tags: ['标签1'] });
            expect(result.id).toMatch(/^mem_/);

            const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(result.id);
            expect(row.content).toBe('test content');
            expect(row.layer).toBe('l3');
            expect(row.importance).toBe(0.5);
            expect(JSON.parse(row.tags)).toEqual(['标签1']);
        });

        test('auto-generates tags from content', () => {
            const result = me.remember({ content: '用户喜欢蓝色和绿色' });
            const row = db.prepare('SELECT tags FROM memories WHERE id = ?').get(result.id);
            const tags = JSON.parse(row.tags);
            expect(tags.length).toBeGreaterThan(0);
        });

        test('with custom importance', () => {
            const result = me.remember({ content: 'important', importance: 0.9 });
            const row = db.prepare('SELECT importance FROM memories WHERE id = ?').get(result.id);
            expect(row.importance).toBe(0.9);
        });
    });

    describe('modify', () => {
        test('updates content', () => {
            const { id } = me.remember({ content: 'original' });
            const result = me.modify(id, { content: 'updated' });
            expect(result.changed).toBe(true);

            const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
            expect(row.content).toBe('updated');
            expect(row.updated_at).toBeTruthy();
        });

        test('updates tags', () => {
            const { id } = me.remember({ content: 'test', tags: ['旧标签'] });
            me.modify(id, { tags: ['新标签'] });

            const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
            expect(JSON.parse(row.tags)).toEqual(['新标签']);
        });

        test('returns changed:false when no fields', () => {
            const { id } = me.remember({ content: 'test' });
            const result = me.modify(id, {});
            expect(result.changed).toBe(false);
        });
    });

    describe('forget', () => {
        test('deletes memory', () => {
            const { id } = me.remember({ content: 'to delete' });
            expect(db.prepare('SELECT COUNT(*) as c FROM memories').get().c).toBe(1);
            me.forget(id);
            expect(db.prepare('SELECT COUNT(*) as c FROM memories').get().c).toBe(0);
        });
    });

    describe('recall', () => {
        test('returns keyword matches', async () => {
            me.remember({ content: '用户叫小王', tags: ['用户信息'] });
            me.remember({ content: '喜欢蓝色', tags: ['偏好'] });
            me.remember({ content: 'Python开发者', tags: ['技能'] });

            const results = await me.recall('用户叫什么');
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].content).toBeDefined();
            expect(results[0].tags).toBeDefined();
        });

        test('expansion: 我 → 用户', async () => {
            me.remember({ content: '用户住在北京', tags: ['地点'] });
            const results = await me.recall('我在哪里');
            expect(results.length).toBeGreaterThan(0);
        });
    });

    describe('list', () => {
        test('returns all memories', () => {
            me.remember({ content: 'memory 1' });
            me.remember({ content: 'memory 2' });
            const result = me.list();
            expect(result.length).toBe(2);
        });

        test('filters by tags', () => {
            me.remember({ content: 'a', tags: ['X'] });
            me.remember({ content: 'b', tags: ['Y'] });
            const result = me.list({ tags: 'X' });
            expect(result.length).toBe(1);
            expect(result[0].content).toBe('a');
        });

        test('filters by keyword', () => {
            me.remember({ content: 'hello world' });
            me.remember({ content: 'goodbye' });
            const result = me.list({ q: 'hello' });
            expect(result.length).toBe(1);
        });

        test('respects limit and offset', () => {
            for (let i = 0; i < 10; i++) me.remember({ content: 'mem ' + i });
            expect(me.list({ limit: 3 }).length).toBe(3);
            expect(me.list({ limit: 3, offset: 3 }).length).toBe(3);
        });
    });

    describe('formatForContext', () => {
        test('formats memories for system prompt', () => {
            const result = me.formatForContext([
                { id: 'mem_a', content: '用户叫小王' },
            ]);
            expect(result).toContain('已记录的信息');
            expect(result).toContain('[mem_a] 用户叫小王');
        });

        test('empty array returns empty string', () => {
            expect(me.formatForContext([])).toBe('');
        });
    });

    describe('_extractKeywords', () => {
        test('extracts Chinese and English words', () => {
            const keywords = me._extractKeywords('用户喜欢Python编程');
            expect(keywords).toEqual(expect.arrayContaining(['Python']));
            expect(keywords.some(k => k.includes('喜欢'))).toBe(true);
        });
    });
});
