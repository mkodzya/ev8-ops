FROM node:22-alpine
WORKDIR /app

# Workspace manifests first, so a code change does not reinstall everything.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/api apps/api

WORKDIR /app/apps/api
# Prisma 7 client generation without engine downloads (hermetic build).
RUN PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma generate

EXPOSE 8080
# migrate → seed the first owner login (no-op once a user exists) → serve
CMD ["sh", "-c", "node scripts/migrate.mjs && npx tsx src/seed.ts --if-empty && npx tsx src/index.ts"]
