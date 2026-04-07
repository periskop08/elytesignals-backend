const axios = require('axios');
const scanner = require('./scanner');

async function test() {
    console.log("Fetching BingX Ticker for STBL-USDT...");
    const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
    const stbl = res.data.data.find(x => x.symbol === 'STBL-USDT');
    if (!stbl) {
        console.log("STBL-USDT NOT FOUND IN BINGX!");
        return;
    }
    console.log("BingX Ticker Info:", stbl.symbol, "Volume:", stbl.quoteVolume);
    
    // Inject custom mock to bypass cron and call directly
    const fs = require('fs');
    let code = fs.readFileSync('./scanner.js', 'utf8');
    code = code.replace(/if \(direction === 'LONG' && qualityScore < 55\) \{ return null; \}/g, '');
    code = code.replace(/if \(direction === 'SHORT' && qualityScore < CONFIG\.minScore\) \{ return null; \}/g, '');
    code = code.replace(/if \(rr < CONFIG\.minRR\) return null;/g, '');
    code = code.replace('module.exports = {', 'module.exports = { analyzeCoin, getUsdtPairs, ASSET_SYMBOLS, ');
    fs.writeFileSync('./scanner_stbl.js', code);
    
    const diag = require('./scanner_stbl');
    const result = await diag.analyzeCoin({ symbol: 'STBL-USDT', volume: parseFloat(stbl.quoteVolume) });
    console.log("FINAL RESULT:", JSON.stringify(result, null, 2));
}
test();
