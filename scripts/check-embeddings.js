const db = require('../core/database');
db.init();
const rows = db.get().prepare(`
  SELECT m.id, substr(m.content,1,60) as content, m.created_at,
         e.key, e.model, e.dimension, e.created_at as embedded_at
  FROM memories m
  LEFT JOIN embeddings e ON e.memory_id = m.id
  ORDER BY m.created_at DESC
`).all();

console.log('记忆向量化状态 (' + rows.length + ' 条):\n');
rows.forEach(r => {
  const hasVec = r.key !== null ? '✅' : '❌ 未向量化';
  console.log(hasVec, r.id, '|', (r.created_at||'').slice(0,19), '|', r.content);
  if (r.key !== null) {
    console.log('   key=' + r.key + ' dim=' + r.dimension + ' model=' + r.model + ' embedded=' + (r.embedded_at||'').slice(0,19));
  }
});
