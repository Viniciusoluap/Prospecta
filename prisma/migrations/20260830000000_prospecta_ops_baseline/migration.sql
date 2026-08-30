-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "ops_imoveis" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "preco" DOUBLE PRECISION NOT NULL,
    "precoNegociavel" BOOLEAN NOT NULL DEFAULT false,
    "condominio" DOUBLE PRECISION,
    "iptu" DOUBLE PRECISION,
    "area" DOUBLE PRECISION NOT NULL,
    "areaTotal" DOUBLE PRECISION,
    "quartos" INTEGER,
    "suites" INTEGER,
    "banheiros" INTEGER,
    "vagas" INTEGER,
    "rua" TEXT NOT NULL DEFAULT '',
    "bairro" TEXT NOT NULL,
    "cidade" TEXT NOT NULL DEFAULT 'Canaã dos Carajás',
    "estado" TEXT NOT NULL DEFAULT 'PA',
    "cep" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "features" TEXT NOT NULL DEFAULT '[]',
    "imagens" TEXT NOT NULL DEFAULT '[]',
    "destaque" BOOLEAN NOT NULL DEFAULT false,
    "badge" TEXT,
    "publicadoSite" BOOLEAN NOT NULL DEFAULT true,
    "publicadoZap" BOOLEAN NOT NULL DEFAULT false,
    "publicadoOlx" BOOLEAN NOT NULL DEFAULT false,
    "publicadoViva" BOOLEAN NOT NULL DEFAULT false,
    "corretorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_imoveis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_leads" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "email" TEXT,
    "servico" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'novo',
    "origem" TEXT NOT NULL DEFAULT 'site',
    "corretorId" TEXT,
    "imovelInteresseId" TEXT,
    "orcamento" DOUBLE PRECISION,
    "notas" TEXT NOT NULL DEFAULT '',
    "senhaAcesso" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_interacoes" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPor" TEXT NOT NULL,

    CONSTRAINT "ops_interacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_visitas" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "imovelId" TEXT,
    "corretorId" TEXT,
    "clienteNome" TEXT NOT NULL,
    "clienteTel" TEXT NOT NULL,
    "agendadaPara" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'agendada',
    "tipoVisita" TEXT NOT NULL DEFAULT 'imovel',
    "colaboradorNome" TEXT,
    "notas" TEXT NOT NULL DEFAULT '',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_visitas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_corretores" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "creci" TEXT NOT NULL,
    "foto" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "especialidades" TEXT NOT NULL DEFAULT '[]',
    "senhaAcesso" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_corretores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_comissoes" (
    "id" TEXT NOT NULL,
    "beneficiario" TEXT NOT NULL DEFAULT 'corretor',
    "tipoNegocio" TEXT NOT NULL DEFAULT 'venda_imovel',
    "corretorId" TEXT,
    "contratoId" TEXT,
    "imovel" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "percentual" DOUBLE PRECISION NOT NULL DEFAULT 6,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "vencimento" TIMESTAMP(3) NOT NULL,
    "pagamentoEm" TIMESTAMP(3),
    "notas" TEXT NOT NULL DEFAULT '',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_comissoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_financiamentos" (
    "id" TEXT NOT NULL,
    "clienteNome" TEXT NOT NULL,
    "clienteCpf" TEXT,
    "clienteTel" TEXT NOT NULL,
    "clienteEmail" TEXT,
    "imovel" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "banco" TEXT NOT NULL,
    "valorImovel" DOUBLE PRECISION NOT NULL,
    "valorFinanciado" DOUBLE PRECISION NOT NULL,
    "entrada" DOUBLE PRECISION NOT NULL,
    "taxa" DOUBLE PRECISION NOT NULL,
    "prazo" INTEGER NOT NULL,
    "parcela" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'analise_credito',
    "protocolo" TEXT,
    "leadId" TEXT,
    "imovelVinculadoId" TEXT,
    "corretorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_financiamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_checklist_items" (
    "id" TEXT NOT NULL,
    "financiamentoId" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "concluido" BOOLEAN NOT NULL DEFAULT false,
    "concluidoEm" TIMESTAMP(3),
    "notas" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ops_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_obras" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'orcamento',
    "clienteNome" TEXT NOT NULL,
    "clienteTel" TEXT NOT NULL,
    "endereco" TEXT NOT NULL,
    "area" DOUBLE PRECISION NOT NULL,
    "valorTotal" DOUBLE PRECISION NOT NULL,
    "valorPago" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progresso" INTEGER NOT NULL DEFAULT 0,
    "engenheiroResp" TEXT NOT NULL,
    "dataInicio" TIMESTAMP(3),
    "dataPrevisaoFim" TIMESTAMP(3),
    "dataConclusao" TIMESTAMP(3),
    "leadId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "descricao" TEXT NOT NULL DEFAULT '',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_obras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_obra_etapas" (
    "id" TEXT NOT NULL,
    "obraId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "percentual" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_obra_etapas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_obra_diario" (
    "id" TEXT NOT NULL,
    "obraId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "descricao" TEXT NOT NULL,
    "fotos" TEXT NOT NULL DEFAULT '[]',
    "responsavel" TEXT NOT NULL,
    "clima" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_obra_diario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_projetos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'orcamento',
    "clienteNome" TEXT NOT NULL,
    "clienteTel" TEXT NOT NULL,
    "engenheiro" TEXT NOT NULL,
    "valorProjeto" DOUBLE PRECISION NOT NULL,
    "valorPago" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "prazoEntrega" TIMESTAMP(3),
    "leadId" TEXT,
    "descricao" TEXT NOT NULL DEFAULT '',
    "arquivos" TEXT NOT NULL DEFAULT '[]',
    "checklist" TEXT NOT NULL DEFAULT '[]',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_projetos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_regularizacoes" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'analise',
    "clienteNome" TEXT NOT NULL,
    "clienteTel" TEXT NOT NULL,
    "endereco" TEXT NOT NULL,
    "matricula" TEXT,
    "cartorio" TEXT,
    "responsavel" TEXT NOT NULL,
    "leadId" TEXT,
    "valorServico" DOUBLE PRECISION NOT NULL,
    "valorPago" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "previsaoFim" TIMESTAMP(3),
    "descricao" TEXT NOT NULL DEFAULT '',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_regularizacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_reg_documentos" (
    "id" TEXT NOT NULL,
    "regularizacaoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "observacao" TEXT NOT NULL DEFAULT '',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_reg_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_contratos" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'rascunho',
    "parteA" TEXT NOT NULL,
    "parteADoc" TEXT,
    "parteB" TEXT NOT NULL,
    "parteBDoc" TEXT,
    "imovelId" TEXT,
    "leadId" TEXT,
    "valor" DOUBLE PRECISION NOT NULL,
    "vencimento" TIMESTAMP(3),
    "descricao" TEXT NOT NULL DEFAULT '',
    "clausulas" TEXT NOT NULL DEFAULT '',
    "contratoAssinadoUrl" TEXT,
    "assinaturaStatus" TEXT NOT NULL DEFAULT 'pendente',
    "assinaturaGovId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_contratos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_contrato_documentos" (
    "id" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_contrato_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_chat_mensagens" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "remetente" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "lido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_chat_mensagens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_agregador_imoveis" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "preco" DOUBLE PRECISION,
    "precoTexto" TEXT,
    "area" DOUBLE PRECISION,
    "tipo" TEXT,
    "bairro" TEXT,
    "cidade" TEXT NOT NULL DEFAULT 'Canaã dos Carajás',
    "estado" TEXT NOT NULL DEFAULT 'PA',
    "fonte" TEXT NOT NULL,
    "urlFonte" TEXT,
    "imagens" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "documentoTipo" TEXT NOT NULL DEFAULT 'nenhum',
    "documentoObs" TEXT,
    "contatoNome" TEXT,
    "contatoTel" TEXT,
    "notas" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_agregador_imoveis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_configuracoes" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "grupo" TEXT NOT NULL DEFAULT 'geral',

    CONSTRAINT "ops_configuracoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_bpo_clientes" (
    "id" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "cnpj" TEXT,
    "cpf" TEXT,
    "responsavel" TEXT NOT NULL,
    "email" TEXT,
    "telefone" TEXT NOT NULL,
    "servicos" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "honorarios" DOUBLE PRECISION NOT NULL,
    "diaVencimento" INTEGER NOT NULL DEFAULT 10,
    "dataInicio" TIMESTAMP(3) NOT NULL,
    "observacoes" TEXT NOT NULL DEFAULT '',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_bpo_clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_bpo_lancamentos" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT,
    "clienteNomeLivre" TEXT,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "pago" BOOLEAN NOT NULL DEFAULT false,
    "pagoEm" TIMESTAMP(3),
    "competencia" TEXT NOT NULL,
    "centroCustos" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_bpo_lancamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_avaliacoes" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "finalidade" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'solicitada',
    "clienteNome" TEXT NOT NULL,
    "clienteCpf" TEXT,
    "clienteTel" TEXT NOT NULL,
    "clienteEmail" TEXT,
    "endereco" TEXT NOT NULL,
    "bairro" TEXT NOT NULL,
    "cidade" TEXT NOT NULL DEFAULT 'Canaã dos Carajás',
    "estado" TEXT NOT NULL DEFAULT 'PA',
    "areaConstruida" DOUBLE PRECISION,
    "areaTerreno" DOUBLE PRECISION,
    "quartos" INTEGER,
    "banheiros" INTEGER,
    "vagas" INTEGER,
    "caracteristicas" TEXT NOT NULL DEFAULT '',
    "metodologia" TEXT NOT NULL DEFAULT 'comparativo',
    "valorEstimado" DOUBLE PRECISION,
    "avaliador" TEXT NOT NULL,
    "dataVistoria" TIMESTAMP(3),
    "prazoEntrega" TIMESTAMP(3),
    "dataEntrega" TIMESTAMP(3),
    "observacoes" TEXT NOT NULL DEFAULT '',
    "laudo" TEXT,
    "documentos" TEXT NOT NULL DEFAULT '[]',
    "sugestaoJson" TEXT,
    "valorServico" DOUBLE PRECISION,
    "leadId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_avaliacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_usuarios" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "papel" TEXT NOT NULL DEFAULT 'colaborador',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "creci" TEXT,
    "telefone" TEXT,
    "foto" TEXT,
    "permissoes" TEXT NOT NULL DEFAULT '[]',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_contas_bancarias" (
    "id" TEXT NOT NULL,
    "banco" TEXT NOT NULL,
    "agencia" TEXT,
    "conta" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'corrente',
    "descricao" TEXT,
    "saldoAtual" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "pluggyItemId" TEXT,
    "pluggyAccountId" TEXT,
    "webhookUrl" TEXT,
    "ultimaSincronizacao" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_contas_bancarias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_transacoes_bancarias" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "tipo" TEXT NOT NULL,
    "categoria" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "externalId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_transacoes_bancarias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_lancamentos" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "vencimento" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "formaPagamento" TEXT,
    "referencia" TEXT,
    "competencia" TEXT NOT NULL,
    "fornecedor" TEXT,
    "observacoes" TEXT NOT NULL DEFAULT '',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_lancamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_conexoes_whatsapp" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "provedor" TEXT NOT NULL DEFAULT 'evolution',
    "instancia" TEXT,
    "token" TEXT,
    "phoneNumberId" TEXT,
    "numero" TEXT,
    "status" TEXT NOT NULL DEFAULT 'desconectado',
    "qrCode" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_conexoes_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_mensagens_whatsapp" (
    "id" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "leadId" TEXT,
    "destinatario" TEXT NOT NULL,
    "nomeDestinatario" TEXT,
    "mensagem" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enviada',
    "externalId" TEXT,
    "erroMsg" TEXT,
    "enviadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_mensagens_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_notificacoes" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "link" TEXT,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_estudos_incorporacao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "municipio" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PA',
    "endereco" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "responsavel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'rascunho',
    "imovelId" TEXT,
    "kmlUrl" TEXT,
    "geojson" TEXT,
    "areaM2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "perimetroM" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "centroLat" DOUBLE PRECISION,
    "centroLng" DOUBLE PRECISION,
    "appAreaM2" DOUBLE PRECISION,
    "appLarguraM" DOUBLE PRECISION,
    "appOrigem" TEXT,
    "elevacaoJson" TEXT,
    "levantamentoUrl" TEXT,
    "corteAterroJson" TEXT,
    "parametrosJson" TEXT,
    "potencialJson" TEXT,
    "urbanismoParecer" TEXT,
    "pesquisaCidadeJson" TEXT,
    "estudoMercadoJson" TEXT,
    "precificacaoComparaveisJson" TEXT,
    "pesquisaPrimariaJson" TEXT,
    "massaCenariosJson" TEXT,
    "cenarioEscolhidoId" TEXT,
    "quadroAreasJson" TEXT,
    "orcamentoParametrizadoJson" TEXT,
    "negociacaoTerrenoJson" TEXT,
    "businessPlanJson" TEXT,
    "projetistasJson" TEXT,
    "aprovacaoProjetoJson" TEXT,
    "registroIncorporacaoJson" TEXT,
    "orcamentoPreliminarJson" TEXT,
    "planejamentoLancamentoJson" TEXT,
    "fornecedoresLancamentoJson" TEXT,
    "materialPublicitarioJson" TEXT,
    "lancamentoImobiliarioJson" TEXT,
    "projetosExecutivosJson" TEXT,
    "orcamentoObraJson" TEXT,
    "cronogramaObraJson" TEXT,
    "atendimentoClientesJson" TEXT,
    "mixJson" TEXT,
    "viabilidadeJson" TEXT,
    "cronogramaJson" TEXT,
    "parecerIa" TEXT,
    "loteamentoJson" TEXT,
    "relatorios" TEXT NOT NULL DEFAULT '[]',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_estudos_incorporacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_arquivos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "tamanho" INTEGER NOT NULL DEFAULT 0,
    "dados" BYTEA NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_arquivos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ops_imoveis_slug_key" ON "ops_imoveis"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ops_corretores_email_key" ON "ops_corretores"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ops_contratos_numero_key" ON "ops_contratos"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "ops_configuracoes_chave_key" ON "ops_configuracoes"("chave");

-- CreateIndex
CREATE UNIQUE INDEX "ops_avaliacoes_numero_key" ON "ops_avaliacoes"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "ops_usuarios_email_key" ON "ops_usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ops_transacoes_bancarias_externalId_key" ON "ops_transacoes_bancarias"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ops_conexoes_whatsapp_usuarioId_key" ON "ops_conexoes_whatsapp"("usuarioId");

-- CreateIndex
CREATE INDEX "ops_notificacoes_usuarioId_lida_idx" ON "ops_notificacoes"("usuarioId", "lida");

-- CreateIndex
CREATE INDEX "ops_estudos_incorporacao_status_idx" ON "ops_estudos_incorporacao"("status");

-- AddForeignKey
ALTER TABLE "ops_imoveis" ADD CONSTRAINT "ops_imoveis_corretorId_fkey" FOREIGN KEY ("corretorId") REFERENCES "ops_corretores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_leads" ADD CONSTRAINT "ops_leads_corretorId_fkey" FOREIGN KEY ("corretorId") REFERENCES "ops_corretores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_leads" ADD CONSTRAINT "ops_leads_imovelInteresseId_fkey" FOREIGN KEY ("imovelInteresseId") REFERENCES "ops_imoveis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_interacoes" ADD CONSTRAINT "ops_interacoes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ops_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_visitas" ADD CONSTRAINT "ops_visitas_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ops_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_visitas" ADD CONSTRAINT "ops_visitas_imovelId_fkey" FOREIGN KEY ("imovelId") REFERENCES "ops_imoveis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_visitas" ADD CONSTRAINT "ops_visitas_corretorId_fkey" FOREIGN KEY ("corretorId") REFERENCES "ops_corretores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_comissoes" ADD CONSTRAINT "ops_comissoes_corretorId_fkey" FOREIGN KEY ("corretorId") REFERENCES "ops_corretores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_comissoes" ADD CONSTRAINT "ops_comissoes_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "ops_contratos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_financiamentos" ADD CONSTRAINT "ops_financiamentos_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ops_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_financiamentos" ADD CONSTRAINT "ops_financiamentos_imovelVinculadoId_fkey" FOREIGN KEY ("imovelVinculadoId") REFERENCES "ops_imoveis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_financiamentos" ADD CONSTRAINT "ops_financiamentos_corretorId_fkey" FOREIGN KEY ("corretorId") REFERENCES "ops_corretores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_checklist_items" ADD CONSTRAINT "ops_checklist_items_financiamentoId_fkey" FOREIGN KEY ("financiamentoId") REFERENCES "ops_financiamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_obras" ADD CONSTRAINT "ops_obras_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ops_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_obra_etapas" ADD CONSTRAINT "ops_obra_etapas_obraId_fkey" FOREIGN KEY ("obraId") REFERENCES "ops_obras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_obra_diario" ADD CONSTRAINT "ops_obra_diario_obraId_fkey" FOREIGN KEY ("obraId") REFERENCES "ops_obras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_projetos" ADD CONSTRAINT "ops_projetos_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ops_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_regularizacoes" ADD CONSTRAINT "ops_regularizacoes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ops_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_reg_documentos" ADD CONSTRAINT "ops_reg_documentos_regularizacaoId_fkey" FOREIGN KEY ("regularizacaoId") REFERENCES "ops_regularizacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_contratos" ADD CONSTRAINT "ops_contratos_imovelId_fkey" FOREIGN KEY ("imovelId") REFERENCES "ops_imoveis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_contratos" ADD CONSTRAINT "ops_contratos_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ops_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_contrato_documentos" ADD CONSTRAINT "ops_contrato_documentos_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "ops_contratos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_chat_mensagens" ADD CONSTRAINT "ops_chat_mensagens_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ops_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_bpo_lancamentos" ADD CONSTRAINT "ops_bpo_lancamentos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "ops_bpo_clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_avaliacoes" ADD CONSTRAINT "ops_avaliacoes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ops_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_transacoes_bancarias" ADD CONSTRAINT "ops_transacoes_bancarias_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "ops_contas_bancarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_conexoes_whatsapp" ADD CONSTRAINT "ops_conexoes_whatsapp_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "ops_usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_mensagens_whatsapp" ADD CONSTRAINT "ops_mensagens_whatsapp_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "ops_conexoes_whatsapp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_estudos_incorporacao" ADD CONSTRAINT "ops_estudos_incorporacao_imovelId_fkey" FOREIGN KEY ("imovelId") REFERENCES "ops_imoveis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
