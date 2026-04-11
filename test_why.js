require('dotenv').config();
const fs = require('fs');

let code = fs.readFileSync(__dirname + '/scanner.js', 'utf8');

// Just export analyzeCoin
code = code.replace('module.exports = {', 'module.exports = { analyzeCoin, ');

// We don't remove the <60 null return, we just inject a console log right BEFORE it!
code = code.replace(/if \(!globalMarketState \|\| breakdown === 'Market verisi yok'\) \{/g, `
    console.log("-> " + sym + " | Puan: " + qualityScore + " | Neden: " + warnings.join(', '));
    if (!globalMarketState || breakdown === 'Market verisi yok') {
`);

fs.writeFileSync(__dirname + '/scanner_why_diag.js', code);

const diag = require('./scanner_why_diag');

async function testAll() {
    console.log("Analyzing...");
    global.BINGX_SYMBOL_MAP = {};
    
    try {
        const topCoins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'WLDUSDT', 'PEPEUSDT'];
        for (const sym of topCoins) {
            await diag.analyzeCoin({ symbol: sym, volume: 50000000 });
        }
        console.log("Bitti.");
    } catch(e) {
        console.error(e);
    }
}
testAll();
