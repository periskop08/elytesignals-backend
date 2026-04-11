const axios = require('axios');
const { ATR, EMA, IchimokuCloud, StochasticRSI, ADX } = require('technicalindicators');

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

async function fetchBingxCandles(symbol, intervalMinutes, limit) {
    try {
        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${symbol}&interval=1h&limit=${limit}`);
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

    let candles = await fetchBingxCandles(symbol, 60, 1000);
    if (!candles || candles.length < 350) return null; 
    
    let trades40 = [];
    
    for (let i = 300; i < candles.length - 24; i++) {
        // PERPLEXITY MACRO/MICRO SEPARATION LOGIC
        const macroContext = candles.slice(i - 300, i + 1); // 300 Mums
        const microSetup = macroContext.slice(-100);       // 100 Mums
        
        // MACRO TREND CALC (EMA 200 with 300 warmup)
        const closesFull = macroContext.map(k => k.close);
        const ema200Values = EMA.calculate({period: 200, values: closesFull});
        const curEma200 = ema200Values[ema200Values.length - 1];

        // MICRO ACTIONS (Entry Triggers)
        const opens = microSetup.map(k => k.open);
        const highs = microSetup.map(k => k.high);
        const lows = microSetup.map(k => k.low);
        const closes = microSetup.map(k => k.close);
        const volumes = microSetup.map(k => k.volume);
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
        if (direction === 'LONG' && globalVol < 5000000) continue; 
        if (direction === 'SHORT' && globalVol < 3000000) continue; 
        
        let qualityScore = 0;
        
        // APPLY MACRO TREND PENALTY (EMA 200)
        if (direction === 'LONG' && currentPrice < curEma200) qualityScore -= 15;
        if (direction === 'SHORT' && currentPrice > curEma200) qualityScore -= 15;
        
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

        // MARKET REGIME (ADX + ATR)
        const adxResult = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
        const currentADX = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 0;
        let avgATROld = currentATR;
        const atrResArray = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
        if (atrResArray.length >= 14) {
            const last14Atr = atrResArray.slice(-14);
            avgATROld = last14Atr.reduce((acc, val) => acc + val, 0) / 14;
        }
        const isVolatileExpanding = currentATR > (avgATROld * 1.1);

        if (currentADX >= 25 && isVolatileExpanding) {
            qualityScore += 5; 
        } else if (currentADX >= 25 && !isVolatileExpanding) {
            qualityScore += 5;
        } else if (currentADX < 20) {
            qualityScore -= 5;
        }
        
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
        
        let currentJ = closes.length - 1;

        // 1. Killer Wick (Katil Fitil) Kontrolü
        let hasKillerWick = false;
        for (let j = closes.length - 3; j <= closes.length - 1; j++) {
            if (j >= 0) {
                let candleSize = highs[j] - lows[j] || 1;
                if (direction === 'LONG') {
                    let minCloseOpen = Math.min(opens[j], closes[j]);
                    let lowerWick = minCloseOpen - lows[j];
                    let wickRatio = lowerWick / candleSize;
                    if (wickRatio > 0.40 && closes[j] > ((highs[j] + lows[j])/2)) {
                        hasKillerWick = true; break;
                    }
                } else {
                    let maxCloseOpen = Math.max(opens[j], closes[j]);
                    let upperWick = highs[j] - maxCloseOpen;
                    let wickRatio = upperWick / candleSize;
                    if (wickRatio > 0.40 && closes[j] < ((highs[j] + lows[j])/2)) {
                        hasKillerWick = true; break;
                    }
                }
            }
        }

        // 2. Engulfing (Yutan Mum) Kontrolü
        let hasEngulfing = false;
        if (currentJ >= 1) {
            let pOpen = opens[currentJ-1]; let pClose = closes[currentJ-1];
            let cOpen = opens[currentJ]; let cClose = closes[currentJ];
            if (direction === 'LONG') {
                if (pClose < pOpen && cClose > cOpen && cClose >= pOpen && cOpen <= pClose) {
                    hasEngulfing = true;
                }
            } else {
                if (pClose > pOpen && cClose < cOpen && cClose <= pOpen && cOpen >= pClose) {
                    hasEngulfing = true;
                }
            }
        }

        if (hasKillerWick || hasEngulfing) {
            qualityScore += 20;
        }

        // 3. TUZAK -> Likidite
        let hasSweep = false;
        if (currentJ >= 10) {
            let past10Lows = lows.slice(currentJ-10, currentJ);
            let past10Highs = highs.slice(currentJ-10, currentJ);
            let min10Low = Math.min(...past10Lows);
            let max10High = Math.max(...past10Highs);
            
            if (direction === 'LONG') {
                if (lows[currentJ] < min10Low && closes[currentJ] > opens[currentJ] && closes[currentJ] > ((highs[currentJ]+lows[currentJ])/2)) {
                    hasSweep = true;
                }
            } else {
                if (highs[currentJ] > max10High && closes[currentJ] < opens[currentJ] && closes[currentJ] < ((highs[currentJ]+lows[currentJ])/2)) {
                    hasSweep = true;
                }
            }
        }
        if (hasSweep) {
            qualityScore += 15;
        }

        let shortTermVolAvg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        let lastVol = volumes[currentJ];
        if (direction === 'LONG' && lastVol < shortTermVolAvg * 0.9 && closes[currentJ] < opens[currentJ]) {
            qualityScore += 12;
        } else if (direction === 'SHORT' && lastVol < shortTermVolAvg * 0.9 && closes[currentJ] > opens[currentJ]) {
            qualityScore += 12;
        }
        
        // LONG BARAJI 55, SHORT BARAJI 40
        // removed so we can see all brackets
        
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
        
        trades40.push({ date: new Date(candles[i].date).toLocaleString(), direction, score: qualityScore, outcome });
        i += 6; 
    }
    
    return { symbol, trades40 };
}

async function run() {
    process.stdout.write("Fetching top BingX pairs for 1 month MACRO/MICRO 300 Candles EMA backtest...\n");
    const pairs = await getTopPairsBingX(500); 
    
    let stats = {
        total: 0,
        buckets: {
            "<40": {count:0, win:0, loss:0},
            "40-44": {count:0, win:0, loss:0},
            "45-49": {count:0, win:0, loss:0},
            "50-54": {count:0, win:0, loss:0},
            "55-59": {count:0, win:0, loss:0},
            "60-64": {count:0, win:0, loss:0},
            "65-69": {count:0, win:0, loss:0},
            "70-74": {count:0, win:0, loss:0},
            "75-79": {count:0, win:0, loss:0},
            "80-84": {count:0, win:0, loss:0},
            "85-89": {count:0, win:0, loss:0},
            "90-94": {count:0, win:0, loss:0},
            "95-100": {count:0, win:0, loss:0}
        }
    };
    
    const batchSize = 10;
    for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);
        const promises = batch.map(p => backtest(p));
        const results = await Promise.all(promises);
        
        results.forEach(res => {
            if (!res) return;
            res.trades40.forEach(t => { 
                stats.total++;
                
                let b = "";
                if (t.score < 40) b = "<40";
                else if (t.score < 45) b = "40-44";
                else if (t.score < 50) b = "45-49";
                else if (t.score < 55) b = "50-54";
                else if (t.score < 60) b = "55-59";
                else if (t.score < 65) b = "60-64";
                else if (t.score < 70) b = "65-69";
                else if (t.score < 75) b = "70-74";
                else if (t.score < 80) b = "75-79";
                else if (t.score < 85) b = "80-84";
                else if (t.score < 90) b = "85-89";
                else if (t.score < 95) b = "90-94";
                else b = "95-100";

                if(t.outcome === 'WIN') {
                    stats.buckets[b].win++;
                    stats.buckets[b].count++;
                }
                else if(t.outcome === 'LOSS') {
                    stats.buckets[b].loss++;
                    stats.buckets[b].count++;
                }
            });
        });
        process.stdout.write(`Processed ${Math.min(i + batchSize, pairs.length)}/${pairs.length} coins...\n`);
    }
    
    let outputStr = "=== DETAYLI SCORE BRACKET MACRO/MICRO BACKTEST RAPORU ===\n";
    outputStr += `Total Signals Processed: ${stats.total}\n\n`;

    for (const [bracket, data] of Object.entries(stats.buckets)) {
        if (data.count === 0) continue;
        const winRate = data.count > 0 ? ((data.win / data.count) * 100).toFixed(2) : 0;
        const profit = (data.win * 25) - (data.loss * 10);
        outputStr += `[Puan Aralığı: ${bracket}]\n`;
        outputStr += `- Sinyal Sayısı: ${data.count} | Win: ${data.win} | Loss: ${data.loss}\n`;
        outputStr += `- Win Rate: %${winRate} | Projected PnL: $${profit.toFixed(2)}\n\n`;
    }
    console.log(outputStr);

}

run();
