"""daily_note — 日记/记忆管理插件

纯数据传递层：不直写 SQLite，所有写入由 Node 端 memory_engine 处理。
stdin JSON: {"params": {"command":"create","title":"...","content":"...","tags":"..."}, "config": {}}
stdout JSON: {"status":"success","action":"create","id":"mem_xxx","content":"...","tags":["..."]}
"""

import sys, json, uuid


def cmd_create(params):
    title = params.get('title', '').strip()
    content = params.get('content', '').strip()
    if not title or not content:
        return {'status': 'error', 'error': 'title 和 content 不能为空'}

    tags_str = params.get('tags', '')
    tags = [t.strip() for t in tags_str.replace('，', ',').split(',') if t.strip()]

    id = 'mem_' + str(uuid.uuid4())[:8]
    return {
        'status': 'success',
        'content': f'日记已创建: {title} (id={id}, tags={",".join(tags)})',
        'data': {
            'action': 'create',
            'id': id,
            'content': content,
            'tags': tags,
        }
    }


def cmd_update(params):
    id = params.get('id', '').strip()
    content = params.get('content', '').strip()
    tags_str = params.get('tags', '')
    if not id:
        return {'status': 'error', 'error': 'id 不能为空'}

    tags = [t.strip() for t in tags_str.replace('，', ',').split(',') if t.strip()] if tags_str else None

    return {
        'status': 'success',
        'content': f'记忆已更新: {id}',
        'data': {
            'action': 'update',
            'id': id,
            'content': content or None,
            'tags': tags,
        }
    }


def execute(params, config):
    cmd = params.get('command', 'create')
    if cmd == 'update':
        return cmd_update(params)
    return cmd_create(params)


if __name__ == '__main__':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    try:
        input_data = json.loads(sys.stdin.read())
        result = execute(input_data.get('params', {}), input_data.get('config', {}))
    except Exception as e:
        result = {'status': 'error', 'error': str(e)}
    print(json.dumps(result, ensure_ascii=False))
