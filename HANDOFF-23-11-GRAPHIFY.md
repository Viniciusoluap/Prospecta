# HANDOFF 23/11 — Mapa do código (graphify)

## Concluído
- `.claude/hooks/graphify-setup.sh`: no início da sessão, instala o graphify (`graphifyy[sql]`) se faltar e roda
  `graphify update .` em segundo plano. Não bloqueia a sessão; se falhar, nada quebra.
- `.claude/settings.json`: hook SessionStart (montagem do mapa) e hooks PreToolUse do graphify (Bash/Grep e
  Read/Glob) que só sugerem a consulta ao mapa. Todos protegidos com `command -v graphify ... || true`, para
  funcionar em máquina sem graphify.
- `CLAUDE.md`: seção "Mapa do código — graphify" com as regras de uso.
- `.gitignore`: `graphify-out/` (o `graph.json` tem cerca de 24 MB e é refeito a cada sessão).

## Testes
- (a) Automáticos: `graphify update .` no commit a32c85b5 → 2.059 arquivos, 21.515 nós, 60.361 ligações,
  860 comunidades, ~55 s, custo zero de tokens. `graphify query "emissão de NFS-e"` encontrou
  `server/fiscal/emissao.ts` (emitirNota, cancelarNota, enviarDps). O hook de busca, ao ver `grep emitirNota`,
  devolveu o aviso com `server/fiscal/emissao.ts L197` e `server/dolores/acoes/fiscal.ts`, com saída 0.
- (b) Manuais: graph.html conferido.
- (c) Pendente: confirmar numa sessão real do Claude Code (local e web) que o mapa é montado no início.

## Próximo passo
- Usar por uma semana e comparar o consumo de créditos por sessão. Se não render, basta remover a seção do
  CLAUDE.md e os hooks.
- Opcional: modo estrito (`graphify install --project --strict`), que obriga o uso do mapa em vez de só sugerir.
