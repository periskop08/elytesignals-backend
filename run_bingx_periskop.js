const axios = require('axios');
const { ATR, SMA, IchimokuCloud, StochasticRSI } = require('technicalindicators');

// BINGX FETCH KLINES
async function fetchBingxCandles(symbol, limit) {
    try {
        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${symbol}&interval=1h&limit=${limit}`);
        let list = res.data.data;
        list.sort((a,b) => a.time - b.time); // Ascending
        return list.map(k => ({
            open: parseFloat(k.open), 
            high: parseFloat(k.high), 
            low: parseFloat(k.low), 
            close: parseFloat(k.close), 
            volume: parseFloat(k.volume), 
            date: parseInt(k.time)
        }));
    } catch(e) { return null; }
}

async function getTopPairsBingX(limit) {
    try {
        const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        const list = res.data.data;
        // 3M Volume barrier
        const usdtPairs = list.filter(item => item.symbol.endsWith('-USDT') && parseFloat(item.quoteVolume) > 3000000);
        usdtPairs.sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        return usdtPairs.slice(0, limit).map(i => i.symbol.replace('-', ''));
    } catch (e) {
        return ['BTCUSDT', 'SOLUSDT', 'DOGEUSDT']; 
    }
}

async function backtest(symbol, config) {
    // BingX max 1h candles limit is often 1440 or so. Let's fetch 750 (approx 1 month).
    let originalSymbol = symbol.slice(0, -4) + '-USDT'; // Re-add hyphen for API
    let candles = await fetchBingxCandles(originalSymbol, 800); 
    if (!candles || candles.length < 150) return null;
    
    let trades = [];
    
    // Simulate scanner
    for (let i = 100; i < candles.length - 24; i++) {
        const window = candles.slice(i - 100, i + 1);
        const opens = window.map(k => k.open);
        const highs = window.map(k => k.high);
        const lows = window.map(k => k.low);
        const closes = window.map(k => k.close);
        const volumes = window.map(k => k.volume);
        const currentPrice = closes[closes.length - 1];
        
        const atrRes = ATR.calculate({high: highs, low: lows, close: closes, period: 10});
        const currentATR = atrRes[atrRes.length - 1] || (currentPrice * 0.015);
        
        // Find recent structural turning points
        const recentLows = lows.slice(-6);
        const recentHighs = highs.slice(-6);
        let dipDeviation = Math.min(...recentLows) <= Math.min(...lows)*1.005;
        let tepeDeviation = Math.max(...recentHighs) >= Math.max(...highs)*0.995;
        
        if (!dipDeviation && !tepeDeviation) continue;
        const direction = dipDeviation ? 'LONG' : 'SHORT';
        
        let qualityScore = 0;
        
        // Rough mock of our quality scoring
        const avgVol = volumes.slice(-30, -1).reduce((a, b) => a + b, 0) / 29;
        if (volumes[volumes.length-1] / (avgVol || 1) >= 1.5) qualityScore += 15;
        
        const obZone = direction === 'LONG' ? [Math.min(...lows), Math.min(...lows) + currentATR] : [Math.max(...highs) - currentATR, Math.max(...highs)];
        let hasOB = false;
        for (let k = closes.length - 30; k <= closes.length - 5; k++) {
            if (direction === 'LONG' && closes[k] <= obZone[1] && currentPrice > closes[k]) hasOB = true;
            if (direction === 'SHORT' && closes[k] >= obZone[0] && currentPrice < closes[k]) hasOB = true;
        }
        if (hasOB) qualityScore += 25;
        
        // Mocking FVG
        qualityScore += 15; 
        
        // HARD LIMIT SCORE
        if (qualityScore < config.minScoreThreshold) continue;
        
        let dynamicStop = direction === 'LONG' ? Math.min(...lows.slice(-3)) - (currentATR*0.5) : Math.max(...highs.slice(-3)) + (currentATR*0.5);
        let riskValue = Math.abs(currentPrice - dynamicStop);
        let riskPct = (riskValue / currentPrice) * 100;
        
        // PROPOSED FILTER 1: MAX SL % = 3.5%
        if (riskPct > config.maxSlPct) continue;
        
        // PROPOSED FILTER 2: DYNAMIC R:R
        let requiredRR = config.minRR;
        if (riskPct >= config.premiumSlThreshold) {
            requiredRR = config.premiumRR;
        }
        
        let rewardValue = riskValue * requiredRR;
        let targetP = direction === 'LONG' ? currentPrice + rewardValue : currentPrice - rewardValue;
        
        let outcome = 'PENDING';
        
        for (let f = i; f < candles.length; f++) {
            if (direction === 'LONG') {
                if (candles[f].low <= dynamicStop) { outcome = 'LOSS'; break; }
                if (candles[f].high >= targetP) { outcome = 'WIN'; break; }
            } else {
                if (candles[f].high >= dynamicStop) { outcome = 'LOSS'; break; }
                if (candles[f].low <= targetP) { outcome = 'WIN'; break; }
            }
        }
        
        // If it didn't close within the rest of the month, call it PENDING
        if (outcome !== 'PENDING') {
            trades.push({ date: new Date(candles[i].date).toLocaleString(), direction, outcome, riskPct, requiredRR });
            i += 6; // Avoid clustering
        }
    }
    
    return { symbol, trades };
}

async function runTest() {
    console.log("Fetching top BingX pairs for 1-Month Simulation...");
    const pairs = await getTopPairsBingX(60); // top 60 pairs
    
    // We will test 55 with 20$ risk
    const testScores = [55];
    
    for (const score of testScores) {
        console.log(`\n\n=== RUNNING SIMULATION FOR MIN SCORE: ${score} (RISK $20) ===`);
        let balance = 500;
        const RISK_USD = 20;
        
        let stats = {
            totalSignals: 0,
            longs: 0,
            shorts: 0,
            wins: 0,
            losses: 0,
            totalRiskPctSum: 0
        };
        
        const BATCH = 15;
        for (let i = 0; i < pairs.length; i += BATCH) {
            const batch = pairs.slice(i, i + BATCH);
            const results = await Promise.all(batch.map(p => backtest(p, {
                minScoreThreshold: score,
                maxSlPct: 3.5,
                premiumSlThreshold: 2.5,
                premiumRR: 2.0,
                minRR: 1.5
            })));
            
            for (const res of results) {
                if (!res) continue;
                for (const t of res.trades) {
                    stats.totalSignals++;
                    t.direction === 'LONG' ? stats.longs++ : stats.shorts++;
                    stats.totalRiskPctSum += t.riskPct;
                    
                    if (t.outcome === 'WIN') {
                        stats.wins++;
                        balance += (RISK_USD * t.requiredRR); // RR could be 1.5 or 2.0
                    } else {
                        stats.losses++;
                        balance -= RISK_USD;
                    }
                }
            }
        }
        
        const winRate = stats.totalSignals > 0 ? ((stats.wins / stats.totalSignals) * 100).toFixed(1) : 0;
        
        const finalReport = {
            scoreThreshold: score,
            timeframe: "1 Month (30 Days)",
            scannedCoins: pairs.length,
            totalSignals: stats.totalSignals,
            wins: stats.wins,
            losses: stats.losses,
            winRate: winRate + "%",
            startingBalance: "$500.00",
            finalBalance: "$" + balance.toFixed(2),
            netProfit: "$" + (balance - 500).toFixed(2)
        };
        console.log(JSON.stringify(finalReport, null, 2));
    }
}

runTest();
