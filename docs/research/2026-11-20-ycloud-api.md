# YCloud API (WhatsApp) — pesquisa técnica para o Prospecta (20/11/2026)

## ATUALIZAÇÃO 20/11 (2ª rodada)

- Pedido do coordenador: `docs.ycloud.com` teria sido liberado. **Continua bloqueado** (DNS `ENOTFOUND`). Tentei de novo depois de ~30 s
  de espera e falhou igual. Nenhuma página oficial foi aberta. Os itens 1 (assinatura e reenvio), 2 (coexistência), 3 (o `+`) e
  4 (lista de códigos de erro) continuam como estavam abaixo.
- **Confirmado nesta rodada pelo SDK oficial (gerado do OpenAPI):**
  - **Paginação** (`models/whatsapp-template-page.ts`, `models/whatsapp-phone-number-page.ts`):
    `{ items?: [...], offset: number (base 0), limit: number (1–100, padrão 10), length: number (itens nesta página), total?: number (só com includeTotal=true) }`.
    Na requisição vão `page` (base 1) e `limit`.
  - **Exemplo de template com cabeçalho de imagem** (`models/whatsapp-template-component-example.ts`): o campo é
    `example.header_url: string[]` (URL de mídia de exemplo para HEADER IMAGE/GIF/VIDEO/DOCUMENT). Na YCloud **não é** o `header_handle`
    da Meta. Também há `example.header_text: string[]` e `example.body_text: string[][]`. Exemplo:
    `{ "type":"HEADER","format":"IMAGE","example":{"header_url":["https://.../amostra.jpg"]} }`,
    `{ "type":"BODY","text":"Olá {{1}}, conheça o {{2}}","example":{"body_text":[["Maria","Jardim X"]]} }`.
  - **Erro da Meta embutido** (`models/whatsapp-api-error.ts`): `whatsappApiError = { code (string, obrigatório), message (obrigatório),
    type, is_transient (bool), error_subcode, error_user_msg, error_user_title, fbtrace_id, error_data }`. Os códigos são os da Cloud API
    da Meta (o SDK aponta para a página de códigos da Meta). `is_transient` serve para decidir se vale reenviar.
  - **Formato do número:** o SDK só diz "E.164" (também no recebimento, em `models/whatsapp-inbound-message.ts`), sem valor de exemplo.
    O `+` continua sem confirmação. Recomendação: enviar com `+` e normalizar a comparação (tirar `+`) no recebimento.

## 0. Como esta pesquisa foi feita (ler antes)

- **docs.ycloud.com, www.ycloud.com e helpdocs.ycloud.com estão BLOQUEADOS nesta sessão** (DNS não resolve: fora da lista de domínios permitidos). Nenhuma página desses hosts foi aberta.
- **Fonte primária usada:** o SDK Node OFICIAL da YCloud, gerado automaticamente a partir do OpenAPI da API v2
  (`github.com/ycloud-cpaas/ycloud-sdk-node`, lido via `raw.githubusercontent.com`). Os modelos/enums abaixo vêm dele
  e são confiáveis para nomes de campos, endpoints e enums (confiança ALTA).
- **Fonte secundária:** trechos de resultados do WebSearch que citam páginas do docs.ycloud.com/ycloud.com. São resumos do
  buscador, não a página aberta — confiança MÉDIA. Marcado como **[via busca]**.
- Itens sem fonte oficial confirmável estão marcados **[NÃO CONFIRMADO]**.
- Para fechar os itens pendentes: liberar `docs.ycloud.com`, `www.ycloud.com` e `helpdocs.ycloud.com` nas configurações de rede da sessão.

