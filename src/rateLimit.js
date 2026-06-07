// === MENSAGEM GIGANTE DE AVISO DE RATE LIMIT ===

function getRateLimitWarningMessage() {
    return `⚠️🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨⚠️

⛔⛔⛔ *RATE LIMIT ATINGIDO* ⛔⛔⛔

🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴

*ATENÇÃO CARALHO!!!*

O RATE LIMIT FOI ATINGIDO!!! 

SE CONTINUAR VOCÊ TOMA NO CU SEU CAOLHO DA PICA TORTA VAI PERDER O CHIP FDP!!!

🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴

O envio VAI continuar mas é POR SUA CONTA E RISCO!!!
O WhatsApp pode BANIR seu número a qualquer momento!!!

⚠️ VOCÊ FOI AVISADO SEU ARROMBADO ⚠️

🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨`;
}

function printRateLimitWarningCMD() {
    const separator = '!'.repeat(80);
    const warning = `
${separator}
${separator}
${'!'.repeat(20)}  RATE LIMIT ATINGIDO  ${'!'.repeat(20)}
${separator}
${separator}

    ██████╗  █████╗ ████████╗███████╗    ██╗     ██╗███╗   ███╗██╗████████╗
    ██╔══██╗██╔══██╗╚══██╔══╝██╔════╝    ██║     ██║████╗ ████║██║╚══██╔══╝
    ██████╔╝███████║   ██║   █████╗      ██║     ██║██╔████╔██║██║   ██║   
    ██╔══██╗██╔══██║   ██║   ██╔══╝      ██║     ██║██║╚██╔╝██║██║   ██║   
    ██║  ██║██║  ██║   ██║   ███████╗    ███████╗██║██║ ╚═╝ ██║██║   ██║   
    ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚══════╝    ╚══════╝╚═╝╚═╝     ╚═╝╚═╝   ╚═╝   

${separator}
    ⚠️⚠️⚠️  RATE LIMIT FOI ATINGIDO!!! CONTINUANDO POR CONTA E RISCO!!!  ⚠️⚠️⚠️
    
    SE CONTINUAR VOCÊ TOMA NO CU SEU CAOLHO DA PICA TORTA 
    VAI PERDER O CHIP FDP!!!
    
    O ENVIO VAI CONTINUAR MAS O WHATSAPP PODE BANIR A QUALQUER MOMENTO!!!
${separator}
${separator}
${separator}
`;
    console.log(warning);
}

module.exports = {
    getRateLimitWarningMessage,
    printRateLimitWarningCMD
};
