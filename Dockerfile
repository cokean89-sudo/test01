# RefBoard 웹 서비스 이미지
#   docker build -t refboard .
#   docker run -p 127.0.0.1:5178:5178 -v refboard-data:/data --env-file .env refboard
# 외부 공개는 docker-compose.yml(HTTPS 리버스 프록시 포함)을 쓰세요.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5178 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
COPY --chown=root:root package.json tsconfig.json ai-prices.json ./
COPY --chown=root:root server ./server
COPY --chown=root:root shared ./shared
COPY --chown=root:root src/lib ./src/lib
COPY --chown=root:root scripts ./scripts
# 코드는 root 소유(읽기 전용), 데이터 폴더만 node 사용자가 쓴다
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
VOLUME ["/data"]
EXPOSE 5178
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5178)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/index.ts"]
