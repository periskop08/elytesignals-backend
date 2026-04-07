require('dotenv').config();
const fs = require('fs');
let code = fs.readFileSync(__dirname + '/scanner.js', 'utf8');

// Strip out filters
code = code.replace(/if \(direction === 'LONG' && qualityScore < 55\) \{ return null; \}/g, '');
code = code.replace(/if \(direction === 'SHORT' && qualityScore < CONFIG\.minScore\) \{ return null; \}/g, '');
code = code.replace(/if \(rr < CONFIG\.minRR\) return null;/g, '');
code = code.replace('module.exports = {', 'module.exports = { analyzeCoin, getUsdtPairs, ASSET_SYMBOLS, ');

fs.writeFileSync(__dirname + '/scanner_short.js', code);

const diag = require('./scanner_short');

async function testShorts() {
    console.log("Fetching BingX Tickers...");
    const pairs = await diag.getUsdtPairs();
    console.log("Analyzing Shorts...");
    
    for (let i = 0; i < Math.min(100, pairs.length); i++) {
        try {
            const symInfo = pairs[i];
            const sym = typeof symInfo === 'string' ? symInfo : symInfo.symbol;
            const res = await diag.analyzeCoin(symInfo);
            if (res && res.type === 'SHORT') {
                console.log("====== SHORT CATCH ======");
                console.log(JSON.stringify(res, null, 2));
            }
        } catch(e) {}
    }
}
testShorts();
