/**
 * 迁移脚本：为所有旧记忆生成向量并写入 HNSW 索引
 * 用法: node scripts/migrate-embeddings.js
 */

const database = require('../core/database');
const config = require('../core/config');
const pluginLoader = require('../core/plugin_loader');
const { execute } = require('../core/plugin_executor');

database.init();
config.init();
pluginLoader.discover(config.get().plugins || {});

const db = database.get();
const embedder = pluginLoader.getInternals().find(p => p.manifest.name === 'RAGNova');
if (!embedder) {
    console.error('ERROR: rag_embedding plugin not found');
    process.exit(1);
}
// Inject config
const cfg = config.get();
embedder.config = {
    ...embedder.config,
    model: cfg.models?.embedding?.model || 'Qwen/Qwen3-Embedding-8B',
    api_base: cfg.models?.api_base,
    api_key: cfg.models?.api_key,
};
console.log('embedder:', embedder.config.model, '@', embedder.config.api_base);

const { VectorIndex } = require('../rust-vector');
const path = require('path');
const fs = require('fs');
const VECTOR_PATH = path.join(__dirname, '..', 'data', 'vectors.hnsw');

// 查找没有向量的记忆
const rows = db.prepare(`
    SELECT m.id, m.content FROM memories m
    LEFT JOIN embeddings e ON e.memory_id = m.id
    WHERE e.key IS NULL
`).all();

console.log(`待迁移: ${rows.length} 条`);

if (rows.length === 0) {
    console.log('没有需要迁移的记忆。');
    process.exit(0);
}

// 加载或创建索引
let vIndex;
if (fs.existsSync(VECTOR_PATH)) {
    vIndex = VectorIndex.loadFromFile(VECTOR_PATH);
    console.log('loaded existing index, size:', vIndex.size());
} else {
    vIndex = new VectorIndex();
    console.log('created new index');
}

async function migrate() {
    let done = 0;
    for (const row of rows) {
        try {
            const result = await execute(embedder, { name: 'RAGNova', params: { text: row.content } });
            if (result.status !== 'success') {
                console.error(`  FAIL ${row.id}: ${result.error}`);
                continue;
            }
            // execute() 的 normalizeResult 把 JSON 对象直接返回，vector 在顶层
            let vector = result.vector;
            if (!vector && result.content) {
                try { const p = JSON.parse(result.content); vector = p.vector; } catch (_) {}
            }
            if (!vector) { console.error(`  FAIL ${row.id}: no vector in`, JSON.stringify(result).slice(0,100)); continue; }

            const key = vIndex.add(vector);
            db.prepare('INSERT INTO embeddings (memory_id, key, model, dimension, created_at) VALUES (?,?,?,?,?)')
                .run(row.id, key, embedder.config.model, vector.length, new Date().toISOString());

            done++;
            if (done % 5 === 0) console.log(`  ${done}/${rows.length}...`);
        } catch (e) {
            console.error(`  FAIL ${row.id}: ${e.message}`);
        }
    }

    vIndex.save(VECTOR_PATH);
    console.log(`完成: ${done}/${rows.length} 条已向量化，索引已保存到 ${VECTOR_PATH}`);
}

migrate().catch(e => { console.error(e); process.exit(1); });
