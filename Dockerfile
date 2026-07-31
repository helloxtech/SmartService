FROM node:24-bookworm-slim

WORKDIR /app

ENV CI=true

RUN corepack enable \
    && corepack prepare pnpm@11.9.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/voice-agent/package.json apps/voice-agent/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile --filter @smartservice/voice-agent...

COPY apps/voice-agent apps/voice-agent
COPY packages/contracts packages/contracts

CMD ["pnpm", "--filter", "@smartservice/voice-agent", "start"]
