require('dotenv').config();
const fs = require('fs');

let code = fs.readFileSync(__dirname + '/scanner.js', 'utf8');

// Inject counters
let injection = `
    let failSweep = 0;
    let failVol = 0;
    let failRR = 0;
    let failScore = 0;
    let totalAnalyzed = 0;
    let success = 0;
`;

code = code.replace(
    'async function analyzeCoin(symbolInfo, klinesOverride = null) {',
    `async function analyzeCoin(symbolInfo, klinesOverride = null) {
        // totalAnalyzed will be incremented outside
    `
);

// We replace the returns with counter increments
code = code.replace(/if \(!dipDeviation && !tepeDeviation\) return null;/g, `
    if (!dipDeviation && !tepeDeviation) { global.failSweep = (global.failSweep || 0) + 1; return null; }
`);

code = code.replace(/if\s*\(direction === 'LONG' && globalVol < [0-9]+\)\s*\{\s*return null;\s*\}/g, `
    if (direction === 'LONG' && globalVol < 4000000) { global.failVol = (global.failVol || 0) + 1; return null; }
`);
code = code.replace(/if\s*\(direction === 'SHORT' && globalVol < [0-9]+\)\s*\{\s*return null;\s*\}/g, `
    if (direction === 'SHORT' && globalVol < 2000000) { global.failVol = (global.failVol || 0) + 1; return null; }
`);

code = code.replace(/if\s*\(rr\s*<\s*CONFIG\.minRR\)\s*return null;/g, `
    if (rr < CONFIG.minRR) { global.failRR = (global.failRR || 0) + 1; return null; }
`);

code = code.replace(/if\s*\(direction === 'LONG' && qualityScore < 55\)\s*return null;/g, `
    if (direction === 'LONG' && qualityScore < 55) { global.failScore = (global.failScore || 0) + 1; return null; }
`);
code = code.replace(/if\s*\(direction === 'SHORT' && qualityScore < CONFIG\.minScore\)\s*return null;/g, `
    if (direction === 'SHORT' && qualityScore < CONFIG.minScore) { global.failScore = (global.failScore || 0) + 1; return null; }
`);


code = code.replace('module.exports = {', 'module.exports = { analyzeCoin, getUsdtPairs, ');

fs.writeFileSync(__dirname + '/scanner_diag_all.js', code);

const diag = require('./scanner_diag_all');
global.failSweep = 0;
global.failVol = 0;
global.failRR = 0;
global.failScore = 0;

async function run() {
    console.log("Fetching top BingX Pairs...");
    const pairs = await diag.getUsdtPairs();
    console.log("Total Pairs:", pairs.length);
    
    let sucList = [];
    
    for (let c of pairs) {
        const res = await diag.analyzeCoin(c);
        if (res) sucList.push(c.symbol);
    }
    
    console.log("\n==== DIAGNOSTIC BREAKDOWN ====");
    console.log("Total Coins Processed:", pairs.length);
    console.log("Failed at Sweep (No Wick Trap found):", global.failSweep);
    console.log("Failed at Volume Threshold:", global.failVol);
    console.log("Failed at Minimum R:R Filter:", global.failRR);
    console.log("Failed at Final Score (SMA Penalty / Indicators):", global.failScore);
    console.log("Successfully passed all filters:", sucList.length);
    if(sucList.length > 0) console.log("Successful Coins:", sucList);
}
run();
