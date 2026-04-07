const axios = require('axios');
const { ATR, SMA, IchimokuCloud, StochasticRSI } = require('technicalindicators');

function calculateKAMA(prices, period = 10, fastEMA = 2, slowEMA = 30) {
    if (prices.length <= period) return Array(prices.length).fill(null);
    let kamaValues = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += prices[i];
    let prevKAMA = sum / period;
    for (let i = 0; i < period; i++) kamaValues.push(null);
    kamaValues[period - 1] = prevKAMA;
    const fastest = 2 / (fastEMA + 1);
    const slowest = 2 / (slowEMA + 1);
    for (let i = period; i < prices.length; i++) {
        let change = Math.abs(prices[i] - prices[i - period]);
        let volatility = 0;
        for (let j = i - period + 1; j <= i; j++) {
            volatility += Math.abs(prices[j] - prices[j - 1]);
        }
        let ER = volatility === 0 ? 0 : change / volatility;
        let SC = Math.pow(ER * (fastest - slowest) + slowest, 2);
        let currKAMA = prevKAMA + SC * (prices[i] - prevKAMA);
        kamaValues.push(currKAMA);
        prevKAMA = currKAMA;
    }
    return kamaValues;
}

async function fetchBybitCandles(symbol, intervalMinutes, limit) {
    try {
        const res = await axios.get(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${intervalMinutes}&limit=${limit}`);
        return res.data.result.list.map(k => ({
            open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]), date: parseInt(k[0])
        })).reverse();
    } catch(e) { return null; }
}

async function backtest(symbol) {
    console.log(`Fetching 1h data for ${symbol}...`);
    // 30 days = 720 hours + 100 for window = ~820 limit
    let candles = await fetchBybitCandles(symbol, 60, 1000);
    if (!candles || candles.length < 200) return null;
    
    let trades = [];
    
    // Simulate window scanning
    for (let i = 100; i < candles.length - 24; i++) {
        const window = candles.slice(i - 100, i);
        const opens = window.map(k => k.open);
        const highs = window.map(k => k.high);
        const lows = window.map(k => k.low);
        const closes = window.map(k => k.close);
        const volumes = window.map(k => k.volume);
        const currentPrice = closes[closes.length - 1];
        
        const atrRes = ATR.calculate({high: highs, low: lows, close: closes, period: 14});
        const currentATR = atrRes[atrRes.length - 1] || (currentPrice * 0.015);
        
        const recentLows = lows.slice(-6);
        const recentHighs = highs.slice(-6);
        let recentMin = Math.min(...recentLows);
        let recentMax = Math.max(...recentHighs);
        const rangeHigh = Math.max(...highs);
        const rangeLow = Math.min(...lows);
        const eq = (rangeHigh + rangeLow)/2;
        
        // SWEeps
        let dipDeviation = false; let tepeDeviation = false;
        if (recentMin <= rangeLow * 1.005 && currentPrice > rangeLow && currentPrice > highs[lows.lastIndexOf(recentMin)]) dipDeviation = true;
        if (recentMax >= rangeHigh * 0.995 && currentPrice < rangeHigh && currentPrice < lows[highs.lastIndexOf(recentMax)]) tepeDeviation = true;
        
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
        
        // OB
        const obZone = direction === 'LONG' ? [rangeLow - (currentATR * 1.5), rangeLow + (currentATR * 1.5)] : [rangeHigh - (currentATR * 1.5), rangeHigh + (currentATR * 1.5)];
        let hasOB = false;
        for (let k = closes.length - 36; k <= closes.length - 6; k++) {
            if (direction === 'LONG' && closes[k] < opens[k] && closes[k] <= obZone[1] && closes[k] >= obZone[0] && highs[k+1] > highs[k]) { hasOB = true; break; }
            if (direction === 'SHORT' && closes[k] > opens[k] && closes[k] >= obZone[0] && closes[k] <= obZone[1] && lows[k+1] < lows[k]) { hasOB = true; break; }
        }
        if (hasOB) qualityScore += 25;
        
        // RVOL
        const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        if (volumes[volumes.length-1] / (avgVol || 1) >= 1.2) qualityScore += 15;
        
        // NEW INDICATORS
        // 1. KAMA
        const kama = calculateKAMA(closes, 10, 2, 30);
        if (kama[kama.length-1]) {
            if (direction === 'LONG' && currentPrice > kama[kama.length-1]) qualityScore += 5;
            else if (direction === 'SHORT' && currentPrice < kama[kama.length-1]) qualityScore += 5;
        }
        
        // 2. StochRSI
        const stoch = StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });
        if (stoch.length > 0) {
            const tk = stoch[stoch.length-1].k;
            if (direction==='LONG' && tk > 80) qualityScore -= 10;
            if (direction==='SHORT' && tk < 20) qualityScore -= 10;
        }
        
        // 3. Ichimoku
        const ichi = IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 });
        if (ichi.length > 0) {
            const ic = ichi[ichi.length-1];
            if (direction==='LONG' && currentPrice > ic.spanA && currentPrice > ic.spanB && ic.conversion > ic.base) qualityScore += 15;
            if (direction==='SHORT' && currentPrice < ic.spanA && currentPrice < ic.spanB && ic.conversion < ic.base) qualityScore += 15;
        }
        
        // 4. Order flow
        const buyVol = volumes[volumes.length-1] * ((closes[closes.length-1] - lows[lows.length-1]) / (highs[highs.length-1] - lows[lows.length-1] || 1));
        const sellVol = volumes[volumes.length-1] - buyVol;
        if (direction==='LONG') qualityScore += (buyVol > sellVol) ? 8 : -8;
        if (direction==='SHORT') qualityScore += (sellVol > buyVol) ? 8 : -8;
        
        if (qualityScore < 55) continue;
        
        // Simulation Forward
        let dynamicStop = direction === 'LONG' ? currentPrice - (currentATR * 1.5) : currentPrice + (currentATR * 1.5);
        let risk = Math.abs(currentPrice - dynamicStop);
        let targetP = eq;
        let reward = Math.abs(currentPrice - targetP);
        if (reward > risk * 3) { reward = risk * 3; targetP = direction==='LONG' ? currentPrice + reward : currentPrice - reward; }
        if (reward/risk < 1.0) continue; // RR Filter
        
        let outcome = 'PENDING';
        let outcomePrice = 0;
        
        for (let f = i; f < candles.length; f++) {
            if (direction === 'LONG') {
                if (candles[f].low <= dynamicStop) { outcome = 'LOSS'; outcomePrice = dynamicStop; break; }
                if (candles[f].high >= targetP) { outcome = 'WIN'; outcomePrice = targetP; break; }
            } else {
                if (candles[f].high >= dynamicStop) { outcome = 'LOSS'; outcomePrice = dynamicStop; break; }
                if (candles[f].low <= targetP) { outcome = 'WIN'; outcomePrice = targetP; break; }
            }
        }
        
        trades.push({
            date: new Date(candles[i].date).toLocaleString(),
            direction,
            score: qualityScore,
            outcome
        });
        i += 6; // cooldown to prevent overlapping signals
    }
    
    return { symbol, trades };
}

async function run() {
    const pairs = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'PYTHUSDT', 'AAVEUSDT'];
    let results = [];
    for (let p of pairs) {
        let res = await backtest(p);
        if (res) results.push(res);
    }
    console.log(JSON.stringify(results, null, 2));
}

run();
