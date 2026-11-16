# Dolores — o "cérebro" no WhatsApp (Etapa 2)

Na etapa 2 não há texto para colar no Claude Console: o próprio sistema chama a API da Anthropic. A instrução de sistema
fica em `server/dolores/prompt.ts` (`PROMPT_SISTEMA_WHATSAPP`) — o mesmo conteúdo de `agente-etapa1.md`, adaptado ao
WhatsApp (texto curto para celular, a resposta vai só para o dono).

## Como um comando é tratado
1. A Evolution avisa `POST /api/dolores/whatsapp` (segredo próprio, comparação em tempo constante).
2. Só a instância `prospecta-dolores`; grupos, status e as mensagens da própria Dolores são ignorados; mensagem com mais de
   5 minutos (reentrega/histórico) não vira comando; a mesma mensagem só é tratada uma vez (`dolores_mensagens`).
3. Só o número do dono comanda (`dolores_whatsapp_config.numero_dono`, DDD + 8 últimos dígitos). Outro número: sem
   resposta, sem IA, registrado em `dolores_acoes`.
4. Travas, nesta ordem, antes de qualquer chamada à Anthropic: pausa (`dolores_config`), interruptor da IA
   (desligado por padrão), chave e modelo do painel de Integrações, limite mensal, usuária ativa. Qualquer uma falhando →
   frase fixa ao dono.
5. Laço (`server/dolores/cerebro.ts`): a mensagem do dono é o único texto de usuário; as ferramentas são a lista fechada da
   etapa (as 12 leituras da etapa 1); cada chamada passa por `executarFuncao` (a mesma porta da ponte: lista, validação,
   limite por minuto, transação somente leitura, filtro de dados pessoais, auditoria) e volta só como `tool_result`.
6. Tetos: 6 voltas, 6 consultas por volta, 2.000 tokens de saída por chamada, 150.000 de entrada por pedido, prazo total de
   45 s (laço + envio; a função da Vercel tem 60 s). Estourando, uma última chamada sem ferramentas resume o que já foi
   consultado (se houver tempo) e a resposta diz que parou.
7. A resposta passa pelo filtro de dados pessoais, é cortada em ~3.800 caracteres e vai para o número que acabou de ser
   conferido como o do dono (conferido de novo no envio). Nenhum texto escolhe o destino.

## Injeção de instruções
Nomes, observações, mensagens de clientes e textos de processos são dados. Além do prompt, a estrutura garante: não existe
ferramenta de envio nem de escrita; nome de ferramenta fora da lista é recusado pela ponte (e auditado); o destino da
resposta é fixo. Testes com dados envenenados em `server/dolores/whatsapp.test.ts`.
