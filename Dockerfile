# Noggin, as one container: the relay serves the built site, the API and the
# WebSocket on a single port, so the reverse proxy in front needs one rule.
FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first — this layer only rebuilds when the lockfile moves.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# `npm ci --omit=dev` keeps Astro, React and Tailwind out of the runtime image;
# only `ws` and `postgres` are needed once the site is built.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server
# Operator tooling has to be *on the box*, or it may as well not exist. The
# recovery-code script is the documented way back into a locked-out account:
#
#   docker compose exec noggin node scripts/recovery-code.js you@example.com
COPY scripts/recovery-code.js ./scripts/recovery-code.js

# Boards, saved games and clue media, when running without Postgres.
RUN mkdir -p /app/data /app/uploads

EXPOSE 4332
CMD ["node", "server/index.js"]
