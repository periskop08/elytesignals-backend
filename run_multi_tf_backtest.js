const axios = require('axios');
const { ATR } = require('technicalindicators');

async function fetchBingxCandles(symbol, interval, limit) {
    try {
        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
        let list = res.data.data;
        list.sort((a,b) => a.time - b.time);
        return list.map(k => ({
            open: parseFloat(k.open), high: parseFloat(k.high), low: parseFloat(k.low), close: parseFloat(k.close), volume: parseFloat(k.volume), date: parseInt(k.time)
        }));
    } catch(e) { return null; }
}

async function getTopPairsBingX(limit) {
    try {
        let res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        let list = res.data.data;
        // Orijinal Guvenli Baraj (Top Kalite 3 Milyon USD Hacim)
        let usdtPairs = list.filter(item => item.symbol.endsWith('-USDT') && parseFloat(item.quoteVolume) > 3000000);
        usdtPairs.sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        return usdtPairs.slice(0, limit).map(i => ({ symbol: i.symbol, quoteVolume: parseFloat(i.quoteVolume) }));
    } catch (e) {
        return [{symbol: 'BTC-USDT', quoteVolume: 20000000}]; 
    }
}

async function backtest(pairData, intervalConfig) {
    const symbol = pairData.symbol;
    const pairVol = pairData.quoteVolume;
    let candles = await fetchBingxCandles(symbol, intervalConfig.interval, intervalConfig.limit);
    if (!candles || candles.length < 200) return null;
    
    let simTrades = [];
    
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
        
        let dipDeviation = false; let tepeDeviation = false;
        if (recentMin <= rangeLow * 1.005 && currentPrice > rangeLow && currentPrice > highs[lows.lastIndexOf(recentMin)]) dipDeviation = true;
        if (recentMax >= rangeHigh * 0.995 && currentPrice < rangeHigh && currentPrice < lows[highs.lastIndexOf(recentMax)]) tepeDeviation = true;
        
        if (!dipDeviation && !tepeDeviation) continue;
        
        const direction = dipDeviation ? 'LONG' : 'SHORT';
        let qualityScore = 0;
        
        // ORIJINAL SISTEM BARAJLARI VE PUANLAMASI (Sıfır Dış Etken - BİREBİR)
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

        // VOLUME
        let shortTermVolAvg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        if (volumes[volumes.length-1] > shortTermVolAvg * 1.5) qualityScore += 15;

        const { IchimokuCloud } = require('technicalindicators');
        const ichi = IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 });
        if (ichi.length > 0) {
            const ic = ichi[ichi.length-1];
            if (direction==='LONG' && currentPrice > ic.spanA && currentPrice > ic.spanB) qualityScore += 10;
            if (direction==='SHORT' && currentPrice < ic.spanA && currentPrice < ic.spanB) qualityScore += 10;
        }

        // BARAJ GUNCELLEMESI -> Orijinal uretim bazi 55-60.
        let minScore = direction === 'LONG' ? 55 : 60;
        if (qualityScore < minScore) continue;

        let dynamicStop = direction === 'LONG' ? currentPrice - (currentATR * 1.5) : currentPrice + (currentATR * 1.5);
        let riskDist = Math.abs(currentPrice - dynamicStop);
        let targetDist = riskDist * 1.5; // ESKI KAR EDEN HEDEF KALIYOR.
        let targetPrice = direction === 'LONG' ? currentPrice + targetDist : currentPrice - targetDist;

        let riskPct = (riskDist / currentPrice) * 100;
        // Borsa Hacim Filtresi Orijinal.
        if (direction === 'LONG' && pairVol < 10000000) continue;
        if (direction === 'SHORT' && pairVol < 3000000) continue;
        if (riskPct > 3.5) continue; 

        let outcome = 'PENDING';
        for (let f = i; f < candles.length; f++) {
            if (direction === 'LONG') {
                if (candles[f].low <= dynamicStop) outcome = 'LOSS';
                else if (candles[f].high >= targetPrice) outcome = 'WIN';
            } else {
                if (candles[f].high >= dynamicStop) outcome = 'LOSS';
                else if (candles[f].low <= targetPrice) outcome = 'WIN';
            }
            if (outcome !== 'PENDING') break;
        }

        simTrades.push({ outcome, direction, riskPct, qualityScore });
        i += 6;
    }
    
    return { symbol, simTrades };
}