Abreviações de fonte:
- SDK = `https://raw.githubusercontent.com/ycloud-cpaas/ycloud-sdk-node/main/<arquivo>` (repositório: https://github.com/ycloud-cpaas/ycloud-sdk-node)

---

## 1. Autenticação

| Item | Valor | Fonte |
|---|---|---|
| URL base | `https://api.ycloud.com/v2` | SDK README / https://github.com/ycloud-cpaas/ycloud-sdk-node ; README do MCP oficial https://raw.githubusercontent.com/YCloud-Developers/ycloud-whatsapp-mcp-server/main/README-en.md |
| Versão | v2 (o SDK diz "YCloud API v2") | idem |
| Cabeçalho | `X-API-Key: <chave>` | SDK `apis/whatsapp-messages-api.ts` (todas as operações setam `X-API-Key`) |
| Onde pega a chave | Console YCloud › página "Developers" | README do MCP oficial |
| Formato da chave | **[NÃO CONFIRMADO]** (string opaca; prefixo/tamanho não documentado no que foi lido) | — |
| Request ID | Resposta traz cabeçalho `YCloud-Request-ID`; o erro repete em `error.requestId` | SDK `models/error.ts` |
| Corpo | `Content-Type: application/json` | SDK `apis/whatsapp-messages-api.ts` |

Boa prática citada pela YCloud: chave fora do código, em variável de ambiente. [via busca] https://docs.ycloud.com/reference/whatsapp-message-sending-guide

## 2. Enviar mensagem do WhatsApp

### 2.1 Endpoints (SDK `apis/whatsapp-messages-api.ts`)

| Operação | Método/rota | Comportamento |
|---|---|---|
| Enqueue (fila) | `POST /v2/whatsapp/messages` | Assíncrono: grava e devolve o objeto com `id`; a YCloud submete à Meta depois. Template precisa estar `APPROVED` (`ARCHIVED` não envia). |
| Send directly | `POST /v2/whatsapp/messages/sendDirectly` | Síncrono: submete à Meta na hora; "tipicamente para OTP e mensagens instantâneas". Se a Meta recusar, a resposta traz `error.whatsappApiError`. |
| Consultar | `GET /v2/whatsapp/messages/{id}` | Retorna o `WhatsappMessage`. |

**Recomendação para campanha:** usar o **enqueue** (`/whatsapp/messages`): aceita 200 rps e a YCloud faz o ritmo para a Meta
(60 rps), além de ter `filterUnsubscribed`/`filterBlocked`, que só existem no enqueue. Isso casa bem com a função de 60 s da Vercel
(não precisa esperar a Meta). O status final chega por webhook.

### 2.2 Corpo — `WhatsappMessageSendRequest` (SDK `models/whatsapp-message-send-request.ts`)

Obrigatórios: `from` (E.164 do remetente), `type`, e **um de** `to` (E.164 do destinatário) ou `recipient` (BSUID). Se vierem os dois, vale `to`.
Opcionais úteis: `externalId` (sua referência, ex. id do disparo/contato — recomendado único), `filterUnsubscribed` (bool, padrão false,
só enqueue), `filterBlocked` (bool, só enqueue), `context` (responder mensagem), `customerProfile`.
Campos de "Direct Send" (`useDirectSend`, `category` utility/authentication, `ttlSeconds` 30–43200, `templateName`) são outro recurso
(conversão de template utility/auth) — **não usar** para marketing.

`type` (SDK `models/whatsapp-message-type.ts`): `template | text | image | audio | video | document | sticker | location | interactive | contacts | reaction`.

Formato do número: **E.164** (`+5543999998888`) — descrito assim em `from`/`to` no SDK. Se o `+` é obrigatório: [NÃO CONFIRMADO] (os exemplos da Meta/BSPs usam `+`; usar sempre com `+`).

#### (a) Template com variáveis e cabeçalho de imagem

Estrutura (SDK `models/whatsapp-message-template.ts`, `...-template-language.ts`, `...-template-component.ts`, `...-template-component-parameter.ts`, `...-media.ts`):

```json
{
  "from": "+55XXXXXXXXXXX",
  "to": "+55YYYYYYYYYYY",
  "type": "template",
  "externalId": "campanha-123:contato-456",
  "filterUnsubscribed": true,
  "template": {
    "name": "lancamento_residencial",
    "language": { "code": "pt_BR" },
    "components": [
      { "type": "header", "parameters": [ { "type": "image", "image": { "link": "https://.../foto.jpg" } } ] },
      { "type": "body",   "parameters": [ { "type": "text", "text": "Maria" }, { "type": "text", "text": "Jardim X" } ] },
      { "type": "button", "sub_type": "url", "index": 0, "parameters": [ { "type": "text", "text": "sufixo-da-url" } ] }
    ]
  }
}
```

Regras do SDK: `template.name` e `template.language.code` obrigatórios (`en` ou `en_US` aceitos; `policy` só `deterministic`);
`components` obrigatório quando o template tem variável ou mídia; `type` do componente em minúsculas
(`header|body|button|limited_time_offer|carousel|order_status`); `index` obrigatório em `button`; parâmetro `text` até 60 caracteres
no cabeçalho e 1024 no corpo; mídia por `link` (http/https) ou `id` (se vierem os dois vale `id`); a Meta guarda a mídia em cache
~10 min (sugere query string aleatória para trocar a imagem); `caption` não vale em cabeçalho de template.
Parâmetros nomeados (`parameter_name`, templates com `{{nome}}`): **[NÃO CONFIRMADO]** — o modelo do SDK lido não tem esse campo; usar variáveis posicionais `{{1}}`.

#### (b) Texto livre (só dentro da janela de 24 h)

```json
{ "from": "+55...", "to": "+55...", "type": "text", "text": { "body": "Olá!", "preview_url": false } }
```
`body` até 4096 caracteres; `preview_url` padrão false (SDK `models/whatsapp-message-text.ts`). Fora da janela a Meta recusa
(código Meta 131047 — explicação vinda de terceiros, [via busca] https://docs.ycloud.com/reference/whatsapp-errors não aberto).

#### (c) Imagem e áudio

```json
{ "from": "+55...", "to": "+55...", "type": "image", "image": { "link": "https://.../a.jpg", "caption": "legenda" } }
{ "from": "+55...", "to": "+55...", "type": "audio", "audio": { "link": "https://.../a.ogg" } }
```
(SDK `models/whatsapp-message-media.ts`: `id` ou `link`; `caption` vale para image/gif/video/document; `filename` só document.)
Formatos/tamanhos aceitos de áudio/imagem: [NÃO CONFIRMADO] na YCloud (seguem a Meta: áudio ogg/opus, mp3, aac, amr, m4a; imagem jpg/png ≤ 5 MB — conhecimento da API da Meta, não verificado nesta sessão).

### 2.3 Resposta — `WhatsappMessage` (SDK `models/whatsapp-message.ts`)

Sempre: `id` (id YCloud), `wabaId`, `from`. Demais: `wamid` (id na Meta), `to`, `type`, `status`, `externalId`, `errorCode`, `errorMessage`
(quando `failed`), `whatsappApiError`, `createTime`, `updateTime`, `sendTime`, `deliverTime`, `readTime` (RFC 3339), `totalPrice`
(estimado em accepted/sent, final em delivered/read), `currency` (ISO 4217), `regionCode`, `pricingCategory`, `pricingModel`, `pricingType`, `conversation`.

`status` (SDK `models/whatsapp-message-status.ts`): `accepted` (aceito pela YCloud) → `sent` (em trânsito na Meta) → `delivered` → `read`; ou `failed`.

### 2.4 Erros

Envelope (SDK `models/error-response.ts`, `models/error.ts`): `{ "error": { "status": <http>, "code": "<string>", "message", "target", "docUrl", "requestId", "whatsappApiError": {...} } }`.
- HTTP 429 quando passa do limite (ver 2.5). [via busca] https://docs.ycloud.com/reference/rate-limits
- Recomendação YCloud: separar erro da YCloud (validação) do erro da Meta (`whatsappApiError`), casar por código e não por texto;
  em erro de template conferir nome, idioma, status e componentes antes de reenviar. [via busca] https://docs.ycloud.com/reference/whatsapp-errors
- Lista dos valores de `error.code` da YCloud: **[NÃO CONFIRMADO]** (página https://docs.ycloud.com/reference/errors não aberta).
- Códigos Meta relevantes (fonte terceiros, [via busca]): 131047 = janela de 24 h fechada (usar template); 131049 = Meta não entregou marketing
  para preservar o ecossistema (não reenviar logo); 131026 / 131050 (não verificados nesta sessão).

### 2.5 Limites de taxa [via busca] https://docs.ycloud.com/reference/rate-limits

- Maioria dos endpoints: 200 rps por conta.
- Enqueue `/v2/whatsapp/messages`: até 200 rps por remetente; a YCloud submete à Meta a 60 rps.
- Enqueue + sendDirectly compartilham cota de conta: 200 rps **e 10.000 requisições/hora** (as duas valem). Esgotou a cota horária: esperar ≥ 1.800 s.
- Cabeçalhos `RateLimit-*` são beta.
- Guardar o `id` da resposta para reconciliar antes de reenviar após 429/tempo esgotado (evita mensagem duplicada).
- Throughput Meta em coexistência: ver seção 6 (5 mps segundo a YCloud; 20 mps segundo a Meta — conflito).
- Tier diário da Meta por número: `messagingLimit` (seção 4).

## 3. Templates (SDK `apis/whatsapp-templates-api.ts`)

| Operação | Rota |
|---|---|
| Listar | `GET /v2/whatsapp/templates?page=&limit=(1–100, padrão 10)&includeTotal=&filter.wabaId=&filter.name=&filter.language=&filter.status=APPROVED,PENDING` |
| Criar | `POST /v2/whatsapp/templates` |
| Ler um | `GET /v2/whatsapp/templates/{wabaId}/{name}/{language}` |
| Editar | `PATCH /v2/whatsapp/templates/{wabaId}/{name}/{language}` |
| Apagar idioma / nome | `DELETE .../{wabaId}/{name}/{language}` / `DELETE .../{wabaId}/{name}` |
| Analytics | `POST /v2/whatsapp/templates/analytics` |

Listagem inclui ARCHIVED quando casa com o filtro. Resposta `WhatsappTemplatePage` (provável `{ offset, limit, length, items[] }` + `total` com includeTotal — formato exato da página: [NÃO CONFIRMADO]).

Campos do `WhatsappTemplate` (SDK `models/whatsapp-template.ts`): `wabaId`, `name`, `language` (obrigatórios), `officialTemplateId`, `category`,
`subCategory`, `previousCategory`, `messageSendTtlSeconds`, `components[]`, `status`, `qualityRating`, `reason` (motivo da rejeição),
`createTime`, `updateTime`, `statusUpdateEvent`, `disableDate`, `whatsappApiError`.

`status` (SDK `models/whatsapp-template-status.ts`): `PENDING` (revisão até 24 h), `REJECTED`, `APPROVED` (único que envia), `PAUSED`, `DISABLED`, `ARCHIVED`, `IN_APPEAL`, `DELETED`.

`category` (SDK `models/whatsapp-template-category.ts`): `MARKETING`, `UTILITY`, `AUTHENTICATION`. Tudo que não é utility nem authentication é marketing.
**Todo template passa por aprovação da Meta** (status nasce `PENDING`). Texto livre/mídia sem template não precisa de aprovação, mas só vale na janela de 24 h.

Criar — `WhatsappTemplateCreateRequest` (SDK `models/whatsapp-template-create-request.ts`): obrigatórios `wabaId`, `name`, `language`, `category`, `components[]`;
opcionais `subCategory`, `messageSendTtlSeconds` (marketing 43.200–2.592.000 s; -1 = 30 dias), `ctaUrlLinkTrackingOptedOut`.
Componentes (SDK `models/whatsapp-template-component.ts`): `type` em MAIÚSCULAS `HEADER|BODY|FOOTER|BUTTONS|LIMITED_TIME_OFFER|CAROUSEL|CALL_PERMISSION_REQUEST`;
`format` do HEADER `TEXT|IMAGE|GIF|VIDEO|DOCUMENT|LOCATION`; `text`; `buttons[]`; `example` (exemplos das variáveis e, para cabeçalho de imagem,
amostra de mídia — formato exato do `example` [NÃO CONFIRMADO]; na Meta é `header_handle`, obtido por upload resumível).
Limites: corpo 1024, cabeçalho texto 60, rodapé 60. `BODY` obrigatório e único.
Atenção: no ENVIO o `type` do componente é minúsculo (`header`); na CRIAÇÃO é maiúsculo (`HEADER`).

Webhooks de template: `whatsapp.template.reviewed` (aprovado/rejeitado), `whatsapp.template.category_updated`, `whatsapp.template.quality_updated`.

## 4. Números / contas (SDK `apis/whatsapp-phone-numbers-api.ts`)

- Listar: `GET /v2/whatsapp/phoneNumbers?page=&limit=&includeTotal=&filter.wabaId=` → `WhatsappPhoneNumberPage`.
- Ler um: `GET /v2/whatsapp/phoneNumbers/{wabaId}/{phoneNumber}` (phoneNumber em E.164).
- Também: `/profile`, `/displayName`, `/settings`, `/register`.

Campos do `WhatsappPhoneNumber` (SDK `models/whatsapp-phone-number.ts`): `id`, `phoneNumber` (E.164), `displayPhoneNumber`, `wabaId`,
`verifiedName`, `nameStatus`, `qualityRating`, `messagingLimit`, `whatsappBusinessManagerMessagingLimit`, `status`, `codeVerificationStatus`,
`isOfficialBusinessAccount`, `throughputLevel` (`STANDARD|HIGH|NOT_APPLICABLE`), `updateEvent` (`ACCOUNT_RECONNECTED|ACCOUNT_OFFBOARDED`), `qualityUpdateEvent`.

- `status` (SDK `models/whatsapp-phone-number-status.ts`): `PENDING, UNVERIFIED, MANUAL_REVIEW, DISCONNECTED, CONNECTED` (ok), `FLAGGED, WARNED, RATE_LIMITED, BANNED, RESTRICTED` (bateu limite 24 h), `BLOCKED, MIGRATED, UNKNOWN`.
- `qualityRating` (SDK `models/whatsapp-phone-number-quality-rating.ts`): `GREEN, YELLOW, RED, UNKNOWN`.
- `messagingLimit` (string): `TIER_NOT_SET, TIER_50, TIER_250, TIER_1K, TIER_10K, TIER_100K, TIER_UNLIMITED` (conversas iniciadas pela empresa em 24 h móveis).

Para a tela "conexão conferida": `GET /whatsapp/phoneNumbers` e mostrar `status == CONNECTED`, `qualityRating`, `messagingLimit`, `verifiedName`, `throughputLevel`.
Se há campo explícito que diga "coexistência" no objeto do número: [NÃO CONFIRMADO] (não existe no modelo lido).
Webhooks do número: `whatsapp.phone_number.quality_updated`, `.name_updated`, `.deleted`; da conta: `whatsapp.business_account.updated/reviewed/deleted`.

## 5. Webhooks

Registro: por API (`POST /v2/webhookEndpoints` com `url` + `enabledEvents[]` obrigatórios, `description`, `status` opcionais) ou pelo Console
(Developers › Webhooks — [via busca]). Outras rotas: `GET/PATCH/DELETE /v2/webhookEndpoints/{id}`, `POST /v2/webhookEndpoints/{id}/rotateSecret`.
O objeto `WebhookEndpoint` traz `secret` ("usado para gerar as assinaturas"). (SDK `apis/webhook-endpoints-api.ts`, `models/webhook-endpoint*.ts`)

Eventos relevantes (SDK `models/event-type.ts`, nomes exatos):
- `whatsapp.message.updated` — status de mensagem enviada (sent/delivered/read/failed); payload em `whatsappMessage`.
- `whatsapp.inbound_message.received` — mensagem recebida; payload em `whatsappInboundMessage`.
- `whatsapp.smb.message.echoes` — eco das mensagens enviadas pelo app Business (coexistência).
- `whatsapp.smb.history` — sincronização de histórico (campos `phase`, `progress`).
- `whatsapp.template.reviewed`, `whatsapp.phone_number.quality_updated`, `contact.unsubscribe.created`, `whatsapp.user.preferences`, `whatsapp.group.*`.

Envelope `Event` (SDK `models/event.ts`): `{ id, type, apiVersion, createTime, whatsappMessage? | whatsappInboundMessage? | whatsappPhoneNumber? | whatsappTemplate? ... }`.

**Assinatura** [via busca] https://docs.ycloud.com/reference/webhook-integration-guide e https://docs.ycloud.com/en/documentation/developer/webhooks :
- Cabeçalho `YCloud-Signature: t=<unix segundos>,s=<assinatura hex>`.
- `signed_payload = t + "." + corpo_bruto` (sem ponto depois do corpo), HMAC-SHA256 com o `secret` do endpoint, saída hex (64 caracteres); comparar com `crypto.timingSafeEqual`.
- Usar o corpo BRUTO (`express.raw`) — re-serializar o JSON quebra a assinatura.
- Tolerância de tempo: a YCloud diz que é política da aplicação (não define valor) → adotar, p.ex., 5 min contra replay e deduplicar por `event.id`.
- Responder 2xx depois de gravar o evento.
- IPs de origem para allowlist opcional: `8.219.65.77` e `47.236.160.49` (helpdocs, [via busca]).
- ⚠ Conflito: um trecho da página "Webhooks" foi resumido como "não adicionar ponto entre timestamp e corpo"; o guia do receptor e o helpdocs dizem `t.corpo`. A leitura mais provável é "ponto entre t e corpo, nada depois do corpo". **Validar com uma entrega real** (ou implementar e testar com o evento de teste do console) — [PARCIALMENTE CONFIRMADO].
- Política de reenvio (retries) da YCloud: [NÃO CONFIRMADO].

Pseudo-verificação (referência, não é código de produção):
```ts
const [tPart, sPart] = header.split(',');           // "t=...", "s=..."
const t = tPart.slice(2), s = sPart.slice(2);
const esperado = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
ok = s.length === 64 && timingSafeEqual(Buffer.from(s,'hex'), Buffer.from(esperado,'hex')) && Math.abs(now - Number(t)) <= 300;
```

## 6. Coexistência (WhatsApp Business App + API)

YCloud [via busca] https://docs.ycloud.com/en/documentation/whatsapp-business-platform/accounts-and-business-identity/whatsapp-business-app-coexistence ,
https://docs.ycloud.com/en/documentation/channels/whatsapp-accounts-management/coexistence/onboard-whatsapp-business-app , https://www.ycloud.com/whatsapp-business-app-coexistence :
- Onboarding: Console › Create channels › "WhatsApp Business APP Coexistence" › rota "WhatsApp Business App Number", informar o número existente.
- Histórico: compartilhamento é opcional no onboarding; não garante todas as mensagens/mídias; manter o app aberto até terminar. (Meta: uma única sincronização por onboarding, até ~6 meses/180 dias, janela de 24 h — fonte terceiros.)
- **Throughput: a YCloud documenta 5 mensagens/segundo fixo** para números em coexistência. A Meta (doc dev) fala em 20 mps. Conflito — planejar com 5 mps.
- **Aparelhos conectados:** ao fazer o onboarding, **todos os aparelhos companheiros são desconectados**; depois é possível reconectar só os suportados (app suporta até 4). Mensagens de companheiros não suportados (Meta cita WhatsApp para Windows e WearOS) **não geram eco**. ⚠ **IMPACTO DIRETO NO PROSPECTA: a Evolution API é um "WhatsApp Web"/aparelho vinculado. O onboarding vai desconectá-la; será preciso reler o QR. Se a Evolution (Baileys, cliente não oficial) continuará funcionando estável depois da coexistência: [NÃO CONFIRMADO] — testar antes de depender.**
- **Grupos e comunidades não sincronizam** pela YCloud ("temporariamente"); não dá para criar grupo com o número WABA (Alibaba Cloud). Ou seja, a Dolores nos grupos continua 100% dependente da Evolution.
- Também não suportado na YCloud: ocultar número, Canais do WhatsApp; edição da página da empresa.
- Ecos: evento YCloud `whatsapp.smb.message.echoes` (equivalente a `smb_message_echoes` da Meta).
- Mensagem enviada pelo app **não abre nem estende** a janela de 24 h da API (Meta, fonte terceiros) — texto livre pela API só após o cliente escrever.
- Verificação de empresa clássica e selo azul/OBA não disponíveis para coexistência (fonte terceiros).
- Requisitos: app Business ≥ 2.24.17; número usado no app há algum tempo (terceiros citam 7 dias). [NÃO CONFIRMADO na YCloud]
- **Abrir o app a cada 14 dias** (senão desconecta): regra citada por EngageLab/Qiscus/outros BSPs, **NÃO encontrada na YCloud** — [NÃO CONFIRMADO na YCloud, provável por ser regra da Meta].
- Disponibilidade no Brasil: Brasil esteve no beta inicial e terceiros (Chakra HQ, jun/2026) dizem que todos os países já são suportados — [NÃO CONFIRMADO em fonte YCloud/Meta oficial aberta]. O dono já criou a conta; o próprio onboarding confirmará.
- Disponível no plano gratuito: página YCloud diz que após conectar o app "continua grátis; só as mensagens enviadas pela API são cobradas" [via busca]; se o plano Free inclui o canal de coexistência sem restrição: [NÃO CONFIRMADO].
- Desligar: não usa a API de Deregister; desconecta-se nas configurações do app (webhook `account_update` PARTNER_REMOVED na Meta; na YCloud provavelmente `updateEvent=ACCOUNT_OFFBOARDED`) — terceiros.

## 7. Preços / planos [via busca, páginas de marketing da YCloud]

- Plano Free: US$ 0 "para sempre", sem cartão; 1 usuário, 2 canais, chatbot IA, CRM (https://www.ycloud.com/whatsapp-business-api , comparativos da YCloud).
- **0% de margem (markup) sobre as tarifas da Meta** — paga-se só o preço da Meta (https://www.ycloud.com/whatsapp-business-api , https://www.ycloud.com/blog/whatsapp-api-pricing).
- Pagos (cobrança anual): Growth US$ 39/mês, Pro US$ 89/mês, Enterprise US$ 399/mês.
- Cobrança das mensagens: saldo pré-pago na conta YCloud (existe `BalanceApi` / `GET /v2/balance` no SDK) — modelo de recarga exato [NÃO CONFIRMADO].
- Limite de contatos/mensagens no Free: [NÃO CONFIRMADO]. Limite de API no Free (se a API está liberada sem restrição no Free): [NÃO CONFIRMADO] — o SDK/API não distingue plano.
- Preço Meta marketing no Brasil: a Meta publica tabela em BRL para o Brasil (https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing). Valores de terceiros: ~US$ 0,0625 por mensagem de marketing entregue; em BRL ~R$ 0,32 (ChatMaxima, jul/2026). Utility/auth ~US$ 0,0068. **[NÃO CONFIRMADO na tabela oficial]** — conferir no painel antes de orçar. Cobrança por mensagem entregue (modelo por mensagem da Meta desde jul/2025).

## 8. SDK oficial Node

- Pacote `@ycloud-cpaas/ycloud-sdk-node` (https://github.com/ycloud-cpaas/ycloud-sdk-node), gerado pelo OpenAPI Generator (cliente typescript-axios: `new ycloud.Configuration({apiKey})`, `new ycloud.WhatsappMessagesApi(cfg)`).
- Versão/data da última release: [NÃO CONFIRMADO] (aba Releases vazia).
- **Recomendação: não usar; `fetch` puro.** Motivos: traz axios e centenas de modelos para uma função serverless; só precisamos de ~5 rotas; o SDK não verifica assinatura de webhook. Vale usar o SDK (ou o OpenAPI `https://docs.ycloud.com/openapi.json`) só como referência de tipos — copiar as poucas interfaces necessárias.

## 9. Pontos de atenção para o Prospecta

1. Disparo de campanha: `POST /whatsapp/messages` (enqueue) com `externalId` único por (campanha, contato) e `filterUnsubscribed: true`; gravar `id` da YCloud; status via `whatsapp.message.updated`.
2. Em lote dentro de 60 s: respeitar 200 rps/10.000 por hora da conta, o tier `messagingLimit` e os 5 mps da coexistência (a fila da YCloud absorve o ritmo, mas a cota horária de 10.000 requisições limita o tamanho da campanha por hora).
3. Recebimento continua na Evolution, mas o onboarding de coexistência derruba os aparelhos vinculados (Evolution incluída) — risco operacional a testar primeiro.
4. Se o webhook da YCloud também receber `whatsapp.inbound_message.received`, as mensagens chegarão em dobro (Evolution + YCloud): assinar só `whatsapp.message.updated` e `whatsapp.template.reviewed` (e talvez `phone_number.quality_updated`) para não duplicar.
5. Webhook: corpo bruto + HMAC-SHA256 `t.corpo` + janela de tempo + dedupe por `event.id`.
