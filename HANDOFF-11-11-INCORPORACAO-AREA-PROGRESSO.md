# Handoff — Área e progresso da Incorporação

## Concluído

- Inteligência de Mercado oferece Lote, Casa e Apartamento. A consulta por Lote continua incluindo anúncios descritos como terreno.
- A lista de estudos apresenta a área em m². Para estudo sem poligonal marcado como sem KML, a área vem do mesmo somatório dos lotes avulsos. Para estudo com KML, vem da poligonal salva. A aba Terreno mostra m² em destaque e ha em texto secundário.
- O progresso do Desmembramento Simples usa as etapas aplicáveis desse fluxo, inclui Due Diligence e Unidades à Venda, e dispensa Estudo de Massa quando o estudo declara que não tem KML e está sem poligonal. Topografia conta com grade ou levantamento enviado. Unidades à Venda conta quando há unidades cadastradas.
- A confirmação do salvamento atualiza os dados e o progresso na própria tela. As consultas de mercado e os ajustes de inventário também atualizam o painel.

## Testes

- (a) TypeScript, build e 40 testes direcionados aprovados.
- (b) DOM com API simulada: conferidos 500,00 m² para três lotes de 125, 125 e 250 m², área do KML em m² acima de ha, tipologia e atualização da barra após gravar Due Diligence e criar unidade.
- (c) Confirmar deploy e resposta da API. A conferência nos estudos reais do iPad usa os registros já salvos.

## Próximo passo

- Portar a regra ao Grupo Santa Fé. A versão local desse repositório ainda calcula o progresso de todas as fases para Desmembramento Simples.
