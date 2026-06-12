"""weather — 天气静态插件 (placeholder: {{Weather}})

有 API Key 时调用天气 API，无 Key 时返回提示。
"""

import sys, json, os, io


def execute(params, config):
    city = config.get("city", "北京")
    api_key = config.get("api_key", "")

    if not api_key:
        return {"status": "success", "content": f"{city}（未配置天气 API Key）"}

    # 和风天气 API (免费)
    try:
        import httpx
        # 先查 city id
        geo_url = f"https://geoapi.qweather.com/v2/city/lookup?location={city}&key={api_key}"
        geo_resp = httpx.get(geo_url, timeout=10)
        if geo_resp.status_code != 200:
            return {"status": "success", "content": f"{city}（天气 API 不可用）"}

        geo_data = geo_resp.json()
        city_id = geo_data.get("location", [{}])[0].get("id")
        if not city_id:
            return {"status": "success", "content": f"{city}（未找到城市）"}

        # 查天气
        weather_url = f"https://devapi.qweather.com/v7/weather/now?location={city_id}&key={api_key}"
        weather_resp = httpx.get(weather_url, timeout=10)
        if weather_resp.status_code != 200:
            return {"status": "success", "content": f"{city}（天气 API 不可用）"}

        w = weather_resp.json().get("now", {})
        text = w.get("text", "未知")
        temp = w.get("temp", "?")
        feels = w.get("feelsLike", "?")
        wind = w.get("windDir", "?")
        humidity = w.get("humidity", "?")

        return {"status": "success", "content": f"{city}：{text}，{temp}°C（体感 {feels}°C），{wind}风，湿度 {humidity}%"}
    except ImportError:
        return {"status": "success", "content": f"{city}（需要安装 httpx）"}
    except Exception as e:
        return {"status": "success", "content": f"{city}（天气查询失败: {e}）"}


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    try:
        input_data = json.loads(sys.stdin.read())
        result = execute(input_data.get("params", {}), input_data.get("config", {}))
    except Exception as e:
        result = {"status": "error", "error": str(e)}
    print(json.dumps(result, ensure_ascii=False))
