require('dotenv').config();
const fs = require('fs');
let code = fs.readFileSync(__dirname + '/scanner.js', 'utf8');

code = code.replace(/if \(!dipDeviation && !tepeDeviation\) return null;/g, 'console.log({recentMin, rangeLow, currentPrice, sweepIdxLong: lows.lastIndexOf(recentMin), highestVal: highs[lows.lastIndexOf(recentMin)], dipDeviation, tepeDeviation});');
code = code.replace(/if \(direction === 'LONG' && qualityScore < 55\) \{ return null; \}/g, '');
code = code.replace(/if \(direction === 'SHORT' && qualityScore < CONFIG\.minScore\) \{ return null; \}/g, '');
code = code.replace('module.exports = {', 'module.exports = { analyzeCoin, getUsdtPairs, ASSET_SYMBOLS, ');

fs.writeFileSync(__dirname + '/scanner_algo.js', code);

const diag = require('./scanner_algo');

async function testAlgo() {
    try {
        const symbolInfo = { symbol: 'ALGOUSDT', volume: 50000000 };
        const result = await diag.analyzeCoin(symbolInfo);
        console.log("FINAL RESULT:", JSON.stringify(result, null, 2));
    } catch(e) {
        console.error(e);
    }
}
testAlgo();
