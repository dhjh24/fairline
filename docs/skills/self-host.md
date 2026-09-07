# Skill: self-host

**Triggers:** docker, compose, self host, nitro, production

## Where

`Dockerfile` (multi-stage, `NITRO_PRESET=node-server`), `docker-compose.yml`, `.env.example`.

## Rules

- Auth off (`VITE_AUTH_ENABLED=false`). No Postgres.
- Runtime env: `XAI_API_KEY` optional. Never bake secrets into the image.
- App listens on container **8080**. Compose publishes that.
- After model/tape changes: rebuild the image. Browser `localStorage` is unchanged.
- Without Docker: `npm ci && NITRO_PRESET=node-server npm run build && npm start`.
- Grok Build preview: Vite **8080**, production smoke **8081** via `npm run preview:restart`. Do not tell the user port numbers.
