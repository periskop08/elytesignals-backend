const axios = require('axios');
const cron = require('node-cron');
const db = require('./database');
const { ATR, SMA } = require('technicalindicators');
const { analyzeElliottWaves } = require('./elliott');

async function getUsdtPairs() {
    try {
        const response = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
        const symbols = response.data.symbols;
        // Gürültü yaratan stabil coin'leri ve fiat'ları listeye alma
        const stableCoins = ['USDCUSDT', 'FDUSDUSDT', 'TUSDUSDT', 'BUSDUSDT', 'EURUSDT', 'USDPUSDT', 'DAIUSDT', 'USD1USDT', 'USDEUSDT', 'AEURUSDT', 'USTCUSDT', 'USDCEUSDT', 'PYUSDUSDT', 'USDCUSDT', 'USDTTRY', 'USDCUSDT'];

        const usdtPairs = symbols.filter(s => 
            s.quoteAsset === 'USDT' && 
            s.status === 'TRADING' && 
            s.isSpotTradingAllowed === true &&
            !stableCoins.includes(s.symbol)
        );
        return usdtPairs.map(s => s.symbol);
    } catch (error) {
        console.error('Binance ExchangeInfo Error:', error.message);
        return [];
    }
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Aktif sinyalleri kontrol et, duruma göre Win veya Loss yap
async function checkActiveSignals() {
    try {
        const activeSignals = await db.all("SELECT * FROM signals WHERE status = 'ACTIVE'");
        if(!activeSignals || activeSignals.length === 0) return;

        console.log(`[SCANNER] Checking ${activeSignals.length} active signals...`);

        // Batch fetch all prices at once
        const res = await axios.get('https://api.binance.com/api/v3/ticker/price');
        const priceMap = {};
        res.data.forEach(t => priceMap[t.symbol] = parseFloat(t.price));

        for (const signal of activeSignals) {
            try {
                 const currentPrice = priceMap[signal.symbol];
                 if (!currentPrice) continue;
                 
                 let newStatus = null;
                 let pnl = 0;
                 
                 if (signal.type === 'LONG') {
                     pnl = ((currentPrice - signal.entryPrice) / signal.entryPrice) * 100;
                     if (currentPrice >= signal.targetPrice) newStatus = 'WIN';
                     else if (currentPrice <= signal.stopPrice) newStatus = 'LOSS';
                 } else if (signal.type === 'SHORT') {
                     pnl = ((signal.entryPrice - currentPrice) / signal.entryPrice) * 100;
                     if (currentPrice <= signal.targetPrice) newStatus = 'WIN';
                     else if (currentPrice >= signal.stopPrice) newStatus = 'LOSS';
                 }
                 
                 // %2 kâr barajı kontrolü
                 if (pnl >= 2.0 && !signal.reachedTwoPercent) {
                     await db.run("UPDATE signals SET reachedTwoPercent = 1 WHERE id = ?", [signal.id]);
                 }

                 if (newStatus) {
                     await db.run("UPDATE signals SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [newStatus, signal.id]);
                     console.log(`[SCANNER] Signal ${signal.symbol} closed as ${newStatus}`);
                 }
            } catch(e) {
                // Ignore single coin error
            }
        }
    } catch (e) {
        console.error("Error checking active signals:", e);
    }
}

async function analyzeCoin(symbol) {
    try {
        // 1 Saatlik mum grafiklerini (1h) al, son 100 mum
        const response = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`);
        const klines = response.data;
        if(klines.length < 100) return; // Yeterli veri yok

        const closes = klines.map(kline => parseFloat(kline[4]));
        const highs = klines.map(k => parseFloat(k[2]));
        const lows = klines.map(k => parseFloat(k[3]));
        const volumes = klines.map(k => parseFloat(k[5]));
        
        const currentPrice = closes[closes.length - 1];

        const rangeHigh = Math.max(...highs);
        const rangeLow = Math.min(...lows);
        const eq = (rangeHigh + rangeLow) / 2;

        const recentLows = lows.slice(-6); // Son 6 mum (6 saat)
        const recentHighs = highs.slice(-6);

        const dipDeviation = recentLows.some(l => l <= rangeLow * 1.01) && currentPrice > rangeLow;
        const tepeDeviation = recentHighs.some(h => h >= rangeHigh * 0.99) && currentPrice < rangeHigh;

        // --- AVWAP HESAPLAMASI ---
        let cumulativeTPVol = 0;
        let cumulativeVol = 0;
        for (let i = 0; i < klines.length; i++) {
            const h = parseFloat(klines[i][2]);
            const l = parseFloat(klines[i][3]);
            const c = parseFloat(klines[i][4]);
            const v = parseFloat(klines[i][5]);
            const tp = (h + l + c) / 3;
            cumulativeTPVol += tp * v;
            cumulativeVol += v;
        }
        const avwap = cumulativeTPVol / cumulativeVol;

        // --- FRVP (POC) HESAPLAMASI (20 Bins) ---
        const binCount = 20;
        const binSize = (rangeHigh - rangeLow) / binCount || 1;
        const profile = new Array(binCount).fill(0);
        
        for (let i = 0; i < klines.length; i++) {
            const h = parseFloat(klines[i][2]);
            const l = parseFloat(klines[i][3]);
            const v = parseFloat(klines[i][5]);
            const typicalCandlePrice = (h + l) / 2;
            let binIndex = Math.floor((typicalCandlePrice - rangeLow) / binSize);
            if (binIndex < 0) binIndex = 0;
            if (binIndex >= binCount) binIndex = binCount - 1;
            profile[binIndex] += v;
        }

        let maxVol = 0;
        let maxVolIndex = 0;
        for(let i = 0; i < binCount; i++) {
            if(profile[i] > maxVol) {
                maxVol = profile[i];
                maxVolIndex = i;
            }
        }
        const poc = rangeLow + (maxVolIndex * binSize) + (binSize / 2);

        // --- Hacim Filtresi (RVOL - Relative Volume) ---
        // Son 20 mumun ortalama hacmini bul (Güncel aktif mumu hariç tutarak daha stabil bir ortalama alırız)
        const vol20 = volumes.slice(-21, -1); 
        const avgVol = vol20.reduce((a, b) => a + b, 0) / 20;
        
        // Son 3 saatteki en yüksek hacmi bul (Kırılım/Sapma sırasında hacim patlaması gelmiş mi?)
        const recentVol = Math.max(...volumes.slice(-3));

        // Filtre tetiği: Eğer en yüksek yakın hacim, 20 saatlik ortalamanın 1.5 katından küçükse işlemi reddet!
        const isVolumeConfirmed = recentVol >= (avgVol * 1.5);

        // --- ELLIOTT WAVES ---
        const ewResult = analyzeElliottWaves(klines, symbol);
        if (ewResult && ewResult.status && ewResult.status.includes('Valid')) {
            console.log(`[ELLIOTT] ${symbol} için destekleyici Elliott Dalga modeli bulundu: ${ewResult.status}`);
        }

        // Volatilite (dalgalanma) veya kâr marjı kontrolü
        if (dipDeviation && isVolumeConfirmed) {
            // 1. KATI AVWAP FİLTRESİ
            if (currentPrice < avwap) {
                console.log(`[AVWAP-FILTER] ${symbol} LONG reddedildi. Fiyat (${currentPrice}) AVWAP'ın (${avwap.toFixed(4)}) altında.`);
                return null;
            }

            let targetP = eq;
            if (poc > eq && poc > currentPrice) targetP = poc;
            
            const potentialProfit = ((targetP - currentPrice) / currentPrice) * 100;
            if (potentialProfit < 2.5) return null; // Yetersiz kâr marjı

            // 2. MTF (4H) ONAYI
            try {
                const res4h = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=50`);
                const closes4h = res4h.data.map(k => parseFloat(k[4]));
                const sma4h = SMA.calculate({values: closes4h, period: 50});
                const currentSMA4h = sma4h[sma4h.length - 1];
                const currentPrice4h = closes4h[closes4h.length - 1];
                if (currentPrice4h < currentSMA4h) {
                    console.log(`[MTF-FILTER] ${symbol} LONG reddedildi. 4H Trend (${currentPrice4h}) MA50 (${currentSMA4h.toFixed(4)}) altında eziliyor.`);
                    return null;
                }
            } catch(e) {
                return null;
            }

            // 3. ATR DİNAMİK STOP
            const atrRes = ATR.calculate({high: highs, low: lows, close: closes, period: 14});
            const currentATR = atrRes[atrRes.length - 1] || (currentPrice * 0.015);
            const dynamicStop = currentPrice - (currentATR * 1.5);

            return {
                symbol,
                type: 'LONG',
                entryPrice: currentPrice,
                targetPrice: targetP,
                stopPrice: dynamicStop
            };
        } else if (tepeDeviation && isVolumeConfirmed) {
            // 1. KATI AVWAP FİLTRESİ
            if (currentPrice > avwap) {
                console.log(`[AVWAP-FILTER] ${symbol} SHORT reddedildi. Fiyat (${currentPrice}) AVWAP'ın (${avwap.toFixed(4)}) üzerinde.`);
                return null;
            }

            let targetP = eq;
            if (poc < eq && poc < currentPrice) targetP = poc;

            const potentialProfit = ((currentPrice - targetP) / currentPrice) * 100;
            if (potentialProfit < 2.5) return null; // Yetersiz kâr marjı

            // 2. MTF (4H) ONAYI
            try {
                const res4h = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=50`);
                const closes4h = res4h.data.map(k => parseFloat(k[4]));
                const sma4h = SMA.calculate({values: closes4h, period: 50});
                const currentSMA4h = sma4h[sma4h.length - 1];
                const currentPrice4h = closes4h[closes4h.length - 1];
                if (currentPrice4h > currentSMA4h) {
                    console.log(`[MTF-FILTER] ${symbol} SHORT reddedildi. 4H Trend (${currentPrice4h}) MA50 (${currentSMA4h.toFixed(4)}) üzerinde pozitif.`);
                    return null;
                }
            } catch(e) {
                return null;
            }

            // 3. ATR DİNAMİK STOP
            const atrRes = ATR.calculate({high: highs, low: lows, close: closes, period: 14});
            const currentATR = atrRes[atrRes.length - 1] || (currentPrice * 0.015);
            const dynamicStop = currentPrice + (currentATR * 1.5);

            return {
                symbol,
                type: 'SHORT',
                entryPrice: currentPrice,
                targetPrice: targetP,
                stopPrice: dynamicStop
            };
        } else if ((dipDeviation || tepeDeviation) && !isVolumeConfirmed) {
            // Fiyat şartları sağlamış ama hacim onay vermemiş (Fakeout)
            console.log(`[VOL-FILTER] ${symbol} reddedildi. Sahte Kırılım (RVOL Yetersiz). Hedef Hacim: ${(avgVol*1.5).toFixed(2)}, Mevcut: ${recentVol.toFixed(2)}`);
        }
    } catch(e) {
        // Ignore single coin errors
    }
    return null;
}

async function runScan() {
    console.log('[SCANNER] Starting Binance pairs scan for new signals...');

    // 2. Yeni pariteleri tara
    const pairs = await getUsdtPairs();
    console.log(`[SCANNER] Found ${pairs.length} USDT pairs to scan.`);

    let signalCount = 0;
    
    for (let i = 0; i < pairs.length; i++) {
        const symbol = pairs[i];
        
        // Aktif sinyali olan coini tekrar tarayıp yeni sinyal üretmeye gerek yok (Spam önleme)
        const existingActive = await db.get("SELECT id FROM signals WHERE symbol = ? AND status = 'ACTIVE'", [symbol]);
        if (existingActive) continue;

        const signal = await analyzeCoin(symbol);
        if (signal) {
            await db.run(
                "INSERT INTO signals (symbol, type, entryPrice, targetPrice, stopPrice) VALUES (?, ?, ?, ?, ?)",
                [signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice]
            );
            console.log(`[SCANNER] New ${signal.type} signal for ${signal.symbol}!`);
            signalCount++;
        }
        
        // Rate limit'i aşmamak için her istek arası 100ms bekle (1 saniyede 10 istek, limite çok uzak)
        await delay(100); 
    }

    console.log(`[SCANNER] Scan complete. Found ${signalCount} new signals.`);
}

function startScanner() {
    // 1. Aktif pozisyonların Stop/TP durumlarını HER DAKİKA kontrol et
    cron.schedule('* * * * *', () => {
        checkActiveSignals();
    });

    // 2. Yeni sinyal yakalama algoritmasını 15 DAKİKADA BİR çalıştır
    cron.schedule('*/15 * * * *', () => {
        runScan();
    });
    
    // Uygulama ilk açıldığında da 1 kez çalışsın
    // Çakışmayı ve birden fazla instancesi engellemek için timeout
    setTimeout(() => {
        checkActiveSignals();
        runScan();
    }, 2000);
}

module.exports = {
    startScanner
};
