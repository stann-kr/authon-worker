# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim

# 네이티브 의존성 빌드 + wrangler/workerd 실행에 필요한 패키지
RUN apt-get update && apt-get install -y python3 make g++ curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# 의존성 설치 최적화 (레이어 캐싱)
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

COPY . .

# Next.js 개발 서버 (http://localhost:3000)
EXPOSE 3000
# Wrangler Workers 미리보기 서버 (http://localhost:8787)
EXPOSE 8787

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "run", "dev"]
