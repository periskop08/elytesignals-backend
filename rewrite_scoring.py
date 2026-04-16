import os

with open('scanner.js', 'r') as f:
    content = f.read()

start_marker = "// --- SKORLAMA (SCORING) ALTYAPISI ---"
end_marker = "// 6. RISK / REWARD (R:R) HESAPLAMASI & 1:3 CAP"

new_code = """// --- SKORLAMA (SCORING) ALTYAPISI (ZODYAK V2.9.0) ---
        let qualityScore = 0;
        let warnings = [];
        let breakdown = { ob: false, fvg: false, rvol: 0, adx: 0, rr: 0, trend4h: "neutral", globalVol: globalVol };

        // 1. ZEMIN / BÖLGE SLOTU (Max +40)
        const trapObZone = direction === 'LONG' ? [rangeLow - (avgATR * 1.5), rangeLow + (avgATR * 1.5)] : [rangeHigh - (avgATR * 1.5), rangeHigh + (avgATR * 1.5)];
        const trapObCandlesStart = closes.length - CONFIG.obLookback - 6;
        let hasOB = false;
        for (let i = trapObCandlesStart; i <= closes.length - 6; i++) {
            if (i < 0) continue;
            if (direction === 'LONG' && closes[i] < opens[i] && closes[i] <= trapObZone[1] && closes[i] >= trapObZone[0]) {
                if (highs[i+1] > highs[i]) { hasOB = true; break; }
            } else if (direction === 'SHORT' && closes[i] > opens[i] && closes[i] >= trapObZone[0] && closes[i] <= trapObZone[1]) {
                if (lows[i+1] < lows[i]) { hasOB = true; break; }
            }
        }
        if (hasOB) {
            qualityScore += 25;
            warnings.push("Zemin: Order Block Desteği (+25)");
            breakdown.ob = true;
        }

        let hasFVG = false;
        const lastIdx = closes.length - 1;
        for (let i = lastIdx - 2; i <= lastIdx; i++) {
            if (i >= 2) {
                if (direction === 'LONG' && highs[i-2] < lows[i]) hasFVG = true; 
                if (direction === 'SHORT' && lows[i-2] > highs[i]) hasFVG = true; 
            }
        }
        if (hasFVG) {
            qualityScore += 15;
            warnings.push("Zemin: FVG Boşluğu (+15)");
            breakdown.fvg = true;
        }

        // 2. TETİKLEME / KURŞUN SLOTU (Max +20 Puan Sınırı)
        let triggerScore = 0;
        let isKillerWick = false;
        let isEngulfing = false;

        if (direction === 'LONG' && dipDeviation && trapWickSize > avgATR * 1.2) isKillerWick = true;
        if (direction === 'SHORT' && peakDeviation && trapWickSize > avgATR * 1.2) isKillerWick = true;
        if (isKillerWick) { triggerScore = Math.max(triggerScore, 20); warnings.push("Tetik: Katil Fitil (+20)"); }

        const currentOpen = opens[opens.length - 1];
        const currentClose = closes[closes.length - 1];
        const prevOpen = opens[opens.length - 2];
        const prevClose = closes[closes.length - 2];
        if (direction === 'LONG' && currentClose > currentOpen && prevClose < prevOpen && currentClose > prevOpen && currentOpen < prevClose) isEngulfing = true;
        if (direction === 'SHORT' && currentClose < currentOpen && prevClose > prevOpen && currentClose < prevOpen && currentOpen > prevClose) isEngulfing = true;
        if (isEngulfing) { triggerScore = Math.max(triggerScore, 20); warnings.push("Tetik: Yutan Mum (Engulfing) (+20)"); }

        qualityScore += triggerScore;

        // 3. TUZAK / CONTEXT SLOTU
        let isSweep = false;
        const sweepLookback = Math.max(0, closes.length - 11);
        if (direction === 'LONG') {
            const minLow = Math.min(...lows.slice(sweepLookback, closes.length - 1));
            if (currentLow < minLow && currentClose > minLow) isSweep = true;
        } else {
            const maxHigh = Math.max(...highs.slice(sweepLookback, closes.length - 1));
            if (currentHigh > maxHigh && currentClose < maxHigh) isSweep = true;
        }
        if (isSweep) { qualityScore += 15; warnings.push("Tuzak: Likidite Süpürmesi (Sweep) (+15)"); }

        const currentVol = volumes[volumes.length - 1];
        const vol20 = volumes.slice(-21, -1);
        const avgVol = vol20.reduce((a, b) => a + b, 0) / 20;
        if ((direction === 'LONG' && currentClose < currentOpen && currentVol < avgVol * 0.5) || 
            (direction === 'SHORT' && currentClose > currentOpen && currentVol < avgVol * 0.5)) {
            qualityScore += 12; warnings.push("Tuzak: Volume Shelter (Hacim Kuruması) (+12)");
        }

        // 4. MAKRO / TREND SLOTU
        if (!symbolInfo.isAsset) {
            const btc1d = globalMarketState.btc1dObj;
            if (btc1d) {
                if (direction === 'LONG') {
                    if (btc1d.trend === 'BULL' || btc1d.trend === 'STRONG_BULL') { qualityScore += 15; warnings.push("Makro: BTC Uyumlu Trend (+15)"); }
                    else if (btc1d.trend === 'BEAR' || btc1d.trend === 'STRONG_BEAR') { qualityScore -= 15; warnings.push("Makro: BTC Zıt Yön Ceza (-15)"); }
                } else {
                    if (btc1d.trend === 'BEAR' || btc1d.trend === 'STRONG_BEAR') { qualityScore += 15; warnings.push("Makro: BTC Uyumlu Trend (+15)"); }
                    else if (btc1d.trend === 'BULL' || btc1d.trend === 'STRONG_BULL') { qualityScore -= 15; warnings.push("Makro: BTC Zıt Yön Ceza (-15)"); }
                }
            }
        }

        let trend4h = "neutral";
        try {
            const klines4h = await fetchCandles(symbolInfo, 240, 50);
            if (klines4h && klines4h.length >= 50) {
                const closes4h = klines4h.map(k => k.close);
                const sma4h = SMA.calculate({ values: closes4h, period: 50 });
                const currentPrice4H = closes4h[closes4h.length - 1];
                const sma50_4H = sma4h[sma4h.length - 1];
                if (currentPrice4H > sma50_4H) trend4h = "bullish";
                else if (currentPrice4H < sma50_4H) trend4h = "bearish";
                
                if (direction === 'LONG' && trend4h === 'bullish') { qualityScore += 15; warnings.push("Makro: 4H Zaman Dilimi Uyumu (+15)"); }
                else if (direction === 'LONG' && trend4h === 'bearish') { qualityScore -= 5; warnings.push("Makro: 4H Zaman Dilimi Çatışması (-5)"); }
                else if (direction === 'SHORT' && trend4h === 'bearish') { qualityScore += 15; warnings.push("Makro: 4H Zaman Dilimi Uyumu (+15)"); }
                else if (direction === 'SHORT' && trend4h === 'bullish') { qualityScore -= 5; warnings.push("Makro: 4H Zaman Dilimi Çatışması (-5)"); }
            }
        } catch(e) {}

        const adxResult = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
        const currentADX = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 0;
        if (currentADX >= 25) { qualityScore += 10; warnings.push("Makro: Sağlıklı ADX İvmesi (+10)"); }
        else if (currentADX < 20) { qualityScore -= 10; warnings.push("Makro: ADX Testere (Ranging) Ceza (-10)"); }

        // 5. İNDİKATÖR MANTIĞI & CEZA HUKUKU
        const ichiRes = IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 });
        if (ichiRes && ichiRes.length > 0) {
            const currentIchi = ichiRes[ichiRes.length - 1];
            if (direction === 'LONG' && currentPrice > currentIchi.spanA && currentPrice > currentIchi.spanB && currentIchi.conversion > currentIchi.base) {
                qualityScore += 15; warnings.push("İndikatör: Ichimoku Bull Onayı (+15)");
            } else if (direction === 'SHORT' && currentPrice < currentIchi.spanA && currentPrice < currentIchi.spanB && currentIchi.conversion < currentIchi.base) {
                qualityScore += 15; warnings.push("İndikatör: Ichimoku Bear Onayı (+15)");
            }
        }

        const stochRSIRes = StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });
        if (stochRSIRes && stochRSIRes.length > 0) {
            const lastStoch = stochRSIRes[stochRSIRes.length - 1];
            if (direction === 'LONG') {
                if (lastStoch.k > 80) { qualityScore -= 10; warnings.push("İndikatör: StochRSI Aşırı Alım FOMO Cezası (-10)"); }
                else if (lastStoch.k < 20) { qualityScore += 5; warnings.push("İndikatör: StochRSI Dip Kalkışı Teşvik (+5)"); }
            } else if (direction === 'SHORT') {
                if (lastStoch.k < 20) { qualityScore -= 10; warnings.push("İndikatör: StochRSI Aşırı Satım FOMO Cezası (-10)"); }
                else if (lastStoch.k > 80) { qualityScore += 5; warnings.push("İndikatör: StochRSI Zirve Dönüşü Teşvik (+5)"); }
            }
        }

        try {
            const dailyKlines = await fetchCandles(symbolInfo, 1440, 200);
            if (dailyKlines && dailyKlines.length >= 200) {
                const dailyCloses = dailyKlines.map(k => k.close);
                const sma50_1dArr = SMA.calculate({ period: 50, values: dailyCloses });
                const sma200_1dArr = SMA.calculate({ period: 200, values: dailyCloses });
                if (sma50_1dArr.length > 0 && sma200_1dArr.length > 0) {
                    const sma50_1d = sma50_1dArr[sma50_1dArr.length - 1];
                    const sma200_1d = sma200_1dArr[sma200_1dArr.length - 1];
                    if (direction === 'LONG' && sma50_1d > sma200_1d && currentPrice > sma200_1d) { qualityScore += 10; warnings.push("İndikatör: 1D Golden Cross (+10)"); }
                    else if (direction === 'SHORT' && sma50_1d < sma200_1d && currentPrice < sma200_1d) { qualityScore += 10; warnings.push("İndikatör: 1D Bear Cross (+10)"); }
                }
            }
        } catch(e) {}

        // 7. ORDER FLOW BÖLÜMÜ (MİKRO-ANATOMİ)
        const currentHigh = highs[highs.length - 1];
        const currentLow = lows[lows.length - 1];
        if (currentHigh > currentLow && currentVol > 0) {
            const buyVol = currentVol * ((currentClose - currentLow) / (currentHigh - currentLow));
            const sellVol = currentVol * ((currentHigh - currentClose) / (currentHigh - currentLow));
            const buyRatio = buyVol / (currentVol || 1);
            const sellRatio = sellVol / (currentVol || 1);

            if (direction === 'LONG') {
                if (buyRatio > 0.60) { qualityScore += 15; warnings.push("Order Flow: Aggressive Bull (+15)"); }
                else if (sellRatio > 0.60) { qualityScore -= 15; warnings.push("Order Flow: Aggressive Bear Reject Cezası (-15)"); }
            } else if (direction === 'SHORT') {
                if (sellRatio > 0.60) { qualityScore += 15; warnings.push("Order Flow: Aggressive Bear (+15)"); }
                else if (buyRatio > 0.60) { qualityScore -= 15; warnings.push("Order Flow: Aggressive Bull Reject Cezası (-15)"); }
            }
        }

        // 8. FİNANSAL ÇEŞİTLİLİK (PORTFÖY YIĞILMA CEZASI)
        try {
            const activeTrades = await db.all("SELECT type FROM user_trades WHERE status = 'ACTIVE'");
            let sameDirCount = 0;
            for(let t of activeTrades) {
                if (t.type === direction) sameDirCount++;
            }
            if (sameDirCount >= 2) {
                qualityScore -= 12;
                warnings.push(`Portföy: Aynı Yönde ${sameDirCount} İşlem Yığılma Cezası (-12)`);
            }
        } catch(e) {}

        if (qualityScore < 70) {
            return null; // ZODYAK BARAJI AŞILAMADI
        }

        """

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx != -1 and end_idx != -1:
    content = content[:start_idx] + new_code + content[end_idx:]
    with open('scanner.js', 'w') as f:
        f.write(content)
    print("Scoring replaced successfully.")
else:
    print("Markers not found.")
