# The web app, in two shapes from one file.
#
#   dev   what `docker-compose.yml` runs: next dev, source mounted
#   prod  what `docker-compose.prod.yml` runs: a production build served by Next's
#         standalone server, as an unprivileged user, with no dev dependencies
#
# NEXT_PUBLIC_API_URL is a build argument, not a runtime setting: Next inlines
# NEXT_PUBLIC_ variables into the browser bundle when it builds, so the address
# the reader's browser calls is fixed here. API_INTERNAL_URL, which the Next
# server itself uses, stays a runtime variable.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_OUTPUT=standalone
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
    CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
