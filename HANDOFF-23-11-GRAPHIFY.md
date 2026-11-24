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

## 24/11 — correção: o graphify instalado pelo hook não respondia consultas
- Problema: o pacote `graphifyy` não instala o `anyio`. Com a instalação automática, `graphify update .` funcionava,
  mas `graphify query/path/explain` quebrava com `ModuleNotFoundError: No module named 'anyio'`.
- Correção em `.claude/hooks/graphify-setup.sh`: instala o graphify junto com o `anyio` (uv `--with anyio`,
  `pipx inject` ou pip) e, se encontrar um graphify já instalado sem `anyio`, reinstala sozinho. Se estiver completo,
  não reinstala.
- Observação: o hook só roda quando a sessão abre dentro da pasta da Prospecta. Numa sessão aberta na pasta-mãe
  (`/home/user`, com vários repositórios), ele não dispara: rodar `bash .claude/hooks/graphify-setup.sh` à mão.

### Testes
- (a) Automáticos (nesta máquina): `bash -n` sem erro; três casos, todos com saída 0 e
  `graphify query "emissão de NFS-e"` encontrando `server/fiscal/emissao.ts` ao final:
  1. graphify instalado sem `anyio` (consulta falhava) → o hook reinstalou e a consulta passou;
  2. sem graphify → o hook instalou e montou o mapa (21.532 nós, 60.375 ligações, ~40 s);
  3. graphify completo → o hook não reinstalou, só atualizou o mapa.
- (b) Manuais: nenhum.
- (c) Pendente: confirmar numa sessão nova aberta direto na Prospecta que a consulta funciona logo de início.

### Publicação
- PR #337: revisão do Codex concluída sem achados; prévia da Vercel pronta; mesclado na `main` (squash `a8ed34f`)
  em 24/11 com autorização do dono. Sem migração (só ferramenta de desenvolvimento).

### Próximo passo
- Abrir uma sessão nova na Prospecta e rodar `graphify query "<qualquer pergunta>"` depois de ~1 minuto.
