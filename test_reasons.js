require('dotenv').config();
const fs = require('fs');

let code = fs.readFileSync(__dirname + '/scanner.js', 'utf8');

// Baraj sınırını kaldırıp consola bas
code = code.replace(/if\s*\(direction === 'LONG' && qualityScore < 60\)\s*\{\s*return null;\s*\}/g, `
    // LONG
`);
code = code.replace(/if\s*\(direction === 'SHORT' && qualityScore < 60\)\s*\{\s*return null;\s*\}/g, `
    // SHORT
`);

code = code.replace(/console\.log\(JSON\.stringify\(\{/g, `
    global.diagResults.push({ symbol: sym, direction, qualityScore, breakdown, warnings });
    // console.log(JSON.stringify({
`);

code = code.replace('module.exports = {', 'module.exports = { analyzeCoin, fetchCandles, ');

fs.writeFileSync(__dirname + '/scanner_reasons_diag.js', code);

const diag = require('./scanner_reasons_diag');
const axios = require('axios');

global.diagResults = [];

async function testAll() {
    console.log("Analyzing market to find reasons for rejections...");
    global.BINGX_SYMBOL_MAP = {};
    
    try {
        const topCoins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'WLDUSDT', 'PEPEUSDT', 'ENAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'XRPUSDT'];
        
        for (const cleanSym of topCoins) {
            await diag.analyzeCoin({ symbol: cleanSym, volume: 50000000, maxLeverage: 50 });
        }
        
        console.log("=== RESULTS ===");
        global.diagResults.sort((a,b) => b.qualityScore - a.qualityScore);
        for(const r of global.diagResults) {
            console.log(`\n🔹 ${r.symbol} | Yön: ${r.direction} | SKOR: ${r.qualityScore}`);
            console.log(`   └ Nedenler: \n     ${r.warnings.join(', ')}`);
        }
        
    } catch(e) {
        console.error(e);
    }
}
testAll();
