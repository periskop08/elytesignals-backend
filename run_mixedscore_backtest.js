const axios = require('axios');
const { ATR, IchimokuCloud, StochasticRSI } = require('technicalindicators');

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

// BINGX FETCH KLINES
async function fetchBingxCandles(symbol, intervalMinutes, limit) {
    try {
        const interval = intervalMinutes === 60 ? '1h' : (intervalMinutes + 'm');
        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
        let list = res.data.data;
        list.sort((a,b) => a.time - b.time);
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
        // En düşük sınır 3M olduğu için 3M üstü hepsini alıp içeride süzeceğiz
        const usdtPairs = list.filter(item => item.symbol.endsWith('-USDT') && parseFloat(item.quoteVolume) > 3000000);
        usdtPairs.sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        
        return usdtPairs.slice(0, limit).map(i => ({ symbol: i.symbol, volume: parseFloat(i.quoteVolume) }));
    } catch (e) {
        return []; 
    }
}

async function backtest(assetInfo) {
    const symbol = assetInfo.symbol;
    const globalVol = assetInfo.volume;

    // 720 hours = 30 days
    let candles = await fetchBingxCandles(symbol, 60, 720);
    if (!candles || candles.length < 200) return null;
    
    let validTrades = [];
    
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
        
        // ASYMMETRIC VOLUME FILTER
        if (direction === 'LONG' && globalVol < 10000000) continue; 
        if (direction === 'SHORT' && globalVol < 3000000) continue;
        
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
        
        // MIXED SCORE LOGIC:
        if (direction === 'LONG' && qualityScore < 55) continue;
        if (direction === 'SHORT' && qualityScore < 40) continue;
        
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
        
        validTrades.push({ direction, outcome });
        i += 6; 
    }
    
    return { symbol, validTrades };
}

async function run() {
    process.stdout.write("Fetching top BingX pairs for MIXED SCORES backtest...\n");
    const pairs = await getTopPairsBingX(300); 
    
    let stats = { 
        totalTrades: 0, 
        longTp: 0, 
        longSl: 0, 
        shortTp: 0, 
        shortSl: 0
    };
    
    const batchSize = 10;
    for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);
        const promises = batch.map(p => backtest(p));
        const results = await Promise.all(promises);
        
        results.forEach(res => {
            if (!res) return;
            res.validTrades.forEach(t => { 
                stats.totalTrades++;
                if (t.direction === 'LONG') {
                    if(t.outcome === 'WIN') stats.longTp++;
                    if(t.outcome === 'LOSS') stats.longSl++;
                } else if (t.direction === 'SHORT') {
                    if(t.outcome === 'WIN') stats.shortTp++;
                    if(t.outcome === 'LOSS') stats.shortSl++;
                }
            });
        });
        process.stdout.write(`Processed ${Math.min(i + batchSize, pairs.length)}/${pairs.length} coins...\n`);
    }
    
    console.log("\n=== MIXED SCORE RAPORU ===");
    console.log("KURAL: LONG (Hacim>10M, Skor>=55)  |  SHORT (Hacim>3M, Skor>=40)\n");
    
    const longTotal = stats.longTp + stats.longSl;
    const shortTotal = stats.shortTp + stats.shortSl;
    const longWr = longTotal > 0 ? ((stats.longTp / longTotal) * 100).toFixed(2) : 0;
    const shortWr = shortTotal > 0 ? ((stats.shortTp / shortTotal) * 100).toFixed(2) : 0;
    
    const totalTp = stats.longTp + stats.shortTp;
    const totalSl = stats.longSl + stats.shortSl;
    const totalWr = (totalTp + totalSl) > 0 ? ((totalTp / (totalTp + totalSl)) * 100).toFixed(2) : 0;
    const rrPnL = (totalTp * 3) - (totalSl * 1);
    
    console.log(`[Genel Durum]`);
    console.log(`Toplam Sinyal: ${stats.totalTrades}`);
    console.log(`Genel Win Rate: %${totalWr} | Net KAR: +${rrPnL} R\n`);
    
    console.log(`[🟢 LONG PERFORMANSI (Skor >= 55)]`);
    console.log(`Toplam: ${longTotal} | TP: ${stats.longTp} - SL: ${stats.longSl}`);
    console.log(`LONG Win Rate: %${longWr}\n`);
    
    console.log(`[🔴 SHORT PERFORMANSI (Skor >= 40)]`);
    console.log(`Toplam: ${shortTotal} | TP: ${stats.shortTp} - SL: ${stats.shortSl}`);
    console.log(`SHORT Win Rate: %${shortWr}`);
}

run();
