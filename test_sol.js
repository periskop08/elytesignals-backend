require('dotenv').config();
const fs = require('fs');

let code = fs.readFileSync(__dirname + '/scanner.js', 'utf8');

code = code.replace(/if \(!dipDeviation && !tepeDeviation\) return null;/g, `
    console.log("Sweep Check => dipDeviation:", dipDeviation, " | tepeDeviation:", tepeDeviation);
    if (!dipDeviation && !tepeDeviation) {
        console.log("REJECTED: No Sweep / Deviation condition met in the last 6 candles.");
        return null;
    }
`);

code = code.replace(/if \(direction === 'LONG' && qualityScore < 55\) \{\s*return null;\s*\}/g, '');
code = code.replace(/if \(direction === 'SHORT' && qualityScore < CONFIG\.minScore\) \{\s*return null;\s*\}/g, '');
code = code.replace(/if \(direction === 'LONG' && qualityScore < 55\) return null;/g, '');
code = code.replace(/if \(direction === 'SHORT' && qualityScore < CONFIG\.minScore\) return null;/g, '');
code = code.replace('module.exports = {', 'module.exports = { analyzeCoin, ');

fs.writeFileSync(__dirname + '/scanner_sol_diag.js', code);

const diag = require('./scanner_sol_diag');

async function testSOL() {
    console.log("Analyzing SOLUSDT...");
    const symbolInfo = { symbol: 'SOLUSDT', volume: 500000000 }; 
    await diag.analyzeCoin(symbolInfo);
}
testSOL();
