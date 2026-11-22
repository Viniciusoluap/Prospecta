# Jurídico — validação automática e ajustes da assinatura

**STATUS (checkpoint wip, Claude, 22/11):** núcleo PKI reescrito e testado (download com SSRF/prazo/limites, cadeia PKIjs 3.4.0 + regras extras, LCR com cache, conferência por assinatura com estados valida/pendente/invalida), relatório por documento (migração 0161, NÃO aplicada), validação no upload da empresa, retorno do portal, retentativa (tela + cron diário existente) e endpoint de cadeia. FALTA: UI (marca proporcional, aba de certificados, exibição), testes de integração do relatório/retentativa, suíte completa e build. Ver seção de status no fim quando houver.

Atualizado em 22/11/2026. O dono pediu para salvar todo o progresso para continuar com outra IA. Esta frente está EM ANDAMENTO. O código desta branch ainda precisa de integração, testes e revisão antes de mesclar/publicar.

## Pedido e autorização do dono

1. Automatizar a conferência técnica do PDF no fluxo de assinatura: integridade, cadeia ICP-Brasil e revogação, salvando o resultado junto ao documento. Falha/inconclusão deve aparecer como pendência, nunca como aprovação. O dono autorizou implementar.
2. Print IMG_4201.jpeg/IMG_4200.jpeg: trocar o controle "Largura da assinatura" por tamanho proporcional da marca inteira. Largura, altura, texto, bordas e espaçamento devem acompanhar a escala e a marca deve continuar posicionável por toque/arrasto.
3. Remover o formulário "Importar certificado digital" da janela de assinatura. Importação permanece na aba Certificados digitais do Jurídico. Se não houver certificado, orientar essa aba usando navegação existente.
4. Migração aditiva, merge e produção já autorizados na conversa, quando a implementação passar pelos checks. Preservar as correções paralelas do Fabel. Nunca enviar e-mails reais nem assinar contratos reais em testes.

## Base e situação da produção

Repositório Viniciusoluap/Prospecta. Esta branch nasce da main 1524c1830e3c1a6bde7ae66cfbfcb1194381b6d3. Conferir a main novamente antes de continuar e integrar somente esta frente.

Entregas anteriores concluídas:
- PR #297, merge 7626b6d849e6bbbd214cb8e1679d1cda6ecbee01: senha lembrada cifrada por conta/aparelho, PDF com marca visível e posição selecionável, nomes por cliente, fases empresa/retorno/todos, envio explícito por e-mail e portal. 27 testes aprovados na etapa anterior. HANDOFF-22-11-JURIDICO-FLUXO.md contém os detalhes.
- PR #301, merge 6a09e01a69e42c9f9a240d63b854fe1ca2e128d8: corrigiu import JSON ESM que derrubava TODA a API/login com ERR_IMPORT_ATTRIBUTE_MISSING. Deploy dpl_EaWCfciVeCnT1jgaNgRzyHUm9E74 READY. /api/health 200 com banco conectado e /api/trpc/auth.me 200 sem sessão verificados. NÃO remover o atributo with { type: "json" } dos imports JSON de servidor. HANDOFF-22-11-LOGIN-API.md.
- Main atual pode conter outras entregas do Fabel além desses merges.

## Código preparado nesta branch

client/src/components/admin/PosicionarAssinaturaPdf.tsx
- Slider renomeado Tamanho da assinatura, escala 50–160%, dimensões base 0.52 x 0.11 relativas à página.
- Largura/altura variam proporcionalmente, preserva centro e limita o retângulo à página.
- Atualiza boxRef e posição publicada.
- PENDENTE: a prévia ainda usa texto fixo em 10px e o desenho real ainda limita a fonte a 9pt/padding fixo. Corrigir ambos para que a marca inteira escale, conforme pedido. Testar coordenadas após resize e arrasto, páginas e tamanhos distintos.

client/src/components/admin/CertificadosJuridico.tsx
- Formulário de importação envolvido por !documento, ficando somente na aba própria.
- PENDENTE: estado sem certificado deve orientar a aba própria. Integrar chamada de montagem da cadeia e resultado real da validação; texto e toast atuais ainda dizem sem revogação e assinado/salvo sem resultado da análise.

server/juridico-pki-download.ts (NOVO, rascunho)
- Download HTTP/HTTPS limitado, sem credenciais/portas incomuns/IP literal. Resolve IPv4, bloqueia redes privadas/reservadas e fixa IP na conexão, revalida redirects, timeout de conexão e limite de 10MiB.
- PENDENTE: revisar tipos Node lookup, deadline total inclusive DNS/redirects, quantidade de requisições/concurrência e proteção SSRF. Não aceitar URLs arbitrárias fornecidas diretamente por usuário. Material de rede deve servir só a certificados/LCR públicos.

