# Pinned to 22.16 deliberately — do NOT float to `node:22`.
#
# Node 22.17 reimplemented `fs.cpSync` in C++, and the new implementation returns
# EACCES for a recursive directory copy whose DESTINATION is on a Docker Desktop
# bind mount (VirtioFS/gRPC-FUSE). It is not a permission fault: it fails as root
# too, `access()` reports RWX, and `cp -R`, `copyFileSync` and `mkdirSync` all
# succeed on the same path. Bisected on one mount, one source, one uid:
#
#   22.16.0  OK      22.17.1  EACCES      22.23.2  EACCES      24.19.0  EACCES
#
# The retired `@nx/next:build` executor copied `public/` into `dist/` with exactly
# that call, so every slice's build gate failed on macOS once the image drifted
# ahead of the host's Node 22.13 — always AFTER a clean compile and typecheck,
# which is what made it read as a code failure. It hit the agent sandbox too, not
# just the gate: both run builds inside a bind-mounted worktree. Since ADR 0083 the
# web app builds with plain `next build` into `apps/web/.next`, which no
# longer makes that copy; the pin stays until something verifies no other build
# step reaches a recursive cpSync onto the mount.
#
# CI floats on `node-version: 22` and is unaffected (ext4, not VirtioFS), so this
# pin makes the sandbox lag CI by design. Before unpinning, verify with a recursive
# cpSync into a bind-mounted directory — a passing test suite will not catch it.
FROM node:22.16-bookworm

