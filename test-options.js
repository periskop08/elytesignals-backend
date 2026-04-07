const YF = require('yahoo-finance2').default;
const yf = new YF({suppressNotices: ['yahooSurvey']});

async function analyzeOptionsFlow(fetchId, currentPrice) {
    try {
        const result = await yf.options(fetchId);
        if (!result || !result.options || result.options.length === 0) return null;
        
        const nearestChain = result.options[0]; // Assuming index 0 is nearest expiration
        const calls = nearestChain.calls || [];
        const puts = nearestChain.puts || [];
        
        let totalCallOI = 0;
        let totalPutOI = 0;
        let maxCallOI = 0;
        let maxPutOI = 0;
        let callWallStrike = 0;
        let putWallStrike = 0;
        let allStrikes = new Set();
        
        calls.forEach(c => {
            const oi = c.openInterest || 0;
            totalCallOI += oi;
            if (oi > maxCallOI) { maxCallOI = oi; callWallStrike = c.strike; }
            allStrikes.add(c.strike);
        });
        
        puts.forEach(p => {
            const oi = p.openInterest || 0;
            totalPutOI += oi;
            if (oi > maxPutOI) { maxPutOI = oi; putWallStrike = p.strike; }
            allStrikes.add(p.strike);
        });
        
        // Put/Call Ratio
        const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 1;
        
        // Max Pain
        let minPainValue = Infinity;
        let maxPainStrike = 0;
        const strikeArray = Array.from(allStrikes).sort((a,b)=>a-b);
        
        strikeArray.forEach(strike => {
            let totalPain = 0;
            // Calls pain (intrinsic value if price expires at 'strike')
            calls.forEach(c => {
                if (strike > c.strike) {
                    totalPain += (strike - c.strike) * (c.openInterest || 0);
                }
            });
            // Puts pain
            puts.forEach(p => {
                if (strike < p.strike) {
                    totalPain += (p.strike - strike) * (p.openInterest || 0);
                }
            });
            
            if (totalPain <= minPainValue && totalPain > 0) {
                minPainValue = totalPain;
                maxPainStrike = strike;
            }
        });
        
        return {
            pcr: parseFloat(pcr.toFixed(2)),
            callWall: callWallStrike,
            putWall: putWallStrike,
            maxPain: maxPainStrike,
            totalCallOI,
            totalPutOI
        };
    } catch(e) {
        console.error("Options fetch error:", e.message);
        return null;
    }
}

async function test() {
    const sym = 'AAPL';
    const quote = await yf.quote(sym);
    const cp = quote.regularMarketPrice;
    console.log(`Analyzing ${sym} at ${cp}`);
    const res = await analyzeOptionsFlow(sym, cp);
    console.log("Result:", res);
}
test();
