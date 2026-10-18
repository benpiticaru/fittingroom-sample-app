# The sample app's muslin build as an nginx image (FR-35). Build: REV=$(git rev-parse HEAD) docker compose up --build
FROM docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor/ vendor/
RUN npm ci --no-audit --no-fund
COPY . .
ARG REV
RUN test -n "$REV" || { echo "REV is required: REV=\$(git rev-parse HEAD) docker compose up --build" >&2; exit 1; }
RUN npx fit muslin build --manifest --revision "$REV"

FROM docker.io/library/nginx:1.30-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5
ARG REV
RUN test -n "$REV" || { echo "REV is required: REV=\$(git rev-parse HEAD) docker compose up --build" >&2; exit 1; }
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist-muslin/ /usr/share/nginx/html/
RUN chmod -R a+rX /usr/share/nginx/html
LABEL org.opencontainers.image.revision="$REV"
