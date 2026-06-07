/**
 * Baileys v7 ESM Loader
 * 
 * Baileys v7 é ESM-only. Este módulo carrega o Baileys via import() dinâmico
 * e expõe as funções como singleton para uso em projeto CommonJS.
 * 
 * Uso:
 *   const { loadBaileys } = require('./baileys-loader');
 *   const baileys = await loadBaileys();
 *   const sock = baileys.makeWASocket({ auth: state });
 */

let baileysModule = null;
let loadPromise = null;

async function loadBaileys() {
    // Retornar cache se já carregado
    if (baileysModule) return baileysModule;
    
    // Evitar carregamentos paralelos
    if (loadPromise) return loadPromise;
    
    loadPromise = (async () => {
        try {
            const baileys = await import('baileys');
            
            baileysModule = {
                // makeWASocket pode ser default export ou named export
                makeWASocket: baileys.makeWASocket || baileys.default,
                useMultiFileAuthState: baileys.useMultiFileAuthState,
                DisconnectReason: baileys.DisconnectReason,
                Browsers: baileys.Browsers,
                downloadMediaMessage: baileys.downloadMediaMessage,
                // Utilitários que podem ser necessários
                fetchLatestBaileysVersion: baileys.fetchLatestBaileysVersion,
                isJidGroup: baileys.isJidGroup,
                // v7: isPnUser substitui isJidUser
                isPnUser: baileys.isPnUser,
                // Acesso ao módulo completo para funções não listadas
                _raw: baileys,
            };
            
            return baileysModule;
        } catch (error) {
            loadPromise = null; // Permitir retry em caso de erro
            throw new Error(`Falha ao carregar Baileys v7 (ESM): ${error.message}`);
        }
    })();
    
    return loadPromise;
}

/**
 * Retorna o módulo já carregado (síncrono).
 * Só usar após loadBaileys() ter sido chamado com sucesso.
 */
function getBaileys() {
    if (!baileysModule) {
        throw new Error('Baileys ainda não foi carregado. Chame loadBaileys() primeiro.');
    }
    return baileysModule;
}

module.exports = { loadBaileys, getBaileys };
