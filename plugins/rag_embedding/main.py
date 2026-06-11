"""rag_embedding — Embedding API 调用插件 (type: internal)

由 memory_engine.js 通过 plugin_executor 调用，不走工具协议。
stdin JSON: {"text": "要向量化的文本"}
stdout JSON: {"status":"success","vector":[0.123, ...]} 或 {"status":"error","error":"..."}
"""

import sys
import json
import os
import io
import httpx


def get_config():
    """配置从 stdin 传入的 config 字段读取，优先用 config.yaml models.embedding"""
    input_data = json.loads(sys.stdin.read())
    params = input_data.get("params", {})
    config = input_data.get("config", {})
    text = params.get("text", "").strip()

    if not text:
        return None, None, "text 不能为空"

    # 从 config 获取模型和 API 信息
    model = config.get("model", "text-embedding-3-small")

    # API 地址优先从 config 传入，否则用环境变量
    api_base = config.get("api_base", "") or os.environ.get("EMBEDDING_API_BASE", "")
    api_key = config.get("api_key", "") or os.environ.get("EMBEDDING_API_KEY", "")

    if not api_base or not api_key:
        return None, None, "缺少 embedding API 配置 (api_base/api_key)"

    return text, {"model": model, "api_base": api_base.rstrip("/"), "api_key": api_key}, None


def embed(text, cfg):
    """调用 OpenAI 兼容 Embedding API"""
    url = f"{cfg['api_base']}/embeddings"
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }
    body = {"model": cfg["model"], "input": text}

    resp = httpx.post(url, json=body, headers=headers, timeout=30.0)
    if resp.status_code != 200:
        # 尝试从错误响应中提取信息
        try:
            detail = resp.json().get("error", {}).get("message", resp.text[:200])
        except Exception:
            detail = resp.text[:200]
        return {"status": "error", "error": f"Embedding API error ({resp.status_code}): {detail}"}

    data = resp.json()
    vector = data.get("data", [{}])[0].get("embedding", [])
    if not vector:
        return {"status": "error", "error": "API 返回的 embedding 为空"}

    return {"status": "success", "vector": vector, "dimension": len(vector)}


if __name__ == "__main__":
    # Windows 控制台编码修复
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

    text, cfg, err = get_config()
    if err:
        print(json.dumps({"status": "error", "error": err}, ensure_ascii=False))
        sys.exit(0)

    result = embed(text, cfg)
    print(json.dumps(result, ensure_ascii=False))
