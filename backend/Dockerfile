# The API, in three shapes from one file.
#
#   dev    what `docker-compose.yml` runs: every dependency, source mounted, tsx watch
#   tools  migrations, the seed and the importer: the dev toolchain (prisma CLI, tsx)
#          and the compiled build, run once and exited
#   prod   what `docker-compose.prod.yml` runs: compiled JavaScript, production
#          dependencies only, as an unprivileged user
#
# Both containers used to run development servers, which is the wrong thing to
# measure, demonstrate or deploy: slower, with the TypeScript toolchain in the
# request path and the source writable by the process serving it.

FROM node:22-slim AS base
WORKDIR /app
# openssl is required by Prisma's query engine on slim images.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS dev
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
EXPOSE 4000
CMD ["npm", "run", "dev"]

FROM dev AS build
RUN npm run build

FROM build AS tools
CMD ["npm", "run", "setup"]

FROM base AS prod
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# The generated client, not the CLI that generates it: the CLI is a dev dependency.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY prisma/schema.prisma ./prisma/schema.prisma
# Trained model specs, read from ./data at runtime (see services/modelSpec.ts).
COPY data ./data
RUN mkdir -p uploads && chown -R node:node uploads
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
    CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
