# 🐦 Guia de Integração Twitter/X - TEKITOTOMATE BOT

Este bot possui uma integração avançada que permite postar tweets diretamente pelo WhatsApp, simulando um navegador real (Puppeteer) para evitar bloqueios de API.

> **🔒 Permissão:** Apenas **Admins** do bot podem usar estes comandos.

---

## 🚀 Como Usar

Existem 3 formas principais de postar no Twitter usando o comando `/x`:

### 1. Postar Apenas Texto
Para enviar um tweet simples de texto, digite `/x` seguido da mensagem.

* **Comando:** `/x Olá Twitter, estou ao vivo!`
* **Resultado:** Um tweet contendo apenas "Olá Twitter, estou ao vivo!" será postado.

### 2. Postar Imagem com Legenda
Você pode enviar uma foto nova e postá-la diretamente.

1. Anexe uma **Imagem** no WhatsApp.
2. Na **legenda** da imagem, escreva: `/x Sua legenda aqui`.
3. Envie.
* **Resultado:** A foto será postada no Twitter com o texto da legenda.

### 3. Repostar/Citar uma Imagem (Reply)
Se alguém mandou uma foto legal no grupo e você quer postar no Twitter do bot:

1. Selecione a foto no WhatsApp.
2. Clique em **Responder**.
3. Na resposta, digite: `/x Que foto incrível!`
4. Envie.
* **Resultado:** O bot baixa a foto original e poita no Twitter com o seu comentário.

---

## 🛠️ Configuração Técnica (Para o Dono)

Para que a integração funcione, o bot utiliza cookies de sessão para simular um login real.

1. **Arquivo de Cookies:** O arquivo `cookies.json` deve estar na raiz do projeto.
   - Ele contém os cookies `auth_token` e `ct0` exportados do navegador.
2. **Variáveis de Ambiente (.env):**
   - Assegure que `TWITTER_USERNAME`, `TWITTER_PASSWORD` e `TWITTER_EMAIL` estejam configurados (para fallback ou referência).
3. **Navegador Invisível:**
   - O bot utiliza uma instância do Chrome em modo `headless` (invisível) para postar. Não feche o terminal do bot enquanto ele estiver processando (pode levar ~30s).

### 🆘 Solução de Problemas

* **Erro "Não Autenticado" ou "Login":** Os cookies podem ter expirado. Exporte novos cookies do seu navegador (onde você está logado no X) e atualize o `cookies.json`.
* **Erro de Timeout:** O Twitter pode estar lento ou sua internet instável. Tente novamente.
