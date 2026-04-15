# 🔔 Configuração do Webhook Stripe

## Por que configurar o webhook?

O webhook permite que o Stripe notifique automaticamente seu site quando um pagamento é concluído, creditando os UTEFs ou bilhetes na conta do usuário instantaneamente.

---

## 📋 Passo a Passo

### 1. Acesse o Dashboard do Stripe

- URL: https://dashboard.stripe.com/webhooks
- Faça login com sua conta

### 2. Clique em "Add endpoint" (Adicionar endpoint)

### 3. Configure o Endpoint

**URL do Webhook:**

```
https://3000-i2h2gdpjijbpsi7ji37na-fd0d8590.manusvm.computer/api/stripe/webhook
```

⚠️ **IMPORTANTE:** Após publicar seu site, você precisará atualizar esta URL para o domínio definitivo (ex: `https://seu-dominio.com/api/stripe/webhook`)

### 4. Selecione os Eventos

Marque os seguintes eventos:

- ✅ `checkout.session.completed`
- ✅ `payment_intent.succeeded`

### 5. Copie o Signing Secret

Após criar o webhook, o Stripe exibirá um **Signing Secret** (começa com `whsec_...`).

**Copie este valor!** Você precisará adicioná-lo como variável de ambiente.

---

## 🔐 Adicionar Signing Secret

Após obter o `whsec_...`, você precisará configurá-lo como variável de ambiente:

1. Acesse o painel de Secrets do projeto
2. Adicione uma nova secret:
   - **Nome:** `STRIPE_WEBHOOK_SECRET`
   - **Valor:** `whsec_...` (o valor que você copiou)

---

## ✅ Testar o Webhook

Após configurar:

1. Faça uma compra de teste no seu site
2. Vá para o Dashboard do Stripe → Webhooks
3. Clique no seu endpoint
4. Verifique se há eventos sendo recebidos com sucesso (status 200)

Se houver erros (status 400 ou 500), verifique os logs do servidor.

---

## 🚀 Após Publicar o Site

Quando publicar seu site com domínio definitivo:

1. Volte ao Dashboard do Stripe → Webhooks
2. Edite o endpoint
3. Atualize a URL para: `https://seu-dominio.com/api/stripe/webhook`
4. Salve as alterações

**Não é necessário gerar novo Signing Secret, o mesmo continuará funcionando.**

---

## 📞 Suporte

Se tiver problemas:

- Verifique os logs do webhook no Dashboard do Stripe
- Confirme que o Signing Secret está correto
- Teste com o Stripe CLI: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
