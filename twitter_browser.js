const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');

puppeteer.use(StealthPlugin());

// Argumentos: --text "Ola" --media "path/to/img"
const args = process.argv.slice(2);
let message = '';
let mediaPath = '';

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--text' && args[i + 1]) {
        message = args[i + 1];
    }
    if (args[i] === '--media' && args[i + 1]) {
        mediaPath = args[i + 1];
    }
}

(async () => {
    let browser = null;
    try {
        if (!fs.existsSync('cookies.json')) {
            throw new Error('Arquivo cookies.json não encontrado. Exporte cookies do navegador primeiro.');
        }

        const cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));

        // Inicia browser (headless: "new" é mais moderno)
        // Se quiser ver acontecer, mude headless para false
        browser = await puppeteer.launch({
            headless: true, // Modo clássico totalmente invisível
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
        });

        const page = await browser.newPage();

        // Define cookies
        await page.setCookie(...cookies);

        // Define Viewport realista
        await page.setViewport({ width: 1280, height: 800 });

        // Ir direto para compose
        // console.error('Navegando para compose...');
        await page.goto('https://twitter.com/compose/tweet', { waitUntil: 'networkidle2', timeout: 60000 });

        // Verificar se logou (se redirecionou para login, falhou)
        if (page.url().includes('login')) {
            throw new Error('Cookies inválidos ou expirados. Redirecionado para Login.');
        }

        // Esperar area de texto
        const selectorInput = '[data-testid="tweetTextarea_0"]';
        await page.waitForSelector(selectorInput, { timeout: 30000 });

        // Digitar texto
        if (message) {
            await page.type(selectorInput, message, { delay: 50 });
        }

        // Upload de Mídia
        if (mediaPath) {
            if (!fs.existsSync(mediaPath)) {
                console.error(`Mídia não encontrada: ${mediaPath}`);
            } else {
                // Input oculto de arquivo
                const inputUpload = await page.waitForSelector('input[type="file"]');
                await inputUpload.uploadFile(mediaPath);
                // Esperar preview carregar (indicador de upload concluido visualmente)
                await page.waitForSelector('[data-testid="attachments"] img, [data-testid="attachments"] video', { timeout: 30000 });
                // Pequeno delay segurança para upload processar
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // Clicar em Postar
        const postButtonSelector = '[data-testid="tweetButton"]';
        // Esperar botão estar habilitado
        await page.waitForFunction(
            selector => !document.querySelector(selector).disabled,
            {},
            postButtonSelector
        );

        await page.click(postButtonSelector);

        // Esperar notificação de sucesso ou tweet aparecer
        // Ou simplesmente esperar network idle
        await new Promise(r => setTimeout(r, 3000));
        await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => { });

        console.log(JSON.stringify({ success: true, message: 'Postado via Puppeteer' }));

    } catch (error) {
        console.log(JSON.stringify({ success: false, error: error.message }));
    } finally {
        if (browser) await browser.close();
    }
})();
