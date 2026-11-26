# E12 — Grupo: escolher o cliente (ou a obra) pelo nome

**Status:** InReview · **Epic:** EPIC-025 (Dolores) · **Data:** 26/11/2026

## Pedido do dono

Na tela Dolores › Grupos, ao classificar um grupo como "cliente" (ou pós-atendimento), a tela pedia o "Nº do cliente no CRM".
Palavras do dono: "eu quero poder procurar pelo nome e não só pelo número que eu nem sei decorar".

## Critérios de aceite

- [x] Nos 3 lugares (cadastro manual e "Definir/Corrigir tipo ou vínculo" no cartão da Dolores; "Definir tipo" na Central
      WhatsApp) o campo de número virou um campo de busca pelo nome: digita parte do nome → lista de clientes do CRM que
      combinam → toca em um → o nome aparece no campo, com o "X" para trocar.
- [x] Tipo engenharia: o mesmo, buscando a obra pelo título.
- [x] Um componente só para os 3 lugares; sem botão novo; Salvar/Cancelar iguais.
- [x] Ao servidor continua indo o id (contrato de `cadastrar` e `definirTipo` igual).
- [x] Grupo já vinculado abre mostrando o nome atual (as duas listas já trazem o nome do cliente/obra).
- [x] Rota de busca: só admin (o mesmo de quem classifica), só id + nome, até 20, sem leads excluídos, sem diferenciar
      acento/maiúscula; `%` e `_` não viram curinga.
- [x] Lista tocável (iPad), sem depender de hover.
- [x] Nenhuma regra da Dolores no servidor mudou; sem migração; sem dependência nova.

Ajuste junto: trocar o tipo entre "cliente" e "engenharia" (ou para um tipo sem vínculo) zera o vínculo escolhido, para o nº de
um cliente não ir como nº de obra (antes o número ficava no campo).

## File List

- `client/src/components/admin/BuscaClienteOuObra.tsx` (novo — campo de busca compartilhado)
- `client/src/components/admin/DoloresGruposCard.tsx` (cadastro manual e editar tipo/vínculo)
- `client/src/components/whatsapp/GruposWhatsApp.tsx` (Definir tipo na Central)
- `server/dolores/grupos-router.ts` (rota `dolores.grupos.buscarVinculo`)
- `server/dolores/e12-buscar-vinculo.test.ts` (novo)

## Testes

- (a) Automáticos: `npx tsc --noEmit` limpo; `server/dolores/e12-buscar-vinculo.test.ts` 7/7 (parte do nome sem acento,
  só id + nome, excluído fora, obra pelo título, curinga escapado, teto de 20, permissão); vizinhos `c3-categorias-grupos`,
  `grupos-qa` e `c2-grupos-na-central` passando.
- (b) Manuais: não feitos (sem navegador nesta sessão).
- (c) Em produção: conferir no iPad a busca nos 3 lugares.
