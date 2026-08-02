# Deploy — Minutei

O app já está pronto para produção: sessões persistentes em disco, cookies
seguros atrás de proxy HTTPS, Dockerfile, e tudo escopado por conta
(autenticação). Falta só publicar num servidor.

## Por que Railway

Recomendo **Railway** (railway.app) porque:
- Deploy direto de um repositório Git, sem configurar servidor manualmente.
- Tem **volume persistente** de graça no plano inicial — essencial aqui, porque
  as contas, senhas, logos e configurações de marca ficam salvas em arquivo
  (`data/` e `uploads/`), não em banco externo. Sem volume persistente, tudo
  isso se perde a cada novo deploy.
- HTTPS automático (obrigatório — os cookies de sessão só funcionam com
  `secure: true` em produção, que já está configurado no código).
- Tem um plano gratuito/trial suficiente para validar o produto antes de pagar.

Alternativas equivalentes: **Render** (também tem volume persistente e plano
grátis) ou **Fly.io** (mais técnico, mas também funciona bem). Os passos abaixo
são para Railway; se preferir outra, me avisa e adapto.

## Passo a passo (Railway)

1. **Crie uma conta** em https://railway.app (dá para entrar com GitHub).

2. **Suba este projeto para um repositório Git** (se ainda não estiver em um):
   ```bash
   cd imob-contratos-app
   git init
   git add .
   git commit -m "Contratos Imobiliários — versão inicial"
   ```
   Depois crie um repositório vazio no GitHub e faça o push (`git remote add
   origin ...` e `git push -u origin main`).

3. No painel do Railway: **New Project → Deploy from GitHub repo** → selecione
   o repositório.

4. Railway vai detectar o `Dockerfile` automaticamente e buildar a imagem.

5. **Anexe um volume** (clique com o botão direito no card do serviço no
   canvas → "Attach volume"):
   - Mount path: `/app/data`
   - Só precisa desse um volume — uploads (logos) ficam guardados dentro dele
     por padrão, não precisa criar um segundo.

6. **Variáveis de ambiente** (aba "Variables"):

   Básicas (obrigatórias):
   - `NODE_ENV=production`
   - `SESSION_SECRET=<uma string aleatória longa>` — gere uma com
     `openssl rand -hex 32` no terminal. Sem isso o app gera uma sozinha, mas
     é melhor fixar para não invalidar sessões a cada redeploy sem volume.
   - `DATA_DIR=/app/data`
   - `PUBLIC_BASE_URL=https://www.minutei.app.br` — endereço canônico usado nos
     links de revisão enviados ao cliente. **Importante:** hoje o domínio sem
     `www` só redireciona a raiz (`minutei.app.br/qualquer-caminho` devolve 404),
     então sem essa variável um link compartilhado pode chegar quebrado no
     cliente. Sem ela o app usa o host da requisição.

   Ajudante de IA — extração de CNH/RG e assistente de cláusulas (opcional;
   sem ela essas funções ficam indisponíveis, o resto do app funciona normal):
   - `ANTHROPIC_API_KEY=<sua chave da Anthropic>` — crie em
     https://console.anthropic.com → API Keys (precisa de créditos/billing ativo).
   - `ANTHROPIC_MODEL=claude-sonnet-5` (opcional; esse já é o padrão).

   Pagamentos — Stripe (opcional; sem elas os planos pagos/checkout ficam
   indisponíveis):
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_PRICE_AUTONOMO`, `STRIPE_PRICE_IMOBILIARIA` (preços mensais)
   - `STRIPE_PRICE_AUTONOMO_ANUAL`, `STRIPE_PRICE_IMOBILIARIA_ANUAL` (preços
     anuais; sem elas o botão "Anual" cai para o preço mensal).

7. Railway expõe uma porta pública automaticamente. Em "Settings → Networking"
   gere um domínio (`algo.up.railway.app`) — já vem com HTTPS.

8. Acesse o domínio gerado, crie a conta da imobiliária pela tela de cadastro,
   e pronto — está no ar.

## Depois que estiver no ar

- **Domínio próprio**: em "Settings → Networking → Custom Domain", aponte um
  CNAME do seu domínio (ex. `contratos.imobgest.com.br`) para o Railway.
- **Backup dos dados**: `data/tenants.json`, `data/users.json` e `uploads/`
  contêm tudo (contas, senhas com hash, logos, configuração de marca). Vale a
  pena baixar uma cópia periodicamente enquanto não migramos para um banco de
  verdade — ver a seção "Próximos passos" abaixo.

## Próximos passos técnicos (não bloqueiam o primeiro deploy)

- Hoje os dados ficam em arquivos JSON (`data/tenants.json`, `data/users.json`).
  Isso funciona bem para dezenas de imobiliárias, mas se o produto crescer
  vale migrar para um banco real (Postgres, que o Railway também oferece como
  add-on) para evitar corrupção por escrita concorrente.
- Conversão automática para PDF ainda não está implementada (hoje só gera
  `.docx`) — depende de instalar LibreOffice no servidor ou usar um serviço
  externo de conversão.
- Sem verificação de e-mail no cadastro — qualquer e-mail é aceito sem
  confirmação.
