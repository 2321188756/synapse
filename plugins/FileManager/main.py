"""file_manager — 安全文件管理插件

路径穿越防护：所有操作限定在 root_path 内（默认 data/files/）。
"""

import sys, json, os, io


def safe_path(root, user_path):
    """解析路径并验证在 root 内，拒绝 ../ 穿越"""
    # 规范化路径
    full = os.path.normpath(os.path.join(root, user_path.lstrip("/\\")))
    root_norm = os.path.normpath(root)
    if not full.startswith(root_norm):
        return None
    return full


def cmd_read(root, params):
    path = params.get("path", "").strip()
    if not path:
        return {"status": "error", "error": "path 不能为空"}

    safe = safe_path(root, path)
    if not safe:
        return {"status": "error", "error": "路径不允许（不能访问上层目录）"}

    if not os.path.exists(safe):
        return {"status": "error", "error": f"文件不存在: {path}（如需创建请用 command: write）"}

    try:
        with open(safe, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        return {"status": "error", "error": str(e)}

    return {
        "status": "success",
        "action": "read",
        "content": content,
        "data": {"path": path, "size": len(content)}
    }


def cmd_write(root, params):
    path = params.get("path", "").strip()
    content = params.get("content", "")
    if not path:
        return {"status": "error", "error": "path 不能为空"}

    safe = safe_path(root, path)
    if not safe:
        return {"status": "error", "error": "路径不允许"}

    os.makedirs(os.path.dirname(safe), exist_ok=True)

    try:
        with open(safe, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception as e:
        return {"status": "error", "error": str(e)}

    return {
        "status": "success",
        "action": "write",
        "content": f"文件已写入: {path} ({len(content)} 字符)",
        "data": {"path": path, "size": len(content)}
    }


def cmd_list(root, params):
    path = params.get("path", "").strip() or "."
    safe = safe_path(root, path)
    if not safe:
        return {"status": "error", "error": "路径不允许"}

    if not os.path.exists(safe):
        return {"status": "error", "error": f"目录不存在: {path}"}

    try:
        entries = []
        for name in sorted(os.listdir(safe)):
            full = os.path.join(safe, name)
            entry = {"name": name, "type": "dir" if os.path.isdir(full) else "file"}
            if os.path.isfile(full):
                entry["size"] = os.path.getsize(full)
            entries.append(entry)
    except Exception as e:
        return {"status": "error", "error": str(e)}

    return {
        "status": "success",
        "action": "list",
        "content": f"目录 {path}: {len(entries)} 项\n" +
                   "\n".join(f"  {'[D]' if e['type']=='dir' else '[F]'} {e['name']}" +
                             (f" ({e['size']}B)" if e.get('size') else "")
                             for e in entries),
        "data": {"path": path, "entries": entries}
    }


def cmd_delete(root, params):
    path = params.get("path", "").strip()
    if not path:
        return {"status": "error", "error": "path 不能为空"}

    safe = safe_path(root, path)
    if not safe:
        return {"status": "error", "error": "路径不允许"}

    if not os.path.exists(safe):
        return {"status": "error", "error": f"文件不存在: {path}"}

    try:
        os.remove(safe)
    except Exception as e:
        return {"status": "error", "error": str(e)}

    return {
        "status": "success",
        "action": "delete",
        "content": f"文件已删除: {path}",
        "data": {"path": path}
    }


def execute(params, config):
    root = config.get("root_path", "data/files")
    # 转为绝对路径（相对于项目根目录）
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    abs_root = os.path.join(project_root, root)

    cmd = params.get("command", "read" if params.get("path") and not params.get("content") else "write")
    if cmd == "write":
        return cmd_write(abs_root, params)
    elif cmd == "list":
        return cmd_list(abs_root, params)
    elif cmd == "delete":
        return cmd_delete(abs_root, params)
    return cmd_read(abs_root, params)


if __name__ == "__main__":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    input_data = json.loads(sys.stdin.read())
    result = execute(input_data.get("params", {}), input_data.get("config", {}))
    print(json.dumps(result, ensure_ascii=False))
