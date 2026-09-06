# Fairline — production image for self-host.
# Build: docker compose build
# Run:   docker compose up -d
# Pass XAI_API_KEY at runtime if you want Grok overlays.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ENV NITRO_PRESET=node-server
ENV VITE_AUTH_ENABLED=false
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=8080
ENV VITE_AUTH_ENABLED=false
COPY --from=build /app/.output ./.output
USER node
EXPOSE 8080
CMD ["node", ".output/server/index.mjs"]
