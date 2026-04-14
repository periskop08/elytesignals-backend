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

async function getTopPairs(limit) {
    try {
        const res = await axios.get('https://api.bybit.com/v5/market/tickers?category=linear');
        const list = res.data.result.list;
        const usdtPairs = list.filter(item => item.symbol.endsWith('USDT') && parseFloat(item.turnover24h) > 10000000);
        usdtPairs.sort((a,b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h));
        return usdtPairs.slice(0, limit).map(i => i.symbol);
    } catch (e) {
        return ['BTCUSDT', 'ETHUSDT'];
    }
}

async function getTrades(symbol) {
    let candles = await fetchBybitCandles(symbol, 60, 1000); // 30 days
    if (!candles || candles.length < 200) return [];
    
    let trades40 = [];
    
    for (let i = 100; i < candles.length - 24; i++) {
        const window = candles.slice(i - 100, i + 1);
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
        
        let dipDeviation = false; let tepeDeviation = false;
        if (recentMin <= rangeLow * 1.005 && currentPrice > rangeLow && currentPrice > highs[lows.lastIndexOf(recentMin)]) dipDeviation = true;
        if (recentMax >= rangeHigh * 0.995 && currentPrice < rangeHigh && currentPrice < lows[highs.lastIndexOf(recentMax)]) tepeDeviation = true;
        
        if (!dipDeviation && !tepeDeviation) continue;
        
        const direction = dipDeviation ? 'LONG' : 'SHORT';
        let qualityScore = 0;
        
        let hasFVG = false;
        for (let j = closes.length - 3; j <= closes.length - 1; j++) {
            if (j >= 2) {
                if (direction === 'LONG' && highs[j-2] < lows[j]) hasFVG = true; 
                if (direction === 'SHORT' && lows[j-2] > highs[j]) hasFVG = true; 
            }
        }
        if (hasFVG) qualityScore += 15;
        
        const obZone = direction === 'LONG' ? [rangeLow - (currentATR * 1.5), rangeLow + (currentATR * 1.5)] : [rangeHigh - (currentATR * 1.5), rangeHigh + (currentATR * 1.5)];
        let hasOB = false;
        for (let k = closes.length - 36; k <= closes.length - 6; k++) {
            if (direction === 'LONG' && closes[k] < opens[k] && closes[k] <= obZone[1] && closes[k] >= obZone[0] && highs[k+1] > highs[k]) { hasOB = true; break; }
            if (direction === 'SHORT' && closes[k] > opens[k] && closes[k] >= obZone[0] && closes[k] <= obZone[1] && lows[k+1] < lows[k]) { hasOB = true; break; }
        }
        if (hasOB) qualityScore += 25;
        
        const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        if (volumes[volumes.length-1] / (avgVol || 1) >= 1.2) qualityScore += 15;
        
        const kama = calculateKAMA(closes, 10, 2, 30);
        if (kama[kama.length-1]) {
            if (direction === 'LONG' && currentPrice > kama[kama.length-1]) qualityScore += 5;
            else if (direction === 'SHORT' && currentPrice < kama[kama.length-1]) qualityScore += 5;
        }
        
        const stoch = StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });
        if (stoch.length > 0) {
            const tk = stoch[stoch.length-1].k;
            if (direction==='LONG' && tk > 80) qualityScore -= 10;
            if (direction==='SHORT' && tk < 20) qualityScore -= 10;
        }
        
        const ichi = IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 });
        if (ichi.length > 0) {
            const ic = ichi[ichi.length-1];
            if (direction==='LONG' && currentPrice > ic.spanA && currentPrice > ic.spanB && ic.conversion > ic.base) qualityScore += 15;
            if (direction==='SHORT' && currentPrice < ic.spanA && currentPrice < ic.spanB && ic.conversion < ic.base) qualityScore += 15;
        }
        
        const buyVol = volumes[volumes.length-1] * ((closes[closes.length-1] - lows[lows.length-1]) / (highs[highs.length-1] - lows[lows.length-1] || 1));
        const sellVol = volumes[volumes.length-1] - buyVol;
        if (direction==='LONG') qualityScore += (buyVol > sellVol) ? 8 : -8;
        if (direction==='SHORT') qualityScore += (sellVol > buyVol) ? 8 : -8;
        
        if (qualityScore < 40) continue;
        
        let dynamicStop = direction === 'LONG' ? currentPrice - (currentATR * 1.5) : currentPrice + (currentATR * 1.5);
        let risk = Math.abs(currentPrice - dynamicStop);
        let targetP = eq;
        let reward = Math.abs(currentPrice - targetP);
        if (reward > risk * 3) { reward = risk * 3; targetP = direction==='LONG' ? currentPrice + reward : currentPrice - reward; }
        if (reward/risk < 1.0) continue; 
        
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
        
        // Push the trade with real timestamp for sorting
        trades40.push({ symbol, date: candles[i].date, direction, score: qualityScore, outcome });
        i += 6; 
    }
    return trades40;
}

async function run() {
    process.stdout.write("Fetching top 50 pairs...\n");
    const pairs = await getTopPairs(50);
    
    let allTrades = [];
    
    const batchSize = 10;
    for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);
        const promises = batch.map(p => getTrades(p));
        const results = await Promise.all(promises);
        results.forEach(tradeArr => {
            if (tradeArr) allTrades.push(...tradeArr);
        });
        process.stdout.write(`Processed ${Math.min(i + batchSize, pairs.length)}/${pairs.length}...\n`);
    }
    
    // Sort trades chronologically
    allTrades.sort((a, b) => a.date - b.date);
    
    // Evaluate Portfolio
    let capital = 1000;
    const RISK_PER_TRADE = 20;
    const REWARD_PER_TRADE = 60;
    
    let maxDrawdown = 0;
    let peakCapital = 1000;
    let lowestCapital = 1000;
    
    let tradeLog = [];
    let activeTrades = 0;
    let maxActiveTrades = 0;
    
    // To simulate active trades concurrency, we assume trades take roughly 24 hours to hit SL or TP.
    // We'll keep a window of 24h (86400000 ms). If multiple trades happen inside 24h, they are "simultaneous".
    for (let i = 0; i < allTrades.length; i++) {
        let t = allTrades[i];
        
        // Count active trades (simple proxy: trades within last 24h)
        activeTrades = allTrades.filter(pastT => t.date - pastT.date < 86400000 && t.date >= pastT.date).length;
        if (activeTrades > maxActiveTrades) maxActiveTrades = activeTrades;
        
        if (capital <= 0) {
            tradeLog.push("BANKRUPT");
            break;
        }
        
        if (t.outcome === 'WIN') {
            capital += REWARD_PER_TRADE;
        } else if (t.outcome === 'LOSS') {
            capital -= RISK_PER_TRADE;
        }
        
        if (capital > peakCapital) peakCapital = capital;
        if (capital < lowestCapital) lowestCapital = capital;
        
        const drawdown = ((peakCapital - capital) / peakCapital) * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    
    const output = {
        totalTrades: allTrades.length,
        initialCapital: "$1000",
        finalCapital: `$${capital.toFixed(2)}`,
        lowestCapital: `$${lowestCapital.toFixed(2)}`,
        peakCapital: `$${peakCapital.toFixed(2)}`,
        maxDrawdownPercentage: `${maxDrawdown.toFixed(2)}%`,
        maxConcurrentTrades: maxActiveTrades,
        bankruptStatus: capital <= 0 ? "YES" : "NO"
    };
    
    console.log(JSON.stringify(output, null, 2));
}

run();
