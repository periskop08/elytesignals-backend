const axios = require('axios');
const ignoredStables = ['USDC-USDT', 'USD1-USDT', 'USDE-USDT', 'BUSD-USDT', 'TUSD-USDT', 'FDUSD-USDT', 'EUR-USDT', 'DAI-USDT', 'USTC-USDT', 'PYUSD-USDT', 'CRCLX-USDT', 'NXPC-USDT'];

async function test() {
    try {
        const response = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        const symbols = response.data.data;
        let count = 0;
        symbols.forEach(s => {
            if (!s.symbol.endsWith('-USDT') || ignoredStables.includes(s.symbol)) return;
            const vol = parseFloat(s.quoteVolume);
            if (!s.symbol.startsWith('NC') && vol > 3000000) {
                count++;
            }
        });
        console.log("Valid symbols with vol > 3M:", count);
        
        let s = symbols.find(x => x.symbol === 'BTC-USDT');
        console.log("BTC Object:", s);
    } catch (e) {
        console.error(e);
    }
}
test();