server/juridico-pki.ts (NOVO, rascunho)
- Raízes públicas oficiais já existentes em server/certificados/icp-raizes.json com import JSON tipado.
- Busca intermediários via AIA dos certificados, verifica vínculo criptográfico com emissor e usa CertificateChainValidationEngine do PKIjs com raízes fixas.
- Consulta LCR, confere emissor/assinatura/período e serial revogado. Escopos parciais/delta não suportados deixam pendente. Não faz OCSP.
- validarCertificado devolve cadeia, revogação, motivo e intermediários DER base64 para inclusão no PDF.
- PENDENTE: validar no runtime real PKIjs 3.4.0, ordem certificatePath, chave cRLSign e todos os limites/escopos/extensões críticas. Adicionar testes reais com CA/folha/LCR sintéticas válidas, revogadas, vencidas, indisponíveis, adulteradas e de outro emissor. Rejeitar dados incompletos sem dar verde. Cache/retentativa ainda ausentes. Consulta atual não equivale a validação histórica com timestamp.

server/juridico-verificar-assinaturas.ts
- Rascunho troca conferência CMS com cadeia embutida por integridade CMS seguida da nova rotina de cadeia/revogação.
- Relatório expandido com estado valida/pendente/invalida, assinaturas, titular/documento, integridade, cadeia, revogação e verificadoEm.
- todos exige estado válido e todas as identidades obrigatórias, preservando a lógica de testemunhas/partes do código anterior.
- PENDENTE: distinguir falha transitória da consulta de assinatura criptograficamente inválida, capturar exceções sem classificar indisponibilidade como invalida, testar integridade/cobertura e múltiplas assinaturas. Os testes anteriores de raízes sintéticas precisam continuar significativos.

## Integração que falta fazer

1. Endpoint autenticado de montagem da cadeia recebe APENAS certificado público DER e cadeia existente; servidor devolve intermediários. Senha/PFX/chave privada continuam no navegador. Antes de assinar, incluir intermediários em signer.certificateChain. O P12Signer da @libpdf/core 0.5.3 expõe certificateChain como array readonly no atributo mas mutável nos itens. A chamada local abrirCertificado hoje usa buildChain:false. Não simplesmente habilitar fetch no navegador porque CORS/HTTP em HTTPS pode impedir AIA.
2. Validar o PDF assinado durante uploadDocument type assinatura_digital no servidor. Conferir integridade e titular esperado da Parte A, vincular ao documento de origem e ao contrato correto. Arquivo inválido/revogado não recebe rótulo de assinatura validada. Pendência de rede pode ser guardada como pendência explícita. Preservar original e comportamento de upload normal.
3. Persistir relatório por documento e SHA-256 dos bytes analisados, com horário e origem. Criar migração ADITIVA se necessário. Nenhuma migração desta frente foi escrita/aplicada. Guardar relatório atomicamente com PDF/documento/status e evitar estado inconsistente ou sobrescrita concorrente de arquivo/análise.
4. Exibir resultado técnico nos documentos: assinatura válida, pendente ou inválida, titular e explicação curta. "Assinado pela empresa" continua separado de "Assinado por todos". Nunca alegar relatório/validação oficial ITI quando o sistema fez só sua própria conferência.
5. Retentativa automática para consultas pendentes, com limites e prazo/cache de revogação. Pode acontecer ao consultar documento e/ou tarefa agendada autenticada conforme infraestrutura disponível. Nunca dar verde por timeout. A política exata ainda não foi implementada.
6. Retorno via portal só conclui automaticamente quando todas as identidades obrigatórias têm assinaturas conferidas E o arquivo conserva a revisão da empresa/conteúdo. Preservar proteção contra sobreposição de anotações (P1 corrigido na PR297). Retorno externo por e-mail/WhatsApp continua anexo + confirmação do dono conforme pedido. Retentativa do portal pode concluir quando a validação antes pendente passar, preservando origem/arquivo.
7. Comparar estrutura e cadeia do contrato real da Maylanne somente se necessário, com acesso autorizado. O PDF real NÃO está nesta branch. O usuário relatou OpenSSL/pdfsig com integridade válida, issuer unknown; isso não prova cadeia inválida. Não mudar certificado nem pedir sua senha em chat.
8. Revisar/verificar/testar e então migrar/publicar. Ler CLAUDE.md atual e AGENTS.md. Antes de merge esperar revisão Codex Completed, ler comentários de revisão e corrigir achados reais.

## Verificações desta etapa

(a) Automáticos: ainda NÃO executados nesta branch. Sem pnpm check, Vitest ou build concluídos para o código novo. Código não deve ser tratado como pronto.
(b) Manuais: prints observados no contexto. Alterações de UI feitas em código, sem validação visual desta etapa. Documentação/tipos instalados das versões exatas consultados.
(c) Produção: nenhuma mudança desta branch foi publicada. Nada foi migrado e nenhum contrato real foi assinado/enviado. As 27 aprovações citadas acima pertencem à etapa ANTERIOR, não a esta.

## Dependências e ambiente de continuidade

Checkout local /workspace/scratch/8b7f794f86dd/prospecta-juridico-validacao. Histórico local é snapshot antigo e alguns arquivos foram atualizados da main por connector. NÃO fazer push de toda a cópia local para main, pois há diferenças de outras frentes. Esta branch remota contém só os cinco arquivos de implementação desta frente e este HANDOFF, com parent na base remota atual consultada.

