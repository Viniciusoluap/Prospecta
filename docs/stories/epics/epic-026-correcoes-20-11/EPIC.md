# EPIC-026 — Correções de 20/11/2026 (WhatsApp da empresa e Dolores)

Pedido do dono em 20/11/2026, por prints; estrutura apresentada e autorizada por ele ("Vamos seguir com a YCloud,
autorizo as correções"). Execução pelo AIOX: story → @dev → portão de QA (de segurança nas que mexem com WhatsApp) →
migração aditiva → publicação. Alterar dado existente em produção exige confirmação do dono.

## Correções
- [x] C2. (publicada em 20/11, PR #264, migração 0136) Mensagem recebida de outro número não aparece na Central (defeito em produção). Nenhuma mensagem pode ser
  descartada sem registro visível; remetente não identificado também aparece na Central. Sem puxar histórico antigo.
- [x] C4. (publicada em 20/11, PR #263) Relatório diário: o dono escolhe a hora entre 07:00 e 14:00 (uma vez por dia).
- [x] C5. (publicada em 20/11, PR #263) Valores padrão (limites 15.000.000 / 1.000.000; preços Haiku 5.5 e Opus 5.5; dólar 6,00 — já gravados em
  produção em 20/11 a pedido do dono) como padrão do sistema, e limite mostrado também em reais, com aviso acima do teto.
- [ ] C6. (implementada no ramo `epic026-c6`, migração 0138 ainda não aplicada; aguarda portão de QA de segurança) Botão
  "Assumir (humano)" / "Devolver para a Dolores" na conversa da Central (pedido do dono: "Faça um botão nas mensagens lá no
  WhatsApp para que coloque para assumir o humano ou devolver pra Dolores"). Story `C6-assumir-ou-devolver-conversa.md`.
- [ ] C3. Saudação de campanha com imagem (legenda = texto) e áudio (mensagem de voz); imagem até 5 MB, áudio até 2 min.
- [ ] C1A. Conexão pela API oficial da Meta no cartão "WhatsApp da empresa" (com aviso: sozinha, não entrega grupos).
- [ ] C1B. Coexistência (WhatsApp Web + API oficial no mesmo número) pela **YCloud** (decisão do dono: não criar
  aplicativo próprio na Meta; plano gratuito). Depende de: o dono criar a conta; conferir que o plano gratuito libera
  API, que funciona com número do Brasil e que os grupos continuam chegando pelo WhatsApp Web. Se falhar: segundo número
  só para disparos.

## Ordem
C2 → C4 e C5 → C3 → C1A → C1B. C6 (pedido posterior do dono, 20/11) é independente das demais (não toca a saudação).

## Paridade (Grupo Santa Fé)
Em espera por ordem do dono. O que é da Central WhatsApp entra como pendência no ROADMAP; o que é da Dolores é exceção.
