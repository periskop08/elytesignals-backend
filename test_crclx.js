const axios = require('axios');

async function test() {
    console.log("Fetching BingX Ticker for CRCLX-USDT...");
    const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
    const coin = res.data.data.find(x => x.symbol === 'CRCLX-USDT');
    if (!coin) {
        console.log("CRCLX-USDT NOT FOUND IN BINGX!");
        return;
    }
    console.log("BingX Ticker Info:", coin.symbol, "Volume:", coin.quoteVolume);
}
test();