Pacotes já declarados no repositório: @libpdf/core 0.5.3, pkijs 3.4.0, fake-indexeddb 6.2.5, pdfjs-dist 6.5.438. Reinstalados temporariamente em /tmp/prospecta-jurpdf para o ambiente local após poda. Links node_modules apontam para outros snapshots e podem ficar quebrados após limpeza. Não introduzir troca de versão ou lockfile por causa do ambiente local.

Referências técnicas consultadas: https://pkijs.org/docs/api/classes/CertificateChainValidationEngine/ e https://pkijs.org/docs/api/classes/CertificateRevocationList/ . VALIDAR oficial https://validar.iti.gov.br/ . Integração de emissão automática do relatório OFICIAL ainda não foi verificada e não foi prometida como implementada.

Paridade Grupo Santa Fé continua pendência registrada da frente do Jurídico. Não tocar na frente paralela ao fazer este checkpoint.

## Próximo passo exato

Criar checkout LIMPO desta branch remota, ler este HANDOFF e CLAUDE.md, executar primeiro TypeScript/testes focados para corrigir os rascunhos PKI; depois concluir dimensionamento integral, integração frontend/backend, persistência e retentativa. Atualizar este HANDOFF, commit/push e confirmar GitHub a cada etapa. Só publicar após revisão Completed e checks, com smoke da API/login para evitar o incidente anterior.

## Item 1 — marca proporcional

Branch `claude/juridico-marca-proporcional` (worktree `/home/user/pr-jur-marca`), feita em paralelo à frente `codex/juridico-validacao-automatica-2211`. Sem merge, PR ou deploy.

Feito:
- `client/src/lib/marca-assinatura.ts` (NOVO): função pura `layoutDaMarca(largura, altura, blocos)` calcula fonte, entrelinha (1,2 × fonte), margem (8% do menor lado), borda (0,8% do menor lado) e posição de cada linha. A conta é homogênea: dobrar a caixa dobra tudo, por isso a prévia (px) e o PDF (pt) ficam iguais em proporção. Escolhe a maior fonte que faz o texto caber; o nome é quebrado pela largura real em Helvetica (`measureText` da @libpdf/core), e palavra sem espaço é quebrada por caractere. Também `linhasDaMarca` (textos da marca), `caixaNaEscala` (50–160%, preserva o centro, nunca sai da página) e `moverCaixa` (toque/arrasto).
- `client/src/lib/certificados-digitais.ts`: em `assinarPdf`, o bloco de desenho (antes `Math.min(9, ...)` e padding fixo de 4 pt) virou chamada a `layoutDaMarca`. `abrirCertificado`, `signer` e certificados não foram tocados.
- `client/src/components/admin/PosicionarAssinaturaPdf.tsx`: a prévia usa a mesma função sobre a caixa em px (tamanho real exibido, medido com ResizeObserver), em vez do texto fixo de 10 px; o slider "Tamanho da assinatura" e o arrasto usam `caixaNaEscala`/`moverCaixa`. O aviso "Toque para posicionar" saiu de dentro da marca e foi para baixo da página. Props opcionais `titular`/`documento` (ainda não passadas por `CertificadosJuridico.tsx`, que é da outra frente): sem elas a prévia mostra "Titular do certificado".
- Efeito visível: na escala 100% em A4 retrato a fonte da marca passa de 9 pt para ~16 pt (nome curto) / ~11 pt (razão social longa), porque agora a marca preenche a caixa que a prévia mostra.

Testes:
- (a) Automáticos: `server/juridico-marca-assinatura.test.ts` (9 testes: escala proporcional, px × pt, texto cabendo, limites 50%/160% em A4, A4 paisagem, Carta, Ofício paisagem e A5, coordenadas após redimensionar e arrastar, e assinatura real com bytes sintéticos e certificado autoassinado de teste em retrato e paisagem, conferindo que o texto extraído fica dentro da caixa). `server/juridico-certificados.test.ts` continua passando sem alterações. Resultados ao parar (coordenador mandou parar por créditos): `npx tsc --noEmit -p .` exit 0; teste novo 9/9 e `juridico-certificados.test.ts` 7/7 aprovados; suíte completa `npx vitest run` e `npx vite build` ficaram em execução e NÃO terminaram nesta sessão — rodar de novo antes de mesclar.
- (b) Manuais: nenhum; a prévia não foi conferida em navegador nem no iPad.
- (c) Pendentes em produção: conferir no iPad a prévia vs. o PDF assinado nas escalas 50% e 160%. Limite conhecido: em A5 a 50% com razão social longa a fonte fica em ~3,8 pt (A4/Carta/Ofício ficam sempre ≥ 4 pt).

Próximo passo: a frente principal pode passar `titular`/`documento` do certificado escolhido para `PosicionarAssinaturaPdf` (em `CertificadosJuridico.tsx`) para a prévia mostrar o nome real e quebrar as linhas igual ao PDF.
