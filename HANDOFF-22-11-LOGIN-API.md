# Recuperação do login em produção

A API retornou FUNCTION_INVOCATION_FAILED inclusive em /api/health. O carregamento ESM do JSON das raízes do Jurídico reproduziu ERR_IMPORT_ATTRIBUTE_MISSING no Node 24. O atributo explícito permitiu carregar as dez raízes. Incluído teste de regressão dos imports do servidor. Mudança específica ao empacotamento da Prospecta, sem mudança de regra de negócio ou banco. Próximo passo: verificar revisão, preview, saúde da API e autenticação em produção.
