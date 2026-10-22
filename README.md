# Pedidos — Restaurante Dona Augusta

Cardápio digital por link + painel do restaurante + comanda para impressora térmica.
Next.js (App Router) + Firebase (Firestore e Authentication) + Vercel.

## Como funciona

1. O restaurante publica o cardápio do dia no painel (`/admin`).
2. O cliente abre o link (`/`), monta as marmitas em 3 passos (marmitas, bebidas, entrega e pagamento) e toca em **Enviar pedido**.
3. O pedido é **salvo no Firestore** (aparece sozinho no painel, com aviso sonoro) e o WhatsApp abre com a mensagem pronta para o cliente enviar.
4. No painel, **Aceitar e imprimir** gera o número do pedido e abre a impressão da comanda. Depois é só avançar o status.
5. **Editar pedido** altera cliente, marmitas, bebidas, entrega e pagamento; tudo que mudou fica no **Histórico** do pedido (quem, quando e o quê).
6. **+ Novo pedido** permite ao restaurante montar o pedido de um cliente que não consegue usar o link; ele já sai aceito, numerado e impresso.
7. Filtros da lista: em andamento, hoje, esta semana (de segunda), últimos 14 dias, este mês e todos.

Sem login e sem telefone para o cliente. O contato do cliente é o próprio WhatsApp dele (a mensagem chega com o código do pedido).

## Configuração (uma vez)

### 1. Firebase (gratuito, plano Spark)
1. Em <https://console.firebase.google.com> crie um projeto.
2. **Firestore Database** → criar banco (modo produção).
3. **Authentication** → Método de login → ative **Google** (e/ou E-mail/senha).
4. **Configurações do projeto → Seus apps → Web (`</>`)** → registre o app e copie `apiKey`, `authDomain`, `projectId` e `appId`.
5. **Firestore → Regras**: cole o conteúdo de `firestore.rules`, **troque o e-mail de exemplo pelo e-mail Google do responsável** e publique.

### 2. Vercel
1. Importe o repositório do GitHub no Vercel.
2. Em *Settings → Environment Variables*, cadastre (veja `.env.example`):
   `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`.
3. Faça o deploy (ou *Redeploy* se já tinha feito antes de cadastrar as variáveis).
4. No Firebase, em *Authentication → Configurações → Domínios autorizados*, adicione o domínio do Vercel (ex.: `meu-projeto.vercel.app`).

### 3. Primeiro uso
1. Abra `/admin` e entre com o e-mail autorizado.
2. Aba **Cardápio de hoje** → **Carregar configuração inicial** (cria a configuração e os sucos).
3. Aba **Configurações**: WhatsApp do restaurante, preços das marmitas, bairros e taxas, largura do papel (58 ou 80 mm). Marque **Confirmo esse preço** para liberar a opção "Sem proteína".
4. Cadastre acompanhamentos, proteínas (Grupo 1 ou 2) e refrigerantes (com preço) em **Cardápio de hoje**.
5. Faça um pedido de teste em `/` e confira o painel.

### Impressão sem janela de confirmação (Windows)
O botão imprime pelo navegador. Para imprimir direto na térmica, crie um atalho do Chrome com
`--kiosk-printing` (ex.: `chrome.exe --kiosk-printing https://SEU-DOMINIO/admin`) e deixe a térmica como impressora padrão.

## Rodar local

```bash
npm install
cp .env.example .env.local   # preencha as 4 variáveis
npm run dev
npm test                     # testes dos cálculos e da mensagem
```

## Regras de negócio implementadas

- Até 6 acompanhamentos por marmita; proteína é opcional e não conta como acompanhamento.
- Preço pelo tamanho (Pequena/Grande) e pelo grupo da proteína (1 ou 2). Marmita sem proteína **não tem desconto**: cobra o grupo escolhido nas configurações.
- Bebidas cobradas à parte, por quantidade. Bebida sem preço não aparece.
- Taxa de entrega por bairro, aplicada uma vez por pedido; bairro fora da tabela = "taxa a confirmar". Retirada não tem taxa.
- Pagamento: Pix, Dinheiro (com troco) ou Cartão. Troco precisa cobrir o total.
- Valores em centavos (inteiros). O pedido guarda os preços do momento.
- Item esgotado some das opções em tempo real e é conferido de novo antes de enviar.

## Limitações conhecidas (versão 1)

- Os preços do pedido são calculados no navegador do cliente. As regras do Firestore validam formato e limites, mas não recalculam preços. O painel mostra **"Conferir valores"** se algo não bater com a configuração atual.
- O pedido é salvo antes de o cliente enviar a mensagem no WhatsApp. Pedido "Novo" sem mensagem correspondente pode ser um cliente que desistiu na última tela.
- Não há limite de pedidos por pessoa (qualquer um com o link pode criar pedidos). Se virar problema, o próximo passo é Firebase App Check.
- O histórico de edições guarda a hora do navegador de quem editou e o e-mail do login; serve como registro operacional, não como auditoria à prova de fraude.
- Sem notificação automática ao cliente; o contato é pelo WhatsApp.
- O plano Hobby do Vercel é voltado a uso pessoal/não comercial. Confira os termos atuais antes de cobrar pelo sistema.
