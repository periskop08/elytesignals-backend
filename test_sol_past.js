require('dotenv').config();
const fs = require('fs');

let code = fs.readFileSync(__dirname + '/scanner.js', 'utf8');

code = code.replace(
    'async function fetchCandles(symbolInfo, intervalMinutes, limit) {',
    `async function originalFetchCandles(symbolInfo, intervalMinutes, limit) {`
);

code = code.replace(
    'try {',
    `try {`
);

let injection = `
async function fetchCandles(symbolInfo, intervalMinutes, limit) {
    let list = await originalFetchCandles(symbolInfo, intervalMinutes, limit + 1);
    if (list && list.length > 0) {
        list.pop();
    }
    return list;
}
`;

code = code.replace('// --- GLOBAL MARKET SENSOR END ---', '// --- GLOBAL MARKET SENSOR END ---\n' + injection);

code = code.replace(/return null;/g, `
    { console.log("TRACE: Returned null at line near R:R or Vol or Sweep or Filters"); return null; }
`);

code = code.replace(/if \(!dipDeviation && !tepeDeviation\) \{ console\.log\("TRACE: Returned null at line near R:R or Vol or Sweep or Filters"\); return null; \}/g, `
    console.log("Sweep Check => dipDeviation:", dipDeviation, " | tepeDeviation:", tepeDeviation);
    if (!dipDeviation && !tepeDeviation) {
        console.log("REJECTED: No Sweep / Deviation condition met in the last 6 candles.");
        return null;
    }
`);

code = code.replace(/if\s*\(rr\s*<\s*CONFIG\.minRR\)\s*\{\s*console\.log\("TRACE:[^"]+"\);\s*return\s*null;\s*\}/g, `
    console.log("R:R Check => rr:", rr, " | minRR:", CONFIG.minRR);
    if (rr < CONFIG.minRR) return null;
`);

code = code.replace(/if\s*\(direction === 'LONG' && globalVol < 10000000\)\s*\{\s*console\.log\("TRACE:[^"]+"\);\s*return\s*null;\s*\}/g, `
    console.log("Vol Check => vol:", globalVol);
    if (direction === 'LONG' && globalVol < 10000000) return null;
`);

// The actual score blocks are:
code = code.replace(/if\s*\(direction === 'LONG' && qualityScore < 55\)\s*\{\s*console\.log\("TRACE:[^"]+"\);\s*return\s*null;\s*\}/g, `
    console.log("Score Check => type:", direction, "| score:", qualityScore);
    if(direction === 'LONG' && qualityScore < 55) return null;
`);

code = code.replace('module.exports = {', 'module.exports = { analyzeCoin, ');

fs.writeFileSync(__dirname + '/scanner_sol_eval.js', code);

const diag = require('./scanner_sol_eval');

async function testSOL() {
    console.log("Analyzing SOLUSDT at 00:00 (1 Candle Ago)...");
    const symbolInfo = { symbol: 'SOLUSDT', volume: 500000000 }; 
    const result = await diag.analyzeCoin(symbolInfo);
    if (result) {
        console.log("PASSED! Score:", result.qualityScore);
    }
}
testSOL();
