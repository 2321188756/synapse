#!/bin/sh
set -e

# 检查 config.yaml
if [ ! -f /app/config.yaml ]; then
    echo "[synapse] config.yaml not found, copying from template..."
    cp /app/config.example.yaml /app/config.yaml
    echo "[synapse] ⚠️  Please edit config.yaml with your API keys and restart."
fi

# 检查 data 目录
mkdir -p /app/data /app/logs

echo "[synapse] starting..."
exec "$@"