FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/worker apps/worker

WORKDIR /app/apps/worker
CMD ["npx", "tsx", "src/index.ts"]
