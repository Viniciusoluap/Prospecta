# EPIC-027 — Correções de 20/11/2026 (noite): Dolores "Jarvis", grupos, maquete e YCloud

Pedido do dono em 20/11/2026 (noite), por prints, depois de testar em produção. Estrutura apresentada e autorizada por ele
("Autorizo"; sobre a YCloud: "eu quero que você conclua a instalação dele já nessa nova atualização"). Execução pelo AIOX:
story → @dev → portão de QA de segurança → migração aditiva → publicação. Alterar dado existente em produção exige
confirmação do dono. Handoff: `HANDOFF-16-11-CORRECOES-E-DOLORES.md`.

## Decisões do dono (não perguntar de novo)
- **Grupos na Central WhatsApp:** aparecem TODOS os grupos; veem o admin e o colaborador que tiver a permissão nova
  ("Grupos do WhatsApp") marcada no cadastro, "conforme qualquer outra função que ele só pode visualizar se for liberado";
  o humano pode ESCREVER no grupo pela Central, "exatamente igual faz na conversa". Isto substitui a regra de 20/11 (manhã)
  de que grupos nunca aparecem na Central. A conversa direta do dono com a Dolores continua fora da Central.
- **Classificar grupo** (tipo e vínculo) — CORRIGIDO pelo dono em 21/11: "eu disse que o colaborador pode ter acesso às mensagens
  do grupo assim como as mensagens dos clientes, mas em nenhum momento eu falei que ele iria classificar". Classificar é SÓ do
  admin (pela tela) e do dono (pelo WhatsApp); o colaborador nunca classifica (migração 0144).
  **Aceitar grupo em que outra pessoa colocou a Dolores (recusado / sem prova) continua SÓ do dono** (regra de 19/11).
- **Agir a partir de grupo:** liberado SÓ quando o NÚMERO DO DONO pede, e SÓ para registrar (salvar nota, orçamento,
  documento). Nunca dinheiro, nunca mensagem a terceiro. Isto ajusta o item 5 da regra de 19/11.
- **Proatividade:** "tudo o que achar relevante". Com os cuidados aceitos por ele: função própria com limite de gasto próprio;
  a relevância é decidida por REGRAS do sistema (a IA só escreve o aviso); avisos parecidos agrupados; o dono pode silenciar um tipo.
- **Gasto separado por função:** "cada função com seu gasto" — conversa com o dono, resposta em grupo, atendimento a cliente,
  classificação de documentos e proatividade, cada uma com limite e modelo próprios, e a tela mostrando o consumo de cada.
- **Referência de conversa:** "eu quero algo igual ao Jarvis" / "como se eu tivesse conversando com o ChatGPT do meu próprio
  negócio […] resolver problemas dentro do meu negócio e não simplesmente ter programações".
- **Maquete:** manter o modelo escolhido pelo dono; não reduzir qualidade por conta própria.

## Correções (ordem autorizada: 4 → 3 → 2 → 5 → 1 → 6; a 7 entra na mesma atualização)
- [x] C4 (implementada, aguarda QA — `C4-dolores-nao-responde-quando-marcada.md`). Dolores não responde quando marcada no grupo. Evidência de produção: `dolores_marcacoes` com 0 linhas desde sempre;
  `dolores_marcacoes_config.lid_dolores` nulo; mensagens de grupo chegam (`grupo-registrada`). Hipótese: a menção vem com o
  identificador `@lid` e não é reconhecida. Conferir também o interruptor por grupo (`dolores_marcacoes_grupo`).
- [x] C3 (implementada, aguarda QA — `C3-categorias-dos-grupos.md`; migração 0139). Categorias dos grupos: mesma lista de 6 (cliente, pós-atendimento, jurídico, administrativo (sócios), parceiros
  comerciais, engenharia) na tela, na pergunta da Dolores e no comando, com uma linha explicando o que cada uma permite;
  botão "Corrigir tipo ou vínculo" em todo grupo ACEITO, inclusive "não identificado · aguardando o dono"; pergunta da
  Dolores no WhatsApp com opções numeradas.
- [ ] C2. Central WhatsApp mostra os grupos (permissão por colaborador) e permite escrever.
- [ ] C5. Dolores "Jarvis": fala natural e curta, sem nome de ferramenta nem código; contexto da conversa ("ela", "esse grupo");
  resolve pelo WhatsApp (vincular cliente a grupo, classificar grupo, ligar resposta no grupo, salvar nota/documento, criar
  tarefa); confirmação proporcional (consultar → direto; registrar → "pode"; sério → confirmação explícita); ação a partir de
  grupo só do dono e só registro; proatividade; gasto por função.
- [ ] C1. Maquete 3D — leitura pela IA estoura os 60 s, gasta a confirmação e a tela fica parada. Diagnóstico (20/11):
  chamada síncrona única (`server/maquete-3d/base.ts:86-92`), PDF inteiro reenviado por prancha (`leitura.ts:384-395`),
  reserva gasta antes e não devolvida em tempo esgotado (`execucao-ia.ts:137-157`), tokens da falha não registrados. Correção:
  Batches API (envia e consulta), só a página da prancha, devolver a reserva quando não houve resultado, consumo real, tela
  com andamento.
- [x] C6 (implementada, aguarda QA — `C6-texto-do-botao-assumir.md`). Texto do botão "Assumir (humano)" (parece dizer que a Dolores já está calada quando ela está atendendo).
- [ ] C7. YCloud (era C1A/C1B do EPIC-026): número vinculado pelo dono em 20/11 (coexistência; conta "VFX Capital", limite
  inicial de 250 clientes/dia, empresa ainda não verificada). Construir: chave digitada pelo dono em Integrações; conferência
  do número; modelos (templates) aprovados; disparo de campanha por template; aviso de situação de entrega com assinatura
  conferida. Recebimento continua pela Evolution (não assinar mensagem recebida na YCloud, para não duplicar).

## Continua valendo
Só o número do dono comanda; senhas, tokens, chaves e dados bancários sempre mascarados; nos grupos só fala quando marcada;
escopo por tipo de grupo travado no servidor; chave da Anthropic lida só nos pontos vigiados por
`server/integracoes-anthropic.test.ts`; tudo registrado; segurança é prioridade (achado importante se corrige antes de publicar).

## Paridade (Grupo Santa Fé)
Dolores e Maquete 3D são exceções. O que é da Central WhatsApp (C2, C6, C7) entra como pendência no ROADMAP.
