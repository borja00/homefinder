# One image for everything: `serve` (the default) runs the dashboard + API,
# `scrape` / `migrate` / `reparse` are the same image with another command.

# Build on the runner's own platform: the dashboard is static files and the
# runtime dependencies are pure JS, so the arm64 image needs no QEMU.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
RUN apk add --no-cache tzdata
# Scrape days ("first seen", "removed on") are Madrid dates.
ENV NODE_ENV=production TZ=Europe/Madrid
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY package.json ./
COPY src src
COPY db db
USER node
EXPOSE 3000
CMD ["node", "src/cli.js", "serve"]
