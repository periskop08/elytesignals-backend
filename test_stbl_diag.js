const axios = require('axios');
const fs = require('fs');

async function test() {
    console.log("Fetching BingX Ticker for STBL-USDT...");
    const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
    const stbl = res.data.data.find(x => x.symbol === 'STBL-USDT');
    if (!stbl) return;
    
    let code = fs.readFileSync(__dirname + '/scanner.js', 'utf8');
    code = code.replace(/if \(direction === 'LONG' && qualityScore < 55\) \{\n\s*\/\/.*?\n\s*return null;\n\s*\}/g, 'console.log("Would have returned null because LONG score < 55");');
    code = code.replace(/if \(direction === 'SHORT' && qualityScore < CONFIG\.minScore\) \{\n\s*\/\/.*?\n\s*return null;\n\s*\}/g, 'console.log("Would have returned null because SHORT score < 40");');
    code = code.replace(/if \(rr < CONFIG\.minRR\) return null;/g, 'console.log("Would have returned null because RR < 1.0 (RR:", rr, ")");');
    code = code.replace(/if \(direction === 'LONG' && globalVol < 7000000\) \{\n\s*\/\/.*?\n\s*return null;\n\s*\}/g, 'console.log("Would have returned null because LONG VOL < 7M");');
    
    code = code.replace('module.exports = {', 'module.exports = { analyzeCoin, getUsdtPairs, ASSET_SYMBOLS, ');
    fs.writeFileSync(__dirname + '/scanner_stbl2.js', code);
    
    const diag = require('./scanner_stbl2');
    const result = await diag.analyzeCoin({ symbol: 'STBL-USDT', volume: parseFloat(stbl.quoteVolume) });
    console.log("FINAL RESULT:", JSON.stringify(result, null, 2));
}
test();
