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
(a) 24 testes em 5 arquivos aprovados. Incluem persistência/rollback/RBAC, retorno externo e pelo portal, isolamento de cliente, envio por e-mail simulado, senha cifrada lembrada/esquecida e segregada por conta, marca visível no texto do PDF, assinatura CMS independente/OpenSSL, preservação de duas assinaturas e adulteração, raízes falsas recusadas, identificação de todas as partes com duas raízes sintéticas confiáveis apenas nos testes.
(a) Compilação esbuild browser aprovada (worker por URL é resolvido pela Vite). TypeScript não acusa arquivos desta frente; checkout parcial possui referências antigas de outros módulos. Build completo precisa passar na Vercel.
(b) Pendente inspeção visual do PDF sintético e teste de interface/posicionamento.
(c) Pendente PR, revisão automática Completed + leitura dos comentários, preview, integração preservando a main atual e produção READY/HTTP.

## Paridade
Grupo Santa Fé tem fluxo de contratos e documentos, sem equivalente do cofre/assinatura local (ver HANDOFF-21-11-JURIDICO-CERTIFICADOS.md e arquivo remoto web/src/lib/actions/juridico.ts). Portar esta correção junto do fluxo A1. Não alterar sua frente em paralelo nesta publicação.

## Próximo passo
Conferir visualmente a marca e o posicionamento; abrir PR, aguardar QA/build/revisão, corrigir achados, verificar avanço de main/Fabel antes de integrar e confirmar produção.