# Install system dependencies.
# build-essential + python3: required to compile native modules (bcrypt).
# libssl-dev: required by Prisma client at runtime.
# default-jre-headless: openapi-generator-cli is a Java tool, so `yarn
#   openapi:sync` and `yarn openapi:check` cannot run without a JRE. Omitting it
#   made issue #408 unfixable in the sandbox: the agent regenerated the spec,
#   hit `java: not found` on the client, and was left mid-regeneration.
RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  build-essential \
  python3 \
  libssl-dev \
  default-jre-headless \
  && rm -rf /var/lib/apt/lists/*

# Refuse `git worktree prune` inside the sandbox. Every worktree's admin entry
# (.git/worktrees/<name>/gitdir) names a HOST path the container cannot see, so
# prune judges the slice's own worktree stale and deletes its registration while
# the files stay — the run then crashes at cleanup with "is not a working tree"
# after the agent has finished (slice #1207). The orchestrator prunes on the host,
# where those paths resolve. /usr/local/bin precedes /usr/bin on PATH.
RUN printf '%s\n' \
  '#!/bin/sh' \
  'worktree=0 skip=0' \
  'for arg in "$@"; do' \
  '  if [ "$skip" = 1 ]; then skip=0; continue; fi' \
  '  case "$arg" in -C|-c|--git-dir|--work-tree|--namespace) skip=1; continue ;; -*) continue ;; esac' \
  '  if [ "$worktree" = 1 ]; then' \
  '    if [ "$arg" = prune ]; then' \
  '      echo "git worktree prune is disabled in the sandbox: it deletes this worktree'"'"'s own registration. The orchestrator prunes on the host." >&2' \
  '      exit 1' \
  '    fi' \
  '    break' \
  '  fi' \
  '  [ "$arg" = worktree ] || break' \
  '  worktree=1' \
  'done' \
  'exec /usr/bin/git "$@"' \
  > /usr/local/bin/git \
  && chmod 755 /usr/local/bin/git

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Enable Corepack and pre-warm Yarn 4.13.0 (pinned via packageManager in package.json).
# Pre-warming avoids a network download on first `corepack yarn install` inside the container.
RUN corepack enable && corepack prepare yarn@4.13.0 --activate

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -o -g $AGENT_GID node && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node

# Install the supported agent CLIs
# Copilot installs globally before we drop to the agent user; Cursor and Claude
# install into the agent home directory and share the same PATH entry.
RUN npm install -g @github/copilot
USER ${AGENT_UID}:${AGENT_GID}
RUN curl https://cursor.com/install -fsS | bash
RUN curl -fsSL https://claude.ai/install.sh | bash

# Add Cursor/Claude/uv to PATH
ENV PATH="/home/agent/.local/bin:$PATH"

# Install uv and the graphify MCP server that CodeExplorer's `graphify` entry in
# .mcp.json declares. Pinned to the exact version that built the host's
# graphify-out/graph.json (0.9.43 — PyPI latest is already ahead at 0.9.48):
# graphifyy is pre-1.0 with no on-disk format stability guarantee across
# releases, so bumping this pin and rebuilding the graph must be one coordinated
# change, not two independent ones. The [mcp] extra is REQUIRED — plain
# `graphifyy` makes `graphify-mcp` crash with `ModuleNotFoundError: No module
# named 'mcp'`, surfacing in Claude Code as "✘ Failed to connect — MCP error
# -32000". `uv tool install` drops the `graphify`/`graphify-mcp` shims into
# ~/.local/bin, already on PATH above. See docs/graphify.md.
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
RUN uv tool install "graphifyy[mcp]==0.9.43"

# Pre-accept the workspace trust dialog. Sandcastle always bind-mounts the worktree at
# this fixed path, and without this Claude Code refuses to load the repo's
# .claude/settings.json allowlist ("Ignoring N permissions.allow entries ... this
# workspace has not been trusted"), costing permission friction on every run. That
# warning is also the last thing on stderr, so sandcastle reports IT as the agent error
# and hides the real failure. Merge rather than overwrite: the installer above may
# already own this file.
RUN node -e "const f='/home/agent/.claude.json',fs=require('fs');let j={};try{j=JSON.parse(fs.readFileSync(f,'utf8'))}catch{}j.projects=j.projects||{};j.projects['/home/agent/workspace']={...(j.projects['/home/agent/workspace']||{}),hasTrustDialogAccepted:true};fs.writeFileSync(f,JSON.stringify(j,null,2))"

# Tell the repo's PreToolUse hooks they are running inside the sandbox, so they
# lift the workflow guards on generated paths (app-api-client, api-specs,
# swagger, generated design tokens, Prisma migrations). Those guards exist to
# stop a hand-edit in chat or local development; in a disposable container they
# only block legitimate work, including the `git restore` an agent needs to undo
# its own mistake. Secret guards (.env, credentials, key material) are NOT
# lifted — the transcript still leaves the container. See
# tools/scripts/copilot-hooks/pre-tool-use.mjs.
ENV MYORGANISER_SANDBOX=1

WORKDIR /home/agent

# Prevent Nx from connecting to a background daemon or spawning a plugin-isolation
# worker process. Both code paths try to load nx/src/native (WASM via @napi-rs/wasm-runtime),
# which hangs on worker-thread creation inside Docker. These vars are belt-and-suspenders;
# the Linux-native Nx binding (@nx/nx-linux-x64-gnu) is resolved by the in-container
# `yarn install` (below), which runs on this image's linux/x64 platform.
ENV NX_DAEMON=false
ENV NX_ISOLATE_PLUGINS=false
ENV NX_SKIP_NX_CACHE=true

# Sandcastle bind-mounts the git worktree at /home/agent/workspace at container start.
# Dependencies are installed IN THIS CONTAINER by the orchestrator's
# `hooks.sandbox.onSandboxReady` hook (`corepack yarn install --immutable`) BEFORE the
# agent runs — so native binaries (bcrypt, prisma, @swc/core) are built for this Linux
# platform regardless of the host OS (WSL2/Linux/macOS). The agent does NOT run
# `yarn install`. Yarn's global cache is bind-mounted at /home/agent/.yarn-cache (set
# via YARN_GLOBAL_FOLDER) so installs are incremental across slices. The worktree must
# live on a native host fs (ext4/APFS) — see docs/adr/0009 and
# docs/sandcastle/RUNBOOK.md.
ENTRYPOINT ["sleep", "infinity"]
