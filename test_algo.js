require('dotenv').config();
const fs = require('fs');

let code = fs.readFileSync(__dirname + '/scanner.js', 'utf8');

// Replace return null with TRACE logs
code = code.replace(/if\s*\(\!klinesFull \|\| klinesFull\.length < 205\)\s*return null;/g, `
    if(!klinesFull || klinesFull.length < 205) { console.log("REJECT: Not enough candles"); return null; }
`);

code = code.replace(/if \(!dipDeviation && !tepeDeviation\) return null;/g, `
    console.log("Sweep Check => dipDeviation:", dipDeviation, "| tepeDeviation:", tepeDeviation);
    if (!dipDeviation && !tepeDeviation) { console.log("REJECT: No Sweep"); return null; }
`);

code = code.replace(/if\s*\(direction === 'LONG' && globalVol < 4000000\)\s*\{\s*\/\/ Hacim.*\s*return null;\s*\}/g, `
    if (direction === 'LONG' && globalVol < 4000000) { console.log("REJECT: Volume < 4M. Current Vol:", globalVol); return null; }
`);
code = code.replace(/if\s*\(direction === 'SHORT' && globalVol < 2000000\)\s*\{\s*\/\/ Hacim.*\s*return null;\s*\}/g, `
    if (direction === 'SHORT' && globalVol < 2000000) { console.log("REJECT: Volume < 2M. Current Vol:", globalVol); return null; }
`);

code = code.replace(/if\s*\(rr\s*<\s*CONFIG\.minRR\)\s*return null;/g, `
    console.log("R:R Check => rr:", rr);
    if (rr < CONFIG.minRR) { console.log("REJECT: Bad Risk/Reward ratio (<1.0)"); return null; }
`);

code = code.replace(/if\s*\(direction === 'LONG' && qualityScore < 55\)\s*return null;/g, `
    console.log("Score Check => qualityScore:", qualityScore);
    if (direction === 'LONG' && qualityScore < 55) { console.log("REJECT: Score below 55"); return null; }
`);
code = code.replace(/if\s*\(direction === 'SHORT' && qualityScore < CONFIG\.minScore\)\s*return null;/g, `
    console.log("Score Check => qualityScore:", qualityScore);
    if (direction === 'SHORT' && qualityScore < CONFIG.minScore) { console.log("REJECT: Score below 40"); return null; }
`);

code = code.replace(/\} catch\(e\)\s*\{\s*return null;\s*\}/g, `
    } catch(e) { console.error("CRASH IN ANALYZECOIN:", e); return null; }
`);

code = code.replace('module.exports = {', 'module.exports = { analyzeCoin, fetchCandles, ');

fs.writeFileSync(__dirname + '/scanner_algo_diag.js', code);

const diag = require('./scanner_algo_diag');
const axios = require('axios');

async function testALGO() {
    console.log("Fetching ALGO-USDT from BingX Futures API directly...");
    // Let's get the volume first from ticker
    let volume = 5000000;
    try {
        const t = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        const s = t.data.data.find(x => x.symbol === 'ALGO-USDT');
        if(s) volume = parseFloat(s.quoteVolume);
        console.log("Ticker Volume for ALGO-USDT:", volume);
    }catch(e) {}
    
    // We will simulate 5 different offsets! Just like how it would have ran 1h ago, 2h ago, 3h ago.
    for(let offset = 4; offset >= 0; offset--) {
        console.log("\\n--- SIMULATING " + offset + " HOURS AGO ---");
        let klines = await diag.fetchCandles({symbol: 'ALGOUSDT'}, 60, 250);
        // Remove 'offset' amount of candles from the end to simulate past timestamps
        if(offset > 0) {
            klines = klines.slice(0, -offset);
        }
        
        const res = await diag.analyzeCoin({symbol: 'ALGOUSDT', volume: volume}, klines); // pass override
        if (res) console.log("PASSED! Score:", res.qualityScore);
    }
}
testALGO();
