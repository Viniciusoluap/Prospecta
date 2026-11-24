# EPIC-030 S-1 — Gerador de PCI: correções pedidas pelo dono em 24/11/2026

**Status:** InReview (etapas A e B prontas; pendências na etapa C)

## Pedido do dono (24/11/2026, com 10 prints, a planilha e o PDF gerados)

1. Cidade e estado devem vir sozinhos do cadastro.
2. Construtora e CNPJ devem vir das empresas do módulo fiscal (as que têm cadastro e certificado digital; "podem ser algumas").
3. "Esquadrias internas" deve ser de selecionar, com as opções da planilha.
4. "Local e data" deve sair sozinho: a cidade da obra e a data do dia em que o documento é feito.
5. Na planilha, o número da ART não apareceu.
6. Área construída total = área coberta padrão + área acessória coberta, e tem de bater com a área cadastrada na obra.
7. A foto de localização não aparece do jeito certo.
8. O resumo dos custos saiu errado (terreno, total de serviços, BDI, produção e os valores por m²).
9. O PDF "veio todo errado": tem de sair idêntico à planilha.

## Diagnóstico (conferido na planilha enviada)

- **Itens 5, 6 e parte do 8 — os valores ESTÃO na planilha.** O número da ART (`AF65`/`AF66`), a área total (`AC73` = 57,14), o valor do terreno
  (`AP149`) e os unitários por m² (`AT149:AT152`) estão gravados/calculados e aparecem no LibreOffice. O Google Planilhas (iPad) esconde
  essas células: o modelo oficial tem formatação condicional que ele lê como "fonte branca". Não é defeito dos dados; é o leitor.
- **Item 8 — erro real de preenchimento:** a coluna de custos é em R$, e foram digitados os percentuais (3,10; 7,00…), então o total de
  serviços saiu R$ 100,00. Decisão pendente do dono: digitar por percentual (o sistema calcula os R$) ou manter em R$ com aviso.
- **Item 7 — defeito real:** no modelo oficial em uso, o último desenho da aba tem caixa de texto (OBJ + MSODRAWING 0xF00D + TXO). A foto
  era gravada no meio desses registros, e LibreOffice/Google Planilhas deixavam de mostrá-la.
- **Item 3:** a validação de dados do modelo cobre `G106:U106`; o sistema só ligava a lista à primeira célula (`G106`).

## Etapa A — campos da tela e foto (FEITO)

- [x] Cidade e UF: do cadastro da obra; sem ele, do fim do endereço da obra ("…, Imperatriz-MA") e, por último, do endereço do cliente
      (`cidadeUfDoEnderecoPci`). Só reconhece UF válida depois de "-", "/" ou "–": nada é adivinhado.
- [x] Construtora/CNPJ: a tela recebe as empresas do módulo fiscal (um item por CNPJ de perfil tributário, com "tem certificado digital
      válido"). O campo vira lista ("— sem construtora —", as empresas, "Outra (digitar)"); escolher preenche nome e CNPJ. Em "Dados
      automáticos", entra sozinha quando só UMA serve (a única com certificado, ou a única cadastrada); com mais de uma, a pessoa escolhe.
- [x] Esquadrias internas: lista com as opções de `G106:U106` (Alumínio, Ferro, Vidro Temperado, PVC, Madeira, Outros).
- [x] Local e data: em branco, sai na geração como "Imperatriz - MA, 24 de novembro de 2026" (cidade/UF do imóvel + dia da geração, horário
      de Imperatriz). O rascunho continua em branco (a próxima geração sai com a data dela). Quem digitar continua mandando.
- [x] Área: a tela mostra a área construída total (coberta + acessória) e avisa quando difere da área cadastrada na obra.
- [x] Resumo dos custos na tela, como na planilha: terreno, serviços, BDI, serviços com BDI, produção e os valores por m².
- [x] Foto: entra depois da caixa de texto do último desenho (`substituirFotos`).
- [x] Teste antigo `pci-gerador-db.test.ts` voltou a rodar (faltava a coluna `pci_lot_cost` do #339 na tabela de teste).

## Etapa B — PDF idêntico à planilha (FEITO)

- [x] Renderizador do PDF a partir do .xls gerado (mesmas células, cores, bordas, logotipo, foto), com as fórmulas recalculadas.
- [x] Geração usa o PDF fiel; se falhar, cai no PDF antigo com aviso.

- [x] Foto recortada na proporção do quadro (~3,03 por 1), com a escolha da parte (de cima, do meio, de baixo): preenche o quadro sem
      faixas e sem esticar (`recorteParaQuadroPci`, `fotoNoFormatoDoQuadroPci`).

## Etapa C — pendências

- [x] Custos pelos DOIS campos (resposta do dono em 24/11: "tenho que poder editar os dois campos, o das incidências e o dos valores"):
      incidência (%) e custo (R$) são de digitar; o percentual calcula o R$ sobre a base `(valor do imóvel − terreno) ÷ (1 + BDI)`
      (`baseDosCustosPci`), e o R$ recalcula o percentual. Custos que somam 100,00 no campo de R$ ganham o aviso com "Converter em R$".
- [ ] Planilha no Google Planilhas: neutralizar a formatação condicional que esconde os valores, se não mudar nada no Excel/LibreOffice.

## Testes

- `server/pci-correcoes-24-11.test.ts` (novo, 7 testes): cidade/UF do endereço, empresa única do fiscal, lista das esquadrias, local e
  data, ordem dos registros da foto (inclusive trocar a foto duas vezes).
- `server/pci-gerador-db.test.ts`: caso novo (empresas do fiscal e área da obra na tela; local e data na geração; rascunho em branco).
- Manual (24/11): a planilha enviada pelo dono foi reprocessada com a foto dele e conferida no LibreOffice — a foto aparece no quadro.
- Pendente: conferir em produção na obra da cliente (tela e arquivos gerados).

## File List

- `shared/pci-gerador.ts` — `EmpresaPci`, `empresaUnicaPci`, `formatarCnpjPci`, `cidadeUfDoEnderecoPci`, `localDataPci`; esquadrias internas
  como lista; sugestões de município/UF e construtora.
- `server/pci-gerador.ts` — `empresasFiscaisPci`; `obter` devolve `empresas` e `areaObra`; local e data na geração.
- `server/caixa/biff8-imagens.ts` — posição de inserção da foto.
- `client/src/components/obra/GeradorPciAba.tsx` — lista da construtora, dica do local e data, área total com aviso, resumo dos custos.
- `server/pci-correcoes-24-11.test.ts` (novo), `server/pci-gerador-db.test.ts`, `server/pci-lote3.test.ts`.

## Change Log

- 24/11/2026 — @dev (Dex): PDF fiel à planilha (renderizador BIFF8 + fórmulas recalculadas) e foto recortada na proporção do quadro.
- 24/11/2026 — @qa (Quinn): portão rápido da parte da tela (ddc7863) — PASS.
- 24/11/2026 — @dev (Dex): custos pelos dois campos (percentual e R$), com conversão dos percentuais já digitados.
- 24/11/2026 — @dev (Dex): etapa A (campos, foto, testes) e diagnóstico da planilha enviada pelo dono.
