const axios = require('axios');
const { ATR, EMA, IchimokuCloud, StochasticRSI, ADX, SMA } = require('technicalindicators');

async function getTopPairsByBit(limit) {
    try {
        const res = await axios.get('https://api.bybit.com/v5/market/tickers?category=linear');
        let list = res.data.result.list;
        const usdtPairs = list.filter(item => item.symbol.endsWith('USDT') && parseFloat(item.turnover24h) > 5000000);
        usdtPairs.sort((a,b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h));
        return usdtPairs.slice(0, limit).map(i => ({ symbol: i.symbol, volume: parseFloat(i.turnover24h) }));
    } catch (e) { return []; }
}

async function fetchBybitCandles(symbol, limit) {
    try {
        const res = await axios.get(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=60&limit=${limit}`);
        if (!res.data || !res.data.result || !res.data.result.list) return null;
        let list = res.data.result.list.map(k => ({
            time: parseInt(k[0]), open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5])
        })).reverse();
        return list;
    } catch(e) { return null; }
}

async function backtest(assetInfo) {
    const symbol = assetInfo.symbol;
    const globalVol = assetInfo.volume;

    let candles = await fetchBybitCandles(symbol, 1000);
    if (!candles || candles.length < 350) return null; 
    
    let trades40 = [];
    
    for (let i = 300; i < candles.length - 24; i++) {
        const macroContext = candles.slice(i - 300, i + 1);
        const microSetup = macroContext.slice(-100);
        
        const closesFull = macroContext.map(k => k.close);
        const ema200Values = EMA.calculate({period: 200, values: closesFull});
        const curEma200 = ema200Values[ema200Values.length - 1];

        const opens = microSetup.map(k => k.open);
        const highs = microSetup.map(k => k.high);
        const lows = microSetup.map(k => k.low);
        const closes = microSetup.map(k => k.close);
        const volumes = microSetup.map(k => k.volume);
        const currentPrice = closes[closes.length - 1];
        
        const atrRes = ATR.calculate({high: highs, low: lows, close: closes, period: 14});
        const currentATR = atrRes[atrRes.length - 1] || (currentPrice * 0.015);
        const avgATR = currentATR;
        
        let dipDeviation = false; let tepeDeviation = false; let internalDeviation = false; let internalDirection = '';
        
        // MACRO SWEEP
        const macroDipler = lows.slice(0, -1);
        const lastMacroDip = Math.min(...macroDipler);
        if (lows[lows.length - 1] <= lastMacroDip && currentPrice > lastMacroDip) dipDeviation = true;
        
        const macroTepeler = highs.slice(0, -1);
        const lastMacroTepe = Math.max(...macroTepeler);
        if (highs[highs.length - 1] >= lastMacroTepe && currentPrice < lastMacroTepe) tepeDeviation = true;

        // MICRO ADX & SUB-RANGE (15 - 25 SWEET SPOT LOGIC)
        const adxResult = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
        const currentADX = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 0;
        
        const subLows = lows.slice(-20, -1);
        const subHighs = highs.slice(-20, -1);
        const subRangeLow = Math.min(...subLows);
        const subRangeHigh = Math.max(...subHighs);
        const eq = (subRangeHigh + subRangeLow)/2;
        
        if (currentADX >= 15 && currentADX <= 25) {
            const oteShort = subRangeLow + (subRangeHigh - subRangeLow) * 0.618;
            if (highs[highs.length - 1] >= oteShort && currentPrice < subRangeHigh) {
                const wickSize = highs[highs.length - 1] - Math.max(opens[opens.length - 1], currentPrice);
                const bodySize = Math.abs(currentPrice - opens[opens.length - 1]) || 0.0001;
                if (wickSize > bodySize * 1.2) { internalDeviation = true; internalDirection = 'SHORT'; }
            }
            
            const oteLong = subRangeLow + (subRangeHigh - subRangeLow) * 0.382;
            if (lows[lows.length - 1] <= oteLong && currentPrice > subRangeLow) {
                const wickSize = Math.min(opens[opens.length - 1], currentPrice) - lows[lows.length - 1];
                const bodySize = Math.abs(currentPrice - opens[opens.length - 1]) || 0.0001;
                if (wickSize > bodySize * 1.2) { internalDeviation = true; internalDirection = 'LONG'; }
            }
        }
        
        if (!dipDeviation && !tepeDeviation && !internalDeviation) {
             continue; // KESİN VETO 
        }

        const direction = dipDeviation ? 'LONG' : (tepeDeviation ? 'SHORT' : internalDirection);
        let qualityScore = 0;

        if (internalDeviation) qualityScore += 22;
        if (dipDeviation || tepeDeviation || internalDeviation) qualityScore += 15; // JOKER !

        if (direction === 'LONG' && currentPrice > curEma200) qualityScore += 10;
        else if (direction === 'SHORT' && currentPrice < curEma200) qualityScore += 10;
        
        let hasFVG = false;
        for (let j = closes.length - 3; j <= closes.length - 1; j++) {
            if (j >= 2) {
                if (direction === 'LONG' && highs[j-2] < lows[j]) hasFVG = true; 
                if (direction === 'SHORT' && lows[j-2] > highs[j]) hasFVG = true; 
            }
        }
        if (hasFVG) qualityScore += 15;
        
        const obZone = direction === 'LONG' ? [subRangeLow - (currentATR * 1.5), subRangeLow + (currentATR * 1.5)] : [subRangeHigh - (currentATR * 1.5), subRangeHigh + (currentATR * 1.5)];
        let hasOB = false;
        for (let k = closes.length - 36; k <= closes.length - 6; k++) {
            if (direction === 'LONG' && closes[k] < opens[k] && closes[k] <= obZone[1] && closes[k] >= obZone[0] && highs[k+1] > highs[k]) { hasOB = true; break; }
            if (direction === 'SHORT' && closes[k] > opens[k] && closes[k] >= obZone[0] && closes[k] <= obZone[1] && lows[k+1] < lows[k]) { hasOB = true; break; }
        }
        if (hasOB) qualityScore += 25;
        
        const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        if (volumes[volumes.length-1] / (avgVol || 1) >= 1.2) qualityScore += 15;

        if (currentADX >= 15) { qualityScore += 10; }
        else if (currentADX < 15) { qualityScore -= 10; }
        
        const ichi = IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 });
        if (ichi.length > 0) {
            const ic = ichi[ichi.length-1];
            if (direction==='LONG' && currentPrice > ic.spanA && currentPrice > ic.spanB && ic.conversion > ic.base) qualityScore += 15;
            if (direction==='SHORT' && currentPrice < ic.spanA && currentPrice < ic.spanB && ic.conversion < ic.base) qualityScore += 15;
        }

        // BARAJ KONTROLÜ
        if (qualityScore < 45 || qualityScore > 75) continue; 
        
        let dynamicStop = direction === 'LONG' ? currentPrice - (currentATR * 1.5) : currentPrice + (currentATR * 1.5);
        let risk = Math.abs(currentPrice - dynamicStop);
        let targetP = eq;
        let reward = Math.abs(currentPrice - targetP);
        
        if (reward > risk * 3) { reward = risk * 3; targetP = direction==='LONG' ? currentPrice + reward : currentPrice - reward; }
        if (reward/risk < 1.0) continue; // Manifesto RR Filter 1.0/1.5
        
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

        if (outcome === 'PENDING') continue;
        
        trades40.push({ date: new Date(candles[i].time).toLocaleString(), direction, score: qualityScore, outcome });
        i += 6; 
    }
    
    return { symbol, trades40 };
}

async function run() {
    process.stdout.write("Fetching top 100 ByBit pairs for 30 Day Backtest...\n");
    const pairs = await getTopPairsByBit(100); 
    
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
            "75-100": {count:0, win:0, loss:0}
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
                else b = "75-100";

                if (t.outcome === 'WIN') { stats.buckets[b].win++; stats.buckets[b].count++; }
                else if (t.outcome === 'LOSS') { stats.buckets[b].loss++; stats.buckets[b].count++; }
            });
        });
        process.stdout.write(`Processed ${Math.min(i + batchSize, pairs.length)}/${pairs.length} coins...\n`);
    }
    
    let baseCapital = 500;
    const initialCapital = baseCapital;
    let expectedPnL = 0;
    let totalWins = 0; let totalLosses = 0;

    let outputStr = "=== ELYTE MATRIS (JOKER BATCH) BYBIT BACKTEST RAPORU ===\n";
    outputStr += `Total Signals Detected: ${stats.total}\n\n`;

    for (const [bracket, data] of Object.entries(stats.buckets)) {
        if (data.count === 0) continue;
        const winRate = ((data.win / data.count) * 100).toFixed(2);
        totalWins += data.win;
        totalLosses += data.loss;
        
        // 500$ 20X risk/pnl (standardized roughly to 1 R = $25 risk, RR = 1.5 -> $37.5 Reward)
        const profit = (data.win * 37.5) - (data.loss * 25);
        expectedPnL += profit;
        
        outputStr += `[Puan Aralığı: ${bracket}]\n`;
        outputStr += `- Sinyal Sayısı: ${data.count} | Win: ${data.win} | Loss: ${data.loss}\n`;
        outputStr += `- Win Rate: %${winRate} | Projected PnL: $${profit.toFixed(2)}\n\n`;
    }
    
    const overallWinRate = totalWins+totalLosses > 0 ? ((totalWins / (totalWins+totalLosses))*100).toFixed(2) : 0;
    outputStr += `───────────────────────────────────────\n`;
    outputStr += `FINAL NET KAR/ZARAR: $${expectedPnL.toFixed(2)}\n`;
    outputStr += `FON KASASI DEĞİŞİMİ: 500$ -> $${(initialCapital + expectedPnL).toFixed(2)}\n`;
    outputStr += `GENEL WIN RATE: %${overallWinRate}\n`;
    outputStr += `───────────────────────────────────────\n`;
    console.log(outputStr);

}

run();
