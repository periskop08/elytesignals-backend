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
        recentMinHitRangeLow: 0,
        recentMaxHitRangeHigh: 0,
        chochLong: 0,
        chochShort: 0
    };

    for (let i = 0; i < Math.min(100, pairs.length); i++) {
        const symbolInfo = pairs[i];
        try {
            // Run a mock fetch locally to just pull the Math comparisons manually
            const interval = '1h';
            let fetchSym = symbolInfo.symbol.replace('USDT', '-USDT');
            const axios = require('axios');
            const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${fetchSym}&interval=${interval}&limit=100`);
            let list = res.data.data || [];
            list.sort((a,b) => a.time - b.time);
            
            const highs = list.map(k=>parseFloat(k.high));
            const lows = list.map(k=>parseFloat(k.low));
            const closes = list.map(k=>parseFloat(k.close));
            
            const currentPrice = closes[closes.length - 1];
            const rangeHigh = Math.max(...highs);
            const rangeLow = Math.min(...lows);
            const recentLows = lows.slice(-6);
            const recentHighs = highs.slice(-6);
            let recentMin = Math.min(...recentLows);
            let recentMax = Math.max(...recentHighs);
            
            stats.totalScanned++;
            
            if (recentMin <= rangeLow * 1.005) {
                stats.recentMinHitRangeLow++;
                let sweepIdx = lows.lastIndexOf(recentMin);
                if (currentPrice > highs[sweepIdx]) {
                    stats.chochLong++;
                }
            }
            if (recentMax >= rangeHigh * 0.995) {
                stats.recentMaxHitRangeHigh++;
                let sweepIdx = highs.lastIndexOf(recentMax);
                if (currentPrice < lows[sweepIdx]) {
                    stats.chochShort++;
                }
            }
            
        } catch(e) {}
    }
    
    console.log("------------------------------");
    console.log("DIAGNOSIS REASONING:");
    console.log(`Scanned: ${stats.totalScanned}`);
    console.log(`Hits for Dip Sweep (recentMin <= rangeLow): ${stats.recentMinHitRangeLow}`);
    console.log(`Hits for Tepe Sweep (recentMax >= rangeHigh): ${stats.recentMaxHitRangeHigh}`);
    console.log(`Passes For Long CHoCH: ${stats.chochLong}`);
    console.log(`Passes For Short CHoCH: ${stats.chochShort}`);
}

runDiagnosis();
