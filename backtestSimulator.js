const { SMA, ADX, ATR } = require('technicalindicators');
const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass();
const fs = require('fs');

async function fetchCandles(fetchId, daysOffset) {
    const queryOptions = { period1: new Date(Date.now() - daysOffset * 24 * 60 * 60 * 1000), interval: '1h' };
    const result = await yahooFinance.chart(fetchId, queryOptions);
    let quotes = result.quotes.filter(q => q.open !== null && q.close !== null);
    return quotes.map(q => ({
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume || 0,
        date: new Date(q.date)
    }));
}

function simulate(symbol, closesAll, highsAll, lowsAll, opensAll, volsAll, datesAll) {
    let signals = [];
    
    const lookback = 70; // 70 candles lookback for range
    for (let i = lookback; i < closesAll.length - 1; i++) {
        const closes = closesAll.slice(i - lookback, i);
        const highs = highsAll.slice(i - lookback, i);
        const lows = lowsAll.slice(i - lookback, i);
        const opens = opensAll.slice(i - lookback, i);
        const volumes = volsAll.slice(i - lookback, i);
        const currentDate = datesAll[i];
        
        const currentPrice = closes[closes.length - 1];
        const rangeHigh = Math.max(...highs);
        const rangeLow = Math.min(...lows);
        const eq = (rangeHigh + rangeLow) / 2;

        const atrRes = ATR.calculate({high: highs, low: lows, close: closes, period: 14});
        const currentATR = atrRes[atrRes.length - 1] || (currentPrice * 0.015);

        // Sweeps
        const recentLows = lows.slice(-6);
        const recentHighs = highs.slice(-6);
        let recentMin = Math.min(...recentLows);
        let recentMax = Math.max(...recentHighs);
        
        let dipDeviation = false;
        let tepeDeviation = false;

        if (recentMin <= rangeLow * 1.005 && currentPrice > rangeLow) {
            let sweepIdx = lows.lastIndexOf(recentMin);
            if (sweepIdx !== -1) {
                let wick = Math.min(opens[sweepIdx], closes[sweepIdx]) - lows[sweepIdx];
                if (wick >= currentATR * 0.8 && currentPrice > (lows[sweepIdx] + wick * 0.5)) {
                    if (currentPrice > highs[sweepIdx]) { dipDeviation = true; }
                }
            }
        }

        if (recentMax >= rangeHigh * 0.995 && currentPrice < rangeHigh) {
            let sweepIdx = highs.lastIndexOf(recentMax);
            if (sweepIdx !== -1) {
                let upperWick = highs[sweepIdx] - Math.max(opens[sweepIdx], closes[sweepIdx]);
                if (upperWick >= currentATR * 0.8 && currentPrice < (highs[sweepIdx] - upperWick * 0.5)) {
                    if (currentPrice < lows[sweepIdx]) { tepeDeviation = true; }
                }
            }
        }

        if (!dipDeviation && !tepeDeviation) continue;

        const direction = dipDeviation ? 'LONG' : 'SHORT';
        let qualityScore = 0;

        // FVG
        let hasFVG = false;
        for (let j = closes.length - 3; j <= closes.length - 1; j++) {
            if (j >= 2) {
                if (direction === 'LONG' && highs[j-2] < lows[j]) hasFVG = true; 
                if (direction === 'SHORT' && lows[j-2] > highs[j]) hasFVG = true; 
            }
        }
        if (hasFVG) qualityScore += 15;

        // RVOL
        const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        const recentVol = Math.max(...volumes.slice(-3));
        if (recentVol / (avgVol || 1) >= 1.2) qualityScore += 15;

        // RR
        let slMultiplier = (symbol === 'XAUUSD') ? 2.5 : 1.5;
        let dynamicStop = direction === 'LONG' ? currentPrice - (currentATR * slMultiplier) : currentPrice + (currentATR * slMultiplier);
        let risk = Math.abs(currentPrice - dynamicStop);
        let targetP = eq;
        
        let reward = Math.abs(currentPrice - targetP);
        if (reward > risk * 3.0) { reward = risk * 3.0; targetP = direction === 'LONG' ? currentPrice + reward : currentPrice - reward; }
        
        let rr = reward / risk;

        if (qualityScore >= 0 && rr >= 0.5) {
             let outcome = 'PENDING';
             let endPrice = 0;
             for(let f = i + 1; f < closesAll.length; f++) {
                 if (direction === 'LONG') {
                     if (lowsAll[f] <= dynamicStop) { outcome = 'LOSS'; endPrice = dynamicStop; break; }
                     if (highsAll[f] >= targetP) { outcome = 'WIN'; endPrice = targetP; break; }
                 } else {
                     if (highsAll[f] >= dynamicStop) { outcome = 'LOSS'; endPrice = dynamicStop; break; }
                     if (lowsAll[f] <= targetP) { outcome = 'WIN'; endPrice = targetP; break; }
                 }
             }
             
             signals.push({
                 date: currentDate.toLocaleString(),
                 direction,
                 entry: currentPrice.toFixed(2),
                 tp: targetP.toFixed(2),
                 sl: dynamicStop.toFixed(2),
                 score: qualityScore,
                 rr: rr.toFixed(2),
                 outcome
             });
             i += 10; // Pause after a signal
        }
    }
    return signals;
}

async function run() {
    try {
        console.log("=== 30 GUNLUK VERILER CEKILIYOR ===");
        const goldCandles = await fetchCandles('GC=F', 30);
        const appleCandles = await fetchCandles('AAPL', 30);

        const resGold = simulate('XAUUSD', goldCandles.map(c=>c.close), goldCandles.map(c=>c.high), goldCandles.map(c=>c.low), goldCandles.map(c=>c.open), goldCandles.map(c=>c.volume), goldCandles.map(c=>c.date));
        const resApple = simulate('AAPL', appleCandles.map(c=>c.close), appleCandles.map(c=>c.high), appleCandles.map(c=>c.low), appleCandles.map(c=>c.open), appleCandles.map(c=>c.volume), appleCandles.map(c=>c.date));

        fs.writeFileSync('backtest-results.json', JSON.stringify({XAUUSD: resGold, AAPL: resApple}, null, 2));
        console.log("TAMAMLANDI!");
        
    } catch(e) { console.error(e); }
}

run();
