"""web_search — 联网搜索插件 (Tavily API)

stdin JSON: {"params": {"query": "...", "max_results": 5}, "config": {"TAVILY_API_KEY": "..."}}
stdout JSON: {"status": "success", "content": "...", "data": [...]}
"""

import sys
import json
import os

try:
    import httpx
except ImportError:
    import urllib.request
    import urllib.error

TAVILY_URL = "https://api.tavily.com/search"


def search_with_httpx(query, max_results, api_key):
    """使用 httpx 调用 Tavily API"""
    resp = httpx.post(
        TAVILY_URL,
        json={"query": query, "max_results": max_results, "api_key": api_key},
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()


def search_with_urllib(query, max_results, api_key):
    """使用标准库 urllib 调用 Tavily API (无 httpx 时的回退)"""
    data = json.dumps({"query": query, "max_results": max_results, "api_key": api_key}).encode()
    req = urllib.request.Request(TAVILY_URL, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def format_results(data):
    """将 Tavily 返回结果格式化为 AI 可读的文本"""
    results = data.get("results", [])
    if not results:
        return "未找到相关结果。"

    lines = []
    for i, r in enumerate(results, 1):
        title = r.get("title", "无标题")
        url = r.get("url", "")
        content = r.get("content", "")[:300]
        lines.append(f"{i}. **{title}**")
        if url:
            lines.append(f"   {url}")
        lines.append(f"   {content}")
        lines.append("")
    return "\n".join(lines)


def execute(params, config):
    query = params.get("query", "").strip()
    if not query:
        return {"status": "error", "error": "搜索关键词不能为空"}

    max_results = min(params.get("max_results", 5), 10)
    api_key = config.get("TAVILY_API_KEY") or os.environ.get("TAVILY_API_KEY")
    if not api_key:
        return {"status": "error", "error": "未配置 TAVILY_API_KEY。请在 config.yaml 的 plugins.web_search 中设置。"}

    try:
        try:
            import httpx
            data = search_with_httpx(query, max_results, api_key)
        except (ImportError, Exception):
            data = search_with_urllib(query, max_results, api_key)
    except Exception as e:
        return {"status": "error", "error": f"搜索失败: {str(e)}"}

    return {
        "status": "success",
        "content": format_results(data),
        "data": data,
    }


if __name__ == "__main__":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    try:
        input_data = json.loads(sys.stdin.read())
        result = execute(input_data.get("params", {}), input_data.get("config", {}))
    except Exception as e:
        result = {"status": "error", "error": str(e)}
    print(json.dumps(result, ensure_ascii=False))
