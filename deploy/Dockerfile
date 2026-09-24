# Excavator runner image: a two-stage build that bakes a pinned Excavator
# checkout and a pinned Claude Code into a single non-root image with no
# credentials and no target-repo artifacts. See openspec/changes/runner-image
# (design.md D2) for the decisions this file implements verbatim.

ARG CLAUDE_CODE_VERSION=2.1.281

# ---------------------------------------------------------------------------
# Build stage: build the Excavator checkout from the exact context sent to
# `docker build`. node_modules and packages/*/dist are rebuilt here, never
# copied in (see .dockerignore) — the host's local build state never leaks
# into the image.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

ARG EXCAVATOR_COMMIT
RUN test -n "$EXCAVATOR_COMMIT" || { \
      echo "EXCAVATOR_COMMIT build arg is required and must not be empty" >&2; \
      exit 1; \
    }

WORKDIR /opt/excavator
COPY . .

# Some tree-sitter grammar packages (e.g. tree-sitter-java, tree-sitter-ruby,
# tree-sitter-javascript) ship prebuilt bindings only for a subset of
# platform/Node ABI combinations and fall back to compiling with node-gyp
# for the rest, which needs python3 and a C/C++ toolchain. This is confined
# to the build stage; the runtime stage installs no compiler.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ gcc \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
    && pnpm install --frozen-lockfile \
    && pnpm -r build

# ---------------------------------------------------------------------------
# Runtime stage: no build toolchain, no source outside the pinned checkout.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ARG CLAUDE_CODE_VERSION
ARG EXCAVATOR_COMMIT
RUN test -n "$EXCAVATOR_COMMIT" || { \
      echo "EXCAVATOR_COMMIT build arg is required and must not be empty" >&2; \
      exit 1; \
    }

LABEL org.opencontainers.image.revision="$EXCAVATOR_COMMIT" \
      com.excavator.claude-code-version="$CLAUDE_CODE_VERSION"

# Baked into the environment (not just labels) so deploy/selftest.sh can
# compare the running container against the values the image was built with.
ENV EXCAVATOR_IMAGE_COMMIT="$EXCAVATOR_COMMIT" \
    EXCAVATOR_IMAGE_CLAUDE_CODE_VERSION="$CLAUDE_CODE_VERSION"

# Non-secret toggles only. Model ID, region and budget are runtime
# parameters (design D4) and MUST NOT be baked in here.
ENV CLAUDE_CODE_USE_BEDROCK=1 \
    DISABLE_UPDATES=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1 \
    MCP_TOOL_TIMEOUT=600000 \
    BASH_DEFAULT_TIMEOUT_MS=600000 \
    BASH_MAX_TIMEOUT_MS=1800000

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         git \
         python3 \
         python-is-python3 \
         ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force

# The mounted target repo is normally owned by a different uid than the
# container user; this is a system-wide allowlist, not a bypass of a real
# trust check — see design D2 for why that's safe under this image's
# contract (the mounted repo must be a fresh clone, never a copied .git).
RUN git config --system --add safe.directory '*'

COPY --from=build /opt/excavator /opt/excavator
RUN echo "$EXCAVATOR_COMMIT" > /opt/excavator/.image-commit

COPY deploy/selftest.sh /usr/local/bin/excavator-selftest
RUN chmod +x /usr/local/bin/excavator-selftest

RUN groupadd --gid 10001 excavator \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/excavator --shell /bin/bash excavator \
    && ln -s /opt/excavator /home/excavator/.excavator-plugin \
    && mkdir -p /home/excavator/.claude

COPY deploy/claude-settings.json /home/excavator/.claude/settings.json
RUN chown -R excavator:excavator /home/excavator

USER 10001
WORKDIR /home/excavator
ENV HOME=/home/excavator

# No ENTRYPOINT runner yet — deploy/run-excavator.mjs is added in a later
# task group. Defaulting CMD to the self-test keeps `docker run <image>`
# meaningful on its own.
CMD ["excavator-selftest"]
