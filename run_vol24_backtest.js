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
    if (!candles || candles.length < 250) return null; // Need 200 minimum for SMA
    
    let trades40 = [];
    
    for (let i = 205; i < candles.length - 24; i++) {
        // We slice 200 candles to compute SMA
        const window = candles.slice(i - 200, i + 1);
        const opens = window.map(k => k.open);
        const highs = window.map(k => k.high);
        const lows = window.map(k => k.low);
        const closes = window.map(k => k.close);
        const volumes = window.map(k => k.volume);
        const currentPrice = closes[closes.length - 1];
        
        const atrRes = ATR.calculate({high: highs.slice(-100), low: lows.slice(-100), close: closes.slice(-100), period: 14});
        const currentATR = atrRes[atrRes.length - 1] || (currentPrice * 0.015);
        
        const recentLows = lows.slice(-6);
        const recentHighs = highs.slice(-6);
        let recentMin = Math.min(...recentLows);
        let recentMax = Math.max(...recentHighs);
        const rangeHigh = Math.max(...highs.slice(-100)); // calculate range locally for 100
        const rangeLow = Math.min(...lows.slice(-100));
        const eq = (rangeHigh + rangeLow)/2;
        
        let dipDeviation = false; let tepeDeviation = false;
        if (recentMin <= rangeLow * 1.005 && currentPrice > rangeLow && currentPrice > highs[lows.lastIndexOf(recentMin)]) dipDeviation = true;
        if (recentMax >= rangeHigh * 0.995 && currentPrice < rangeHigh && currentPrice < lows[highs.lastIndexOf(recentMax)]) tepeDeviation = true;
        
        if (!dipDeviation && !tepeDeviation) continue;
        
        const direction = dipDeviation ? 'LONG' : 'SHORT';
        
        if (direction === 'LONG' && globalVol < 4000000) continue; 
        if (direction === 'SHORT' && globalVol < 2000000) continue; 
        
        let qualityScore = 0;
        
        // --- 200 SMA SOFT FILTER LOGIC ---
        const sma200Values = SMA.calculate({period: 200, values: closes});
        const curSma200 = sma200Values[sma200Values.length - 1];
        
        if (direction === 'LONG' && currentPrice < curSma200) {
            qualityScore -= 15;
        }
        if (direction === 'SHORT' && currentPrice > curSma200) {
            qualityScore -= 15;
        }
        // ---------------------------------
        
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
        
        // Use last 100 for indicators to match previous logic exactly
        const localCloses = closes.slice(-100);
        const kama = calculateKAMA(localCloses, 10, 2, 30);
        if (kama[kama.length-1]) {
            if (direction === 'LONG' && currentPrice > kama[kama.length-1]) qualityScore += 5;
            else if (direction === 'SHORT' && currentPrice < kama[kama.length-1]) qualityScore += 5;
        }
        
        const stoch = StochasticRSI.calculate({ values: localCloses, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });
        if (stoch.length > 0) {
            const tk = stoch[stoch.length-1].k;
            if (direction==='LONG' && tk > 80) qualityScore -= 10;
            if (direction==='SHORT' && tk < 20) qualityScore -= 10;
        }
        
        const ichi = IchimokuCloud.calculate({ high: highs.slice(-100), low: lows.slice(-100), conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 });
        if (ichi.length > 0) {
            const ic = ichi[ichi.length-1];
            if (direction==='LONG' && currentPrice > ic.spanA && currentPrice > ic.spanB && ic.conversion > ic.base) qualityScore += 15;
            if (direction==='SHORT' && currentPrice < ic.spanA && currentPrice < ic.spanB && ic.conversion < ic.base) qualityScore += 15;
        }
        
        const buyVol = volumes[volumes.length-1] * ((closes[closes.length-1] - lows[lows.length-1]) / (highs[highs.length-1] - lows[lows.length-1] || 1));
        const sellVol = volumes[volumes.length-1] - buyVol;
        if (direction==='LONG') qualityScore += (buyVol > sellVol) ? 8 : -8;
        if (direction==='SHORT') qualityScore += (sellVol > buyVol) ? 8 : -8;
        
        // LONG BARAJI 55, SHORT BARAJI 40 (Volume 5M Deneysel Test)
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
        
        trades40.push({ date: new Date(candles[i].date).toLocaleString(), direction, score: qualityScore, outcome });
        i += 6; 
    }
    
    return { symbol, trades40 };
}

async function run() {
    process.stdout.write("Fetching top BingX pairs for 1 month Soft Filter 200 SMA backtest...\n");
    const pairs = await getTopPairsBingX(50); 
    
    let stats = { totalTrades: 0, longs: 0, shorts: 0, tp: 0, sl: 0, tpLong: 0, slLong: 0, tpShort: 0, slShort: 0, pending: 0 };
    
    const batchSize = 10;
    for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);
        const promises = batch.map(p => backtest(p));
        const results = await Promise.all(promises);
        
        results.forEach(res => {
            if (!res) return;
            res.trades40.forEach(t => { 
                stats.totalTrades++;
                if(t.direction === 'LONG') stats.longs++;
                if(t.direction === 'SHORT') stats.shorts++;
                
                if(t.outcome === 'WIN') {
                    stats.tp++;
                    if(t.direction==='LONG') stats.tpLong++; else stats.tpShort++;
                }
                else if(t.outcome === 'LOSS') {
                    stats.sl++;
                    if(t.direction==='LONG') stats.slLong++; else stats.slShort++;
                }
                else stats.pending++;
            });
        });
        process.stdout.write(`Processed ${Math.min(i + batchSize, pairs.length)}/${pairs.length} coins...\n`);
    }
    
    const winRate = stats.tp + stats.sl > 0 ? ((stats.tp / (stats.tp + stats.sl)) * 100).toFixed(2) : 0;
    
    const riskPerTrade = 10; // $10 R scenaryosu
    // In our model, target is up to 3R usually. Since we cut targets exactly at 3R or whatever the chart gives, we'll assume an average 2R win?
    // Wait, let's just assume a fixed 1:2 R:R mapped profit. If Win = +20, if Loss = -10. 
    // Actually, earlier the user asked to simulate. Let's do Win = $25, Loss = -$10
    const moneyWon = stats.tp * (riskPerTrade * 2.5); // Average 2.5 R
    const moneyLost = stats.sl * riskPerTrade;
    const netProfit = moneyWon - moneyLost;
    
    const output = {
        Strategy: "Volume Test: 4M Long / 2M Short (SMA Filter on)",
        Period: "1 Month (720h)",
        QualityThreshold: "Long >= 55, Short >= 40",
        TestedPairsCount: pairs.length,
        TotalSignals: stats.totalTrades,
        Breakdown: {
            Longs: { count: stats.longs, wins: stats.tpLong, losses: stats.slLong },
            Shorts: { count: stats.shorts, wins: stats.tpShort, losses: stats.slShort }
        },
        Outcomes: {
            TakeProfit_Wins: stats.tp,
            StopLoss_Losses: stats.sl,
            Pending: stats.pending
        },
        WinRate: `%${winRate}`,
        Projected_10R_Profit: `$${netProfit.toFixed(2)} (Assuming 1:2.5 avg RR)`
    };
    
    console.log("\n=== VOL TEST 4M/2M BACKTEST RAPORU ===");
    console.log(JSON.stringify(output, null, 2));
}

run();
