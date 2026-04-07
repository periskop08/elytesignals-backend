const axios = require('axios');

async function test() {
    console.log("Fetching BingX Ticker for STBL-USDT...");
    const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
    const stbl = res.data.data.find(x => x.symbol === 'STBL-USDT');
    if (!stbl) {
        console.log("STBL-USDT NOT FOUND IN BINGX!");
        return;
    }
    console.log("BingX Ticker Info:", stbl.symbol, "Volume:", stbl.quoteVolume);
}
test();
