# The Fitting Room image (FR-35): the three packed tarballs, installed offline, plus git. Build: REV=$(git rev-parse HEAD) docker compose up --build
FROM docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS install
WORKDIR /opt/fitting-room
COPY vendor/fitting-room-core-*.tgz vendor/fitting-room-agent-*.tgz vendor/fitting-room-cli-*.tgz ./vendor/
RUN echo '{"private":true}' > package.json && npm install --offline --omit=dev --no-audit --no-fund --no-package-lock ./vendor/*.tgz

FROM docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
RUN apk add --no-cache git
COPY --from=install /opt/fitting-room/node_modules /opt/fitting-room/node_modules
ENV PATH=/opt/fitting-room/node_modules/.bin:$PATH
RUN mkdir /repo && chown node:node /repo
ARG REV
RUN test -n "$REV" || { echo "REV is required: REV=\$(git rev-parse HEAD) docker compose up --build" >&2; exit 1; }
LABEL org.opencontainers.image.revision="$REV"
USER node
WORKDIR /repo
