# Jurídico — PDF automático e certificados digitais (21/11/2026)

## Concluído nesta etapa
- Base remota: 7930224e7e87302af43da9b78598c930c56e17c5. Branch isolada `codex/juridico-pdf-certificados-20261121`; preservados os demais arquivos e o trabalho do Fabel.
- Gerar PDF grava documento e bytes privados na mesma transação. Advisory lock por contrato evita duplicação em cliques simultâneos; repetição reutiliza o PDF.
- Corrigida referência ao formulário após FileReader assíncrono; seleção é preservada quando falha o envio.
- Aba Certificados digitais dentro do Jurídico: A1 PFX/P12, titular, CPF/CNPJ quando disponível no CN, emissor, validade, serial, padrão, remoção.
- Cofre local IndexedDB separado por usuário, AES-256-GCM/PBKDF2-SHA256 (210 mil iterações), senha nunca persistida ou enviada. Em outro aparelho/navegador é necessário importar novamente.
- Assinatura criptográfica PAdES B-B/SHA-256 no navegador, biblioteca @libpdf/core 0.5.3; salva nova cópia privada como `assinatura_digital`; preserva original e assinaturas anteriores. Não marca o contrato como totalmente assinado só porque uma parte assinou.
- Sem timestamp/LTV/revogação automática; a interface informa isso. A1 local não integra tokens A3. Certificados vencidos/ainda não válidos e senha incorreta são recusados.
- Nenhuma migração nova: reutiliza tabelas privadas existentes, tipo do documento é varchar. Nenhum certificado real foi utilizado nem documento real assinado nos testes.

## Testes
(a) Automáticos: 19 testes (5 arquivos) aprovados: validação/geração de contrato, persistência e rollback PGlite, autorização, status, criptografia/importação/isolamento, validade/senha, formulário assíncrono; assinatura CMS verificada independentemente com OpenSSL, duas assinaturas e adulteração detectada.
(a) Compilação de navegador esbuild (página e assinador separados) e TypeScript estrito dos helpers aprovados. Checagem geral do checkout parcial tem diagnósticos preexistentes fora da frente; novo erro de iteração foi corrigido.
(b) DOM React com componentes reais e API simulada: um clique grava/exibe o PDF; botão abre certificado/senha; aba importa certificados — aprovado.
(c) Preview dpl_6NHQtcJJpabecLhD292DhfEjYx3Z READY no commit 81679f6837699b33d1378dd6554133b80e44c5e6, HTTP 200 em /admin/juridico, testes da plataforma, TypeScript completo e build aprovados. Revisão automática do commit inicial concluída sem achados. PR #291 integrado por squash em df1b016da30f00bbbd00f4fee6aefffae67d76f3; produção dpl_9LcNUxCqp17DA9NcxWL2p64zUtwJ READY no mesmo merge, aliases www.prospectaconstrucoes.com e prospectaconstrucoes.com confirmados; HTTP 200 no domínio oficial em / e /admin/juridico. Primeiro uso com certificado real será feito pelo dono na interface, com sua própria senha.

## Paridade
Conferido `Grupo-Santa-Fe/web/src/lib/actions/juridico.ts` remoto (cf5f5e7c906c87dd7e63b4c20bb4f8c3c79a1ad2): tem geração/anexos, sem certificados. Pendente portar PDF automático para modelos novos e certificados/assinatura local para Santa Fé; não mexer em sua frente em andamento. Nenhuma exclusividade presumida.

## Checkpoint no GitHub
PR #291: https://github.com/Viniciusoluap/Prospecta/pull/291 — commit inicial remoto db9c19718cda49d3696010e91d400b0195f8630c confirmado. Preview dpl_D2Q92hq68Yam3RxKBT56KKrgX15q em build. Acrescentados teste PFX legado RC2/3DES e leitura da cópia privada mesmo quando existe URL legada, sem acessar essa URL.

## Encerramento
Implementação publicada e confirmada. Este checkpoint final fica na branch de trabalho já integrada, para evitar novo deployment apenas de documentação. Sem migração de banco nesta frente, sem certificados ou senhas reais no repositório. As demais correções do Fabel foram preservadas.

## Próximo passo exato
Dono: abrir /admin/juridico → Certificados digitais → selecionar o A1 .pfx/.p12, informar a senha e Importar certificado. No contrato, Gerar PDF já o anexa; no documento, Assinar digitalmente, selecionar o certificado, informar senha e confirmar. A cópia assinada aparece nos documentos, preservando o original. Primeiro uso com certificado real permanece validação operacional do dono. Portar esta frente ao Grupo Santa Fé conforme pendência de paridade.
