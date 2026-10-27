# Pinned to a Node 22 minor — do NOT float to `node:22`. A floating tag drifts
# under every rebuild, and drift is what broke the gate last time (below).
#
# It is 22.23, not 22.16, because ADR 0135 runs tools/scripts `.ts` files with a
# bare `node script.ts`, which needs Node's default type stripping (22.18+).
# 22.16 cannot run them, and CI's `node-version: 22` can, so the old pin made the
# sandbox fail checks that CI passes.
#
# The old pin guarded a recursive `fs.cpSync` onto a Docker Desktop bind mount
# (VirtioFS/gRPC-FUSE). Node 22.17 reimplemented `cpSync` in C++, and on the
# Docker Desktop of the time it returned EACCES for such a copy — not a permission
# fault: root failed too, `access()` reported RWX, and `cp -R` worked. Bisected
# then: 22.16.0 OK, 22.17.1 / 22.23.2 / 24.19.0 EACCES. The retired
# `@nx/next:build` executor made exactly that copy (`public/` into `dist/`), so
# every slice's build gate failed after a clean compile and typecheck.
#
# Re-checked 2026-10-26 on Docker Desktop 29.9.2, with a recursive cpSync onto a
# /Volumes/Backup bind mount, as root and as uid 501, into new and existing
# directories, mount->mount and container->mount: 22.16.0 and 22.23.4 both OK.
# Nothing in the gate's build path makes the copy any more: since ADR 0083 the web
# app builds with plain `next build`, the only repo callers are the `package`
# targets' copy scripts (release packaging, never the gate), and in dependencies
# only Next's opt-in bundle analyzer calls it.
#
# Before moving this pin, repeat that check: a passing test suite does not
# exercise the copy, so it cannot catch the regression.
FROM node:22.23-bookworm

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

# Claude Code's version is a build arg, not a pin in this file. The dispatcher
# chooses it from SANDCASTLE_CLAUDE_CODE_UPDATE / SANDCASTLE_CLAUDE_CODE_VERSION
# (.sandcastle/.env.example), passes the exact version here, and rebuilds an
# image whose `claude --version` differs. A plain `docker build` gets latest.
# The CLI's own auto-updater is off: updates happen at dispatch, so the version
# each slice log names is the one the agent ran. See
# tools/scripts/lib/sandcastle-cli-version.ts.
ARG CLAUDE_CODE_VERSION=latest
ENV DISABLE_AUTOUPDATER=1
RUN curl -fsSL https://claude.ai/install.sh | bash -s "$CLAUDE_CODE_VERSION"

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
# tools/scripts/copilot-hooks/pre-tool-use.ts.
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