async function runInterval(pairs, intervalConfig) {
    let stats = { trades: 0, win: 0, loss: 0 };
    let netPNL = 0;
    const FEE_RATE = 0.002;

    const batchSize = 10;
    for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);
        const promises = batch.map(p => backtest(p, intervalConfig));
        const results = await Promise.all(promises);
        
        results.forEach(res => {
            if (!res || !res.simTrades) return;
            res.simTrades.forEach(t => { 
                let posSizeUSD = 10 / (t.riskPct / 100);
                let feeUSD = posSizeUSD * FEE_RATE;
                
                let netWinAmount = 15.0 - feeUSD; 
                let netLossAmount = 10.0 + feeUSD;

                if (t.outcome === 'WIN') { 
                    stats.win++; 
                    netPNL += netWinAmount;
                } else if (t.outcome === 'LOSS') { 
                    stats.loss++; 
                    netPNL -= netLossAmount;
                } 
            });
            stats.trades += res.simTrades.length;
        });
        await new Promise(r => setTimeout(r, 600)); 
    }
    
    return {
        interval: intervalConfig.interval,
        totalDays: intervalConfig.days,
        trades: stats.trades,
        win: stats.win,
        loss: stats.loss,
        tradesPerDay: stats.trades / intervalConfig.days,
        netPNLPerDay: netPNL / intervalConfig.days,
        winRate: stats.trades > 0 ? (stats.win / stats.trades * 100) : 0
    };
}

async function run() {
    process.stdout.write("Orijinal Algoritma + Multi-Timeframe Taraması Basliyor...\n");
    const pairs = await getTopPairsBingX(50); // İlk 50 Kaliteli Coin
    
    const intervalsToTest = [
        { interval: '1h', limit: 720, days: 30 },
        { interval: '30m', limit: 1000, days: 20 },
        { interval: '15m', limit: 1000, days: 10 }
    ];
    
    let combinedStats = [];
    for (const cfg of intervalsToTest) {
        process.stdout.write(`${cfg.interval} Zaman Dilimi analiz ediliyor (${cfg.days} Gunluk Veri)...\n`);
        let res = await runInterval(pairs, cfg);
        combinedStats.push(res);
    }
    
    let totalTradesPerDay = 0;
    let totalPnlPerDay = 0;
    let totalWin = 0;
    let totalTrades = 0;
    
    combinedStats.forEach(r => {
        totalTradesPerDay += r.tradesPerDay;
        totalPnlPerDay += r.netPNLPerDay;
        totalWin += r.win;
        totalTrades += r.trades;
    });
    
    let projectedMonthlyTrades = Math.round(totalTradesPerDay * 30);
    let projectedMonthlyPNL = totalPnlPerDay * 30;
    let totalWR = (totalWin / totalTrades) * 100;
    
    const output = {
        Cerceve: "Mult-Timeframe Fon Mimarisi (Top 50 Kaliteli Coin)",
        STRATEJI_GOZLEMI: "Orijinal barajlar (55-60 puan) korundu. Ayni coinlerin farkli zaman grafiklerinde ayri ayri islem firsati kovalandi.",
        ZAMAN_DILIMI_PERFORMANSLARI: combinedStats.map(c => `${c.interval} => Gunluk Ortalama Sinyal: ${c.tradesPerDay.toFixed(1)} | WinRate: %${c.winRate.toFixed(1)} | Gunluk Getiri: $${c.netPNLPerDay.toFixed(2)}`),
        AYLIK_PROJEKSIYON_SONUCLARI: {
            "Hedeflenen Gunluk Hacim (Sinyal Sayisi)": `${totalTradesPerDay.toFixed(1)} Sinyal/Gün`,
            "Aylik Ort. Sinyal Beklentisi": projectedMonthlyTrades,
            "Genel Kazanma Orani (Win Rate)": `%${totalWR.toFixed(1)}`,
            "Aylik Beklenen NET Kâr Büyümesi (PNL)": `${projectedMonthlyPNL > 0 ? '+' : ''}$${projectedMonthlyPNL.toFixed(2)}`
        }
    };
    
    console.log("\n=== ORİJİNAL ALGORİTMA x ÇOKLU ZAMAN DİLİMİ KANITI ===");
    console.log(JSON.stringify(output, null, 2));
}

run();
