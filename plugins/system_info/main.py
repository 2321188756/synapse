"""system_info — 系统信息静态插件 (placeholder: {{SystemInfo}})

返回 CPU/内存/磁盘使用率。
"""

import sys, json, io, os


def get_info():
    """获取系统信息，优先用 psutil，回退到基本检测"""
    info = {"cpu": "?", "memory": "?", "disk": "?"}

    try:
        import psutil
        info["cpu"] = f"{psutil.cpu_percent(interval=0.5)}%"
        mem = psutil.virtual_memory()
        info["memory"] = f"{mem.percent}% ({mem.used // (1024*1024)}MB / {mem.total // (1024*1024)}MB)"
        disk = psutil.disk_usage(os.getcwd())
        info["disk"] = f"{disk.percent}% (可用 {disk.free // (1024*1024*1024)}GB)"
    except ImportError:
        # 无 psutil 时用基本检测
        try:
            # CPU load (from /proc/loadavg on Linux, N/A on Windows without psutil)
            load = os.getloadavg() if hasattr(os, "getloadavg") else None
            if load:
                info["cpu"] = f"load {load[0]:.1f}"
        except Exception:
            pass

        try:
            import shutil
            disk = shutil.disk_usage(os.getcwd())
            info["disk"] = f"{disk.used / disk.total * 100:.0f}% (可用 {disk.free // (1024*1024*1024)}GB)"
        except Exception:
            pass

    return info


def execute(params, config):
    info = get_info()
    content = f"CPU: {info['cpu']} | 内存: {info['memory']} | 磁盘: {info['disk']}"
    return {"status": "success", "content": content}


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    input_data = json.loads(sys.stdin.read())
    result = execute(input_data.get("params", {}), input_data.get("config", {}))
    print(json.dumps(result, ensure_ascii=False))
