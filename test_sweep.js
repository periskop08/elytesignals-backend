const axios = require('axios');

async function getUsdtPairs() {
    const response = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
    return response.data.data.filter(s => s.symbol.endsWith('-USDT') && parseFloat(s.quoteVolume) > 1000000).map(s => s.symbol.replace('-', ''));
}

async function run() {
    try {
        console.log("Fetching pairs...");
        const pairs = await getUsdtPairs();
        console.log(`Testing ${pairs.length} pairs for Sweep & Breakout logic...`);
        
        let passedSweepCount = 0;
        let reasons = { choche_fail: 0, no_sweep_recent: 0, no_breakout: 0, fetch_fail: 0 };
        
        for (const sym of pairs) {
            try {
                const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=60&limit=100`;
                const { data } = await axios.get(url);
                if (!data || !data.result || !data.result.list) {
                    reasons.fetch_fail++;
                    continue;
                }
                const klines = data.result.list.reverse().map(k => ({
                    open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4])
                }));
                
                if (klines.length < 100) continue;
                
                const opens = klines.map(k => k.open);
                const highs = klines.map(k => k.high);
                const lows = klines.map(k => k.low);
                const closes = klines.map(k => k.close);
                const currentPrice = closes[closes.length - 1];
                
                const recentLows = lows.slice(-6);
                const recentHighs = highs.slice(-6);
                let recentMin = Math.min(...recentLows);
                let recentMax = Math.max(...recentHighs);
                
                let dipDeviation = false;
                let tepeDeviation = false;

                const localLows = lows.slice(-24);
                const localHighs = highs.slice(-24);
                const localRangeLow = Math.min(...localLows);
                const localRangeHigh = Math.max(...localHighs);

                let hasSweepDip = false;
                if (recentMin <= localRangeLow * 1.005 && currentPrice > localRangeLow) {
                    let sweepIdx = lows.lastIndexOf(recentMin);
                    if (sweepIdx !== -1) {
                        hasSweepDip = true;
                        if (currentPrice > highs[sweepIdx]) { // CHOCH
                            dipDeviation = true;
                        } else {
                            reasons.choche_fail++;
                        }
                    }
                }
                
                let hasSweepTepe = false;
                if (recentMax >= localRangeHigh * 0.995 && currentPrice < localRangeHigh) {
                    let sweepIdx = highs.lastIndexOf(recentMax);
                    if (sweepIdx !== -1) {
                        hasSweepTepe = true;
                        if (currentPrice < lows[sweepIdx]) {
                            tepeDeviation = true;
                        } else {
                            reasons.choche_fail++;
                        }
                    }
                }
                
                if (!hasSweepDip && !hasSweepTepe) {
                    reasons.no_sweep_recent++;
                }

                // BREAKOUT
                const prevRangeHigh = Math.max(...highs.slice(0, -1));
                const prevRangeLow = Math.min(...lows.slice(0, -1));
                if (currentPrice > prevRangeHigh) dipDeviation = true;
                if (currentPrice < prevRangeLow) tepeDeviation = true;

                if (!dipDeviation && !tepeDeviation) {
                    reasons.no_breakout++;
                } else {
                    passedSweepCount++;
                    console.log(`[PASS] ${sym} -> DipDev: ${dipDeviation}, TepeDev: ${tepeDeviation}`);
                }
            } catch(e) {
                // Ignore API catch
            }
        }
        
        console.log(`\nResults: ${passedSweepCount} pairs PASSED out of ${pairs.length}.`);
        console.log(`Fail Reasons Breakdown:`, reasons);
    } catch(e) {
        console.error(e);
    }
}

run();
