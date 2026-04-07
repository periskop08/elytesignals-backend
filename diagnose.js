require('dotenv').config();
const fs = require('fs');

let code = fs.readFileSync(__dirname + '/scanner.js', 'utf8');

// Strip out the 'return null' filters to see ALL quality scores
code = code.replace(/if \(direction === 'LONG' && qualityScore < 55\) \{ return null; \}/g, '');
code = code.replace(/if \(direction === 'SHORT' && qualityScore < CONFIG\.minScore\) \{ return null; \}/g, '');

// Export the internal functions needed
code = code.replace('module.exports = {', 'module.exports = { analyzeCoin, getUsdtPairs, ASSET_SYMBOLS, ');

fs.writeFileSync(__dirname + '/scanner_diag.js', code);

const diag = require('./scanner_diag');

async function runDiagnosis() {
    console.log("Fetching BingX Tickers...");
    const pairs = await diag.getUsdtPairs();
    console.log(`Found ${pairs.length} USDT pairs > 3M volume. Scanning top 100...`);

    let stats = {
        totalScanned: 0,
        noSweep: 0,
        longs: 0,
        shorts: 0,
        volumeFiltered: 0,
        scores: []
    };

    for (let i = 0; i < Math.min(100, pairs.length); i++) {
        const symbolInfo = pairs[i];
        try {
            const sym = typeof symbolInfo === 'string' ? symbolInfo : symbolInfo.symbol;
            
            // Replicate the volume filter outside because we commented it out? No, Volume filter is still there:
            // if (direction === 'LONG' && globalVol < 10000000) { return null; }
            // Let's see if analyzeCoin returns something
            const result = await diag.analyzeCoin(symbolInfo);
            
            stats.totalScanned++;
            
            if (!result) {
                // Returns null if !dipDeviation && !tepeDeviation OR if volume < 10M for LONG
                // Let's assume most are noSweep
                stats.noSweep++;
                continue;
            }
            
            if (result.type === 'LONG') stats.longs++;
            if (result.type === 'SHORT') stats.shorts++;
            
            stats.scores.push({
                symbol: result.symbol,
                type: result.type,
                score: result.qualityScore,
                volume: symbolInfo.volume
            });

            console.log(`[Diagnostic] ${result.symbol} | ${result.type} | Score: ${result.qualityScore}`);
            
        } catch(e) {
            console.error(e);
        }
    }
    
    console.log("------------------------------");
    console.log("DIAGNOSIS RESULTS:");
    console.log(`Scanned: ${stats.totalScanned}`);
    console.log(`Filtered out (No Sweep or Vol<10M): ${stats.noSweep}`);
    console.log(`Valid Setups: ${stats.longs} Longs | ${stats.shorts} Shorts`);
    console.log("Top 5 Scores:");
    const sorted = stats.scores.sort((a,b) => b.score - a.score).slice(0, 5);
    console.log(sorted);
}

runDiagnosis();
