FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d
WORKDIR /app
RUN --mount=type=cache,id=tuyile-corepack,target=/root/.cache/node/corepack corepack enable && corepack prepare pnpm@9.14.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/infrastructure/package.json ./packages/infrastructure/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY patches ./patches
RUN --mount=type=cache,id=tuyile-corepack,target=/root/.cache/node/corepack --mount=type=cache,id=tuyile-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY migrations ./migrations
COPY licenses ./licenses
COPY tsconfig.json LICENSE NOTICE THIRD_PARTY_NOTICES.md ./
RUN --mount=type=cache,id=tuyile-corepack,target=/root/.cache/node/corepack pnpm build
ENV NODE_ENV=production
RUN mkdir -p /app/storage && chown node:node /app/storage && chmod 700 /app/storage
USER node
EXPOSE 8792
CMD ["node","dist/api/main.js"]
