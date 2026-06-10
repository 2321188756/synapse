"""daily_note — 日记/记忆管理插件

stdin JSON: {"params": {"command":"create","title":"...","content":"...","tags":"..."}, "config": {}}
stdout JSON: {"status":"success","content":"..."}
"""

import sys, json, os, sqlite3, uuid
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'memory.db')

def ensure_db():
    if not os.path.exists(DB_PATH):
        return None
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def cmd_create(params):
    title = params.get('title', '').strip()
    content = params.get('content', '').strip()
    if not title or not content:
        return {'status': 'error', 'error': 'title 和 content 不能为空'}

    tags_str = params.get('tags', '')
    tags = [t.strip() for t in tags_str.replace('，', ',').split(',') if t.strip()]

    conn = ensure_db()
    if not conn:
        return {'status': 'error', 'error': '记忆数据库未初始化，请先启动服务'}

    id = 'mem_' + str(uuid.uuid4())[:8]
    now = datetime.now().isoformat()
    conn.execute('''INSERT INTO memories (id, content, summary, source, tags, importance, layer, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'l3', ?)''',
                 (id, content, content[:100], 'ai_generated', json.dumps(tags), 0.5, now))
    for tag in tags:
        conn.execute('INSERT OR IGNORE INTO memory_tags (tag, memory_id) VALUES (?, ?)', (tag, id))
    conn.commit()
    conn.close()
    return {'status': 'success', 'content': f'日记已创建: {title} (id={id}, tags={",".join(tags)})', 'data': {'id': id, 'tags': tags}}

def cmd_update(params):
    id = params.get('id', '').strip()
    title = params.get('title', '').strip()
    content = params.get('content', '').strip()
    if not id:
        return {'status': 'error', 'error': 'id 不能为空，请从上下文中已记录的信息获取'}

    conn = ensure_db()
    if not conn:
        return {'status': 'error', 'error': '记忆数据库未初始化'}

    row = conn.execute('SELECT * FROM memories WHERE id = ?', (id,)).fetchone()
    if not row:
        conn.close()
        return {'status': 'error', 'error': f'未找到记忆 {id}'}

    now = datetime.now().isoformat()
    # 更新 content 和 summary
    if content:
        conn.execute('UPDATE memories SET content = ?, summary = ?, updated_at = ? WHERE id = ?',
                     (content, content[:100], now, id))
    # 更新 tags
    tags_str = params.get('tags', '')
    if tags_str:
        tags = [t.strip() for t in tags_str.replace('，', ',').split(',') if t.strip()]
        conn.execute('UPDATE memories SET tags = ?, updated_at = ? WHERE id = ?',
                     (json.dumps(tags), now, id))
        # 重建标签索引
        conn.execute('DELETE FROM memory_tags WHERE memory_id = ?', (id,))
        for tag in tags:
            conn.execute('INSERT OR IGNORE INTO memory_tags (tag, memory_id) VALUES (?, ?)', (tag, id))

    conn.commit()
    conn.close()
    return {'status': 'success', 'content': f'记忆已更新: {id}', 'data': {'id': id}}

# TODO Phase 4+: expose search/list commands in manifest enum, then route here
def cmd_search(params):
    query = params.get('query', '').strip()
    limit = min(params.get('limit', 10), 50)

    conn = ensure_db()
    if not conn:
        return {'status': 'error', 'error': '记忆数据库未初始化'}

    rows = conn.execute(
        'SELECT * FROM memories WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?',
        (f'%{query}%', limit)
    ).fetchall()
    conn.close()

    if not rows:
        return {'status': 'success', 'content': f'未找到与 "{query}" 相关的日记。'}

    lines = [f'搜索 "{query}" 的结果 ({len(rows)} 条):']
    for r in rows:
        tags = json.loads(r['tags']) if r['tags'] else []
        lines.append(f"\n### {r['summary'][:80]}")
        lines.append(f"标签: {', '.join(tags)} | 时间: {r['created_at'][:10]}")
        lines.append(r['content'][:500])
    return {'status': 'success', 'content': '\n'.join(lines), 'data': [dict(r) for r in rows]}

def cmd_list(params):
    limit = min(params.get('limit', 10), 50)
    conn = ensure_db()
    if not conn:
        return {'status': 'error', 'error': '记忆数据库未初始化'}

    rows = conn.execute('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?', (limit,)).fetchall()
    conn.close()

    if not rows:
        return {'status': 'success', 'content': '暂无日记记录。'}

    lines = [f'最近 {len(rows)} 条日记:']
    for r in rows:
        tags = json.loads(r['tags']) if r['tags'] else []
        lines.append(f"- [{r['created_at'][:10]}] {r['summary'][:80]} ({', '.join(tags[:5])})")
    return {'status': 'success', 'content': '\n'.join(lines), 'data': [dict(r) for r in rows]}

def execute(params, config):
    cmd = params.get('command', 'create')
    if cmd == 'update':
        return cmd_update(params)
    return cmd_create(params)

if __name__ == '__main__':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    input_data = json.loads(sys.stdin.read())
    result = execute(input_data.get('params', {}), input_data.get('config', {}))
    print(json.dumps(result, ensure_ascii=False))
