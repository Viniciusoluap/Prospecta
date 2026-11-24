#!/usr/bin/env bash
# Monta o mapa do código (graphify) no início da sessão do Claude Code.
# Roda em segundo plano para não atrasar a sessão. Só a parte de código (AST),
# local, sem IA e sem custo. Se algo falhar, a sessão segue normalmente.
set -u
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

# Deixa o graphify instalado em ~/.local/bin visível para os outros hooks e para o agente na sessão.
export PATH="$HOME/.local/bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

(
  if ! command -v graphify >/dev/null 2>&1; then
    if command -v uv >/dev/null 2>&1; then
      uv tool install -q "graphifyy[sql]" >/dev/null 2>&1
    elif command -v pipx >/dev/null 2>&1; then
      pipx install "graphifyy[sql]" >/dev/null 2>&1
    else
      pip install -q --user "graphifyy[sql]" >/dev/null 2>&1 \
        || pip install -q --break-system-packages "graphifyy[sql]" >/dev/null 2>&1
    fi
  fi
  command -v graphify >/dev/null 2>&1 && graphify update . >/dev/null 2>&1
) </dev/null >/dev/null 2>&1 &

exit 0
