const axios = require('axios');
const fs = require('fs');

async function test() {
    console.log("Fetching BingX Ticker for PAXG-USDT...");
    const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
    const coin = res.data.data.find(x => x.symbol === 'PAXG-USDT');
    if (!coin) {
        console.log("PAXG-USDT NOT FOUND IN BINGX!");
        return;
    }
    console.log("BingX Ticker Info:", coin.symbol, "Volume:", coin.quoteVolume);
    
    let code = fs.readFileSync(__dirname + '/scanner.js', 'utf8');
    code = code.replace(/if \(direction === 'LONG' && qualityScore < 55\) \{\n\s*\/\/.*?\n\s*return null;\n\s*\}/g, 'console.log("Would have returned null because LONG score < 55");');
    code = code.replace(/if \(direction === 'SHORT' && qualityScore < CONFIG\.minScore\) \{\n\s*\/\/.*?\n\s*return null;\n\s*\}/g, 'console.log("Would have returned null because SHORT score < 40");');
    code = code.replace(/if \(rr < CONFIG\.minRR\) return null;/g, 'console.log("Would have returned null because RR < 1.0 (RR:", rr, ")");');
    code = code.replace(/if \(direction === 'LONG' && globalVol < 7000000\) \{\n\s*\/\/.*?\n\s*return null;\n\s*\}/g, 'console.log("Would have returned null because LONG VOL < 7M");');
    
    code = code.replace('module.exports = {', 'module.exports = { analyzeCoin, getUsdtPairs, ASSET_SYMBOLS, ');
    fs.writeFileSync(__dirname + '/scanner_paxg.js', code);
    
    const diag = require('./scanner_paxg');
    const result = await diag.analyzeCoin({ symbol: 'PAXG-USDT', volume: parseFloat(coin.quoteVolume) });
    console.log("FINAL RESULT:", JSON.stringify(result, null, 2));
}
test();
