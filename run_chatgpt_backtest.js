const axios = require('axios');
const { ATR } = require('technicalindicators');

async function fetchBingxCandles(symbol, limit) {
    try {
        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${symbol}&interval=1h&limit=${limit}`);
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
        // Top Kalite 3 Milyon USD Hacim Barajı Korunuyor
        let usdtPairs = list.filter(item => item.symbol.endsWith('-USDT') && parseFloat(item.quoteVolume) > 3000000);
        usdtPairs.sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        return usdtPairs.slice(0, limit).map(i => ({ symbol: i.symbol, quoteVolume: parseFloat(i.quoteVolume) }));
    } catch (e) {
        return [{symbol: 'BTC-USDT', quoteVolume: 20000000}]; 
    }
}

async function backtest(pairData) {
    const symbol = pairData.symbol;
    const pairVol = pairData.quoteVolume;
    let candles = await fetchBingxCandles(symbol, 750); // 1 Aylık 1H
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
        const j = closes.length - 1; // Current index in window
        
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
        let reasons = [];
        
        // --- 1. Orijinal Kurallar (Temel PA) ---
        let hasFVG = false;
        for (let k = closes.length - 3; k <= closes.length - 1; k++) {
            if (k >= 2) {
                if (direction === 'LONG' && highs[k-2] < lows[k]) hasFVG = true; 
                if (direction === 'SHORT' && lows[k-2] > highs[k]) hasFVG = true; 
            }
        }
        if (hasFVG) { qualityScore += 15; reasons.push("FVG"); }
        
        const obZone = direction === 'LONG' ? [rangeLow - (currentATR * 1.5), rangeLow + (currentATR * 1.5)] : [rangeHigh - (currentATR * 1.5), rangeHigh + (currentATR * 1.5)];
        let hasOB = false;
        for (let k = closes.length - 36; k <= closes.length - 6; k++) {
            if (direction === 'LONG' && closes[k] < opens[k] && closes[k] <= obZone[1] && closes[k] >= obZone[0] && highs[k+1] > highs[k]) { hasOB = true; break; }
            if (direction === 'SHORT' && closes[k] > opens[k] && closes[k] >= obZone[0] && closes[k] <= obZone[1] && lows[k+1] < lows[k]) { hasOB = true; break; }
        }
        if (hasOB) { qualityScore += 25; reasons.push("OrderBlock"); }

        // --- 2. Perplexity Kuralları + CHATGPT YENİLİKLERİ (Kategori Modeli) ---
        let hasKillerWick = false;
        let candleSizeBase = highs[j] - lows[j] || 1;
        if (direction === 'LONG') {
            let wickRatio = (Math.min(opens[j], closes[j]) - lows[j]) / candleSizeBase;
            if (wickRatio > 0.40 && closes[j] > ((highs[j] + lows[j])/2)) hasKillerWick = true;
        } else {
            let wickRatio = (highs[j] - Math.max(opens[j], closes[j])) / candleSizeBase;
            if (wickRatio > 0.40 && closes[j] < ((highs[j] + lows[j])/2)) hasKillerWick = true;
        }
        
        let hasEngulfing = false;
        let pOpen = opens[j-1]; let pClose = closes[j-1];
        let cOpen = opens[j]; let cClose = closes[j];
        if (direction === 'LONG') {
            if (pClose < pOpen && cClose > cOpen && cClose >= pOpen && cOpen <= pClose) hasEngulfing = true;
        } else {
            if (pClose > pOpen && cClose < cOpen && cClose <= pOpen && cOpen >= pClose) hasEngulfing = true;
        }
        
        // Tetik Slotu Kararı (İkisi de 20 puandır, toplanmaz)
        if (hasKillerWick || hasEngulfing) { 
            qualityScore += 20; 
            reasons.push(hasKillerWick ? "KillerWick" : "Engulfing"); 
        }
        
        // B) Likidite Temizliği (Liquidity Sweep) -> +15 Puan
        let hasSweep = false;
        const past10Lows = lows.slice(j-10, j);
        const past10Highs = highs.slice(j-10, j);
        let min10Low = Math.min(...past10Lows);
        let max10High = Math.max(...past10Highs);
        
        if (direction === 'LONG') {
            if (lows[j] < min10Low && closes[j] > opens[j] && closes[j] > ((highs[j]+lows[j])/2)) hasSweep = true;
        } else {
            if (highs[j] > max10High && closes[j] < opens[j] && closes[j] < ((highs[j]+lows[j])/2)) hasSweep = true;
        }
        if (hasSweep) { qualityScore += 15; reasons.push("LiqSweep"); }

        // C) Volume Shelter -> +12 Puan
        let shortTermVolAvg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        let lastVol = volumes[j];
        if (direction === 'LONG' && lastVol < shortTermVolAvg * 0.9 && closes[j] < opens[j]) {
            qualityScore += 12; reasons.push("VolShelter");
        } else if (direction === 'SHORT' && lastVol < shortTermVolAvg * 0.9 && closes[j] > opens[j]) {
            qualityScore += 12; reasons.push("VolShelter");
        }

        // BARAJ GÜNCELLEMESİ YAPMIYORUZ: Tümü diziye eklenecek, sonra baraj baraj ayrılacak.
        let dynamicStop = direction === 'LONG' ? currentPrice - (currentATR * 1.5) : currentPrice + (currentATR * 1.5);
        let riskDist = Math.abs(currentPrice - dynamicStop);
        let targetDist = riskDist * 1.5; // Orijinal 1:1.5 RR modeli
        let targetPrice = direction === 'LONG' ? currentPrice + targetDist : currentPrice - targetDist;

        let riskPct = (riskDist / currentPrice) * 100;
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

        simTrades.push({ outcome, direction, riskPct, qualityScore, reasons });
        if (qualityScore >= 50 && outcome !== 'PENDING') {
            i += 6; // Sadece mantıklı bir sinyal ürettiyse 6 saat bekle
        }
    }
    
    return { symbol, simTrades };
}

async function run() {
    process.stdout.write("Hedge Fon Algoritması: Kapsamlı Threshold Raporu Çıkarılıyor...\n");
    const pairs = await getTopPairsBingX(50); // İlk 50 Kaliteli Coin
    
    let initialBalance = 500;
    const FEE_RATE = 0.002;
    const leverage = 20;

    let allResults = [];
    const batchSize = 10;
    for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);
        const promises = batch.map(p => backtest(p));
        const results = await Promise.all(promises);
        
        results.forEach(res => {
            if (!res || !res.simTrades) return;
            allResults.push(res);
        });
        await new Promise(r => setTimeout(r, 600)); 
    }
    
    let thresholds = [50, 55, 60, 65, 70, 75, 80, 85, 90];
    let breakdown = [];
    
    thresholds.forEach(thresh => {
        let t_stats = { trades: 0, win: 0, loss: 0, netPNL: 0 };
        allResults.forEach(res => {
            res.simTrades.forEach(t => {
                if (t.qualityScore >= thresh && t.outcome !== 'PENDING') {
                    let posSizeUSD = 10 / (t.riskPct / 100);
                    let feeUSD = posSizeUSD * FEE_RATE;
                    let netWinAmount = 15.0 - feeUSD; 
                    let netLossAmount = 10.0 + feeUSD;

                    if (t.outcome === 'WIN') { 
                        t_stats.win++; 
                        t_stats.netPNL += netWinAmount;
                    } else if (t.outcome === 'LOSS') { 
                        t_stats.loss++; 
                        t_stats.netPNL -= netLossAmount;
                    } 
                    t_stats.trades++;
                }
            });
        });
        
        let wr = t_stats.trades > 0 ? ((t_stats.win / t_stats.trades) * 100).toFixed(1) : 0;
        breakdown.push({
            "Baraj Puanı": thresh,
            "1 Aylık Sinyal Adedi": t_stats.trades,
            "Günlük Ortalama Sinyal": (t_stats.trades / 30).toFixed(1),
            "Başarılı (WIN)": t_stats.win,
            "Başarısız (LOSS)": t_stats.loss,
            "Kazanma Oranı (WR)": `%${wr}`,
            "Aylık Net Kâr/Zarar": `$${t_stats.netPNL.toFixed(2)}`
        });
    });
    
    const output = {
        ANALİZ_TİPİ: "Puan Skala Matrisi (Tüm Barajlar)",
        RAPOR_DETAYI: breakdown
    };
    
    console.log("\n=== PUAN BARAJI İZLEME RAPORU ===");
    console.log(JSON.stringify(output, null, 2));
}

run();
