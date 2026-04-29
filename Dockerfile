FROM oven/bun:1-debian AS base
WORKDIR /usr/src/app

FROM base AS install
COPY package.json bun.lock .
RUN bun install --frozen-lockfile

FROM base AS install-prod
COPY package.json bun.lock .
RUN bun install --frozen-lockfile --production

FROM base AS build
COPY --from=install /usr/src/app/node_modules node_modules
COPY package.json .
COPY . .
RUN bun run build

FROM oven/bun:1-debian AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV BODY_SIZE_LIMIT=Infinity
ENV FRAMES_DIR=/app/data/frames

COPY --from=build /usr/src/app/build ./build
COPY --from=build /usr/src/app/static ./static
COPY --from=build /usr/src/app/server ./server
COPY --from=build /usr/src/app/realtime ./realtime
COPY --from=build /usr/src/app/data ./data
COPY --from=install-prod /usr/src/app/node_modules ./node_modules
COPY --from=install-prod /usr/src/app/package.json ./package.json

EXPOSE 3000

CMD ["bun", "server/index.js"]
