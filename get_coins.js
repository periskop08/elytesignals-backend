const axios = require('axios');

async function run() {
    try {
        const response = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker', { timeout: 10000 });
        const symbols = response.data.data;
        
        const ignoredStables = ['USDC-USDT', 'USD1-USDT', 'USDE-USDT', 'BUSD-USDT', 'TUSD-USDT', 'FDUSD-USDT', 'EUR-USDT', 'DAI-USDT', 'USTC-USDT', 'PYUSD-USDT'];
        
        const usdtPairs = symbols.filter(s => 
            s.symbol.endsWith('-USDT') && 
            !s.symbol.startsWith('NC') && 
            !ignoredStables.includes(s.symbol) && 
            parseFloat(s.quoteVolume) > 3000000
        );

        usdtPairs.sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

        console.log(`BINGX 3M+ HACIMLI GUNCEL ALTCOINLER (${usdtPairs.length} ADET)`);
        console.log("--------------------------------------------------");
        usdtPairs.forEach(s => {
            const volM = (parseFloat(s.quoteVolume) / 1000000).toFixed(2);
            console.log(`${s.symbol.replace('-USDT', '')} -> $${volM}M USDT`);
        });
        process.exit(0);
    } catch (e) {
        console.error("Hاتا:", e.message);
        process.exit(1);
    }
}
run();
