FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

# The web bundle imports @ev8/shared, whose entry is TypeScript source —
# vite compiles it in, so the source must be here.
COPY packages/shared packages/shared
COPY apps/web apps/web

WORKDIR /app/apps/web
RUN npm run build

EXPOSE 5173
# vite preview serves the built bundle; /api is proxied to API_PROXY_TARGET
CMD ["npm", "run", "preview"]
