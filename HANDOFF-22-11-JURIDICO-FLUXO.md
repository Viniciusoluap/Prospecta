# Jurídico — fluxo de assinaturas, senha lembrada e posição visível (22/11/2026)

## Base e isolamento
Base remota a3fc88a353d03bc528858af94ed0d0a42b76c81f. Branch codex/juridico-fluxo-assinaturas-20261122. Somente arquivos do Jurídico/contratos/retorno no portal; preservar as frentes do Fabel. Sem mudança de credenciais do servidor, sem serviço pago ou envio de mensagens reais na sessão.

## Implementado
- Senha lembrada no aparelho: AES-GCM com CryptoKey não exportável separado por conta no IndexedDB; PFX continua protegido pela senha e PBKDF2. Importação nova já guarda a senha cifrada. Certificado antigo: informa uma vez na próxima assinatura e fica lembrada. Botão Esquecer senha. Nunca senha/PFX para o servidor; não há sincronização entre aparelhos.
- Prévia com PDF.js, seleção de página e posição por toque/arrasto, ajuste de largura. Marca com titular/documento/data desenhada ANTES da assinatura CMS; a marca é coberta pela assinatura criptográfica. Original preservado; assinatura anterior preservada em atualização incremental.
- Nomes/etapas com cliente: gerado, assinado pela empresa, recebido para conferência, assinado por todos. Documento já assinado não oferece Assinar digitalmente.
- Envio explícito por botão para e-mail cadastrado (PDF anexo) e portal, ou só portal. Não foi enviado e-mail real em teste.
- Upload externo não conclui automaticamente: entra em conferência; admin confirma explicitamente que todas as partes/testemunhas assinaram.
- Retorno pelo portal permitido nos modelos novos. Confere CMS/ByteRange/cadeia contra raízes públicas do ITI, identificação das partes e testemunhas, cobertura final do arquivo, preservação da revisão assinada pela empresa e do conteúdo/recursos das páginas. Somente quando todos esses critérios são atendidos conclui automaticamente. Falta de identificação, assinatura não conferível, cadeia ausente ou alteração de conteúdo → conferência humana, nunca aprovação pelo mero nome do arquivo ou contagem de assinaturas.
- Raízes públicas v4–v13 obtidas por HTTPS do repositório oficial: https://www.gov.br/iti/pt-br/assuntos/repositorio/repositorio-ac-raiz (22/11/2026). Apenas certificados públicos; sem chave privada. Sem consulta online de revogação/carimbo de tempo; não apresentar como substituto do VALIDAR/ITI.
- Sem migração nova: usa colunas varchar/tabelas privadas existentes. Não se renomeiam nem excluem em massa documentos antigos; a apresentação padroniza os nomes e novos arquivos já são salvos padronizados.

## Testes
(a) 27 testes em 5 arquivos aprovados. Incluem persistência/rollback/RBAC, retorno externo e pelo portal, isolamento de cliente, envio por e-mail simulado, senha cifrada lembrada/esquecida e segregada por conta, marca visível no texto do PDF, assinatura CMS independente/OpenSSL, preservação de duas assinaturas e adulteração, raízes falsas recusadas, identificação de todas as partes com duas raízes sintéticas confiáveis apenas nos testes.
(a) Compilação esbuild browser aprovada (worker por URL é resolvido pela Vite). TypeScript não acusa arquivos desta frente; checkout parcial possui referências antigas de outros módulos. Build completo precisa passar na Vercel.
(b) PDF sintético rasterizado e inspecionado: marca no local escolhido, sem cobrir a linha da construtora. pdfsig confirmou Signature is Valid e Total document signed (emissor sintético não confiável, como esperado); OpenSSL também aprovado.
(b) Teste DOM com componente real e PDF.js simulado: página, toque, arrasto, coordenadas PDF e reset ao trocar de página — aprovado. Chromium no executor não iniciou por restrição de socket; não afirmar teste E2E em navegador real.
(c) Preview inicial dpl_HyuXmHbGqhYrZAgX3XBxVKuTfEMp READY, commit 7550396fcd4f6495c2f289ad822b2213d32ebc44. PR #297 aberto; revisão Completed com um P1 real: anotações opacas poderiam encobrir o texto em um retorno assinado. Corrigido comparando também anotações anteriores e permitindo apenas novos widgets de campos de assinatura do PDF; alterações de conteúdo, recursos e configurações de visualização ficam em conferência. Regressão reproduz Square opaco com duas assinaturas confiáveis e agora recusa; retorno legítimo permanece aceito. Correções adicionais de segurança: serializar nomes PDF por valor e documentos de partes distintas.
(c) Pendente PR, revisão automática Completed + leitura dos comentários, preview, integração preservando a main atual e produção READY/HTTP.

## Paridade
Grupo Santa Fé tem fluxo de contratos e documentos, sem equivalente do cofre/assinatura local (ver HANDOFF-21-11-JURIDICO-CERTIFICADOS.md e arquivo remoto web/src/lib/actions/juridico.ts). Portar esta correção junto do fluxo A1. Não alterar sua frente em paralelo nesta publicação.

## Identificação de todos os signatários
Acrescentados nome/CPF opcionais das testemunhas na criação do contrato, para a conferência automática ter identidades concretas (antes eram apenas linhas vazias). Cônjuge, terrenista e cotitulares carregam os documentos já preenchidos para as linhas de assinatura. Qualquer outro interveniente sem documento identificado também exige conferência humana. Contratos existentes com testemunhas sem identificação continuam seguros em conferência; não inventar identidades nem concluir só pela contagem. Payload antigo de criação recebe os campos novos vazios para compatibilidade.

## Fechamento do QA
Preview da correção 5a9b25e3a2f27350668f66760f1eb2de82dc1a35: dpl_HMSyuHDYVxnvLSMmtsHenq9ycuDi READY. Thread PRRT_kwDOR_rShc66lMy7 corrigido e resolvido; todos os comentários lidos. Conferência final incluiu também a rota legada de vínculo por URL: nunca declara assinatura de todos sem confirmação. Teste de negação para colaborador acrescentado. Interface impede trocar posição durante a assinatura e cancela recuperação de senha de certificado anterior.

## Próximo passo
Publicar o checkpoint de correção do P1, resolver o thread com teste aprovado e aguardar seu build. A revisão já terminou; reler todos os comentários antes de integrar, verificar avanço de main/Fabel e confirmar produção READY/HTTP.
