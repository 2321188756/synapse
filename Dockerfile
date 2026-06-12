# Synapse — 个人 AI 中间层
# 自备 rust-vector/synapse-vector.node（本地 npm run build:rust 预编译）

FROM node:22-alpine

# httpx 是 rag_embedding 必需依赖；web_search 有 urllib 回退，daily_note 无外部依赖
# 如需完整 requirements.txt 依赖：先 apk add gcc musl-dev 再 pip install -r requirements.txt
RUN apk add --no-cache python3 py3-pip && \
    pip3 install --no-cache-dir httpx --break-system-packages

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY rust-vector/*.node rust-vector/index.js rust-vector/package.json ./rust-vector/
COPY core/ ./core/
COPY routes/ ./routes/
COPY modules/ ./modules/
COPY plugins/ ./plugins/
COPY web/ ./web/
COPY server.js config.example.yaml requirements.txt ./
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN mkdir -p /app/data /app/logs
VOLUME ["/app/data", "/app/logs"]

EXPOSE 5890
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]