const axios = require('axios');
const cron = require('node-cron');
const db = require('./database');
const { ATR, SMA, ADX, EMA, IchimokuCloud, StochasticRSI } = require('technicalindicators');
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const { appendToSheet } = require('./google-api');
const { placeOrder, getPosition, updateStopLoss } = require('./bingx-trade');
const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass();
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: "gemini-3.1-pro" });

// Otopilot İçin Canlı Tercüman Haritası
global.BINGX_SYMBOL_MAP = {};

const ASSET_MAPPING = {
    // Commodities
    'NCCOGOLD': { fetchId: 'GC=F' },
    'NCCOXAG': { fetchId: 'SI=F' },
    'NCCO724OILBRENT': { fetchId: 'BZ=F' },
    'NCCO724OILWTI': { fetchId: 'CL=F' },
    'NCCOXPT': { fetchId: 'PL=F' },
    
    // Indices
    'NCSINASDAQ100': { fetchId: '^IXIC' },
    'NCSI724NASDAQ100': { fetchId: '^IXIC' },
    'NCSISP500': { fetchId: '^GSPC' },
    'NCSIDOWJONES': { fetchId: '^DJI' },
    'NCSIEWJ': { fetchId: 'EWJ' },
    'NCSIEWY': { fetchId: 'EWY' }
};

// KAMA kaldirildi (Perplexity optimizasyonu, Ichimoku ile cakistigi icin silindi)

// YENİ: Varlık Pariteleri İçin Opsiyon Gamma & Max Pain Tarayıcı
async function analyzeOptionsFlow(fetchId, currentPrice) {
    try {
        const YF = require('yahoo-finance2').default;
        const result = await YF.options(fetchId);
        if (!result || !result.options || result.options.length === 0) return null;

        const nearestChain = result.options[0];
        const calls = nearestChain.calls || [];
        const puts = nearestChain.puts || [];

        let totalCallOI = 0, totalPutOI = 0;
        let maxCallOI = 0, maxPutOI = 0;
        let callWallStrike = 0, putWallStrike = 0;
        let allStrikes = new Set();

        calls.forEach(c => {
            const oi = c.openInterest || 0;
            totalCallOI += oi;
            if (oi > maxCallOI) { maxCallOI = oi; callWallStrike = c.strike; }
            allStrikes.add(c.strike);
        });

        puts.forEach(p => {
            const oi = p.openInterest || 0;
            totalPutOI += oi;
            if (oi > maxPutOI) { maxPutOI = oi; putWallStrike = p.strike; }
            allStrikes.add(p.strike);
        });

        const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 1;

        let minPainValue = Infinity;
        let maxPainStrike = 0;
        const strikeArray = Array.from(allStrikes).sort((a, b) => a - b);

        strikeArray.forEach(strike => {
            let totalPain = 0;
            calls.forEach(c => { if (strike > c.strike) totalPain += (strike - c.strike) * (c.openInterest || 0); });
            puts.forEach(p => { if (strike < p.strike) totalPain += (p.strike - strike) * (p.openInterest || 0); });
            if (totalPain <= minPainValue && totalPain > 0) { minPainValue = totalPain; maxPainStrike = strike; }
        });

        return { pcr, callWall: callWallStrike, putWall: putWallStrike, maxPain: maxPainStrike };
    } catch (e) { return null; }
}

async function fetchCandles(symbolInfo, intervalMinutes, limit) {
    try {
        const interval = intervalMinutes === 60 ? '1h' : (intervalMinutes + 'm');
        let fetchSym = '';

        if (typeof symbolInfo === 'string') {
            // Crypto
            fetchSym = symbolInfo.endsWith('USDT') ? symbolInfo.replace('USDT', '-USDT') : symbolInfo;
        } else if (symbolInfo.isAsset) {
            // Traditional Asset mapping (e.g. AAPL -> NCSKAAPL2USD-USDT)
            fetchSym = symbolInfo.bingxSymbol;
        } else {
            fetchSym = symbolInfo.symbol.replace('USDT', '-USDT');
        }

        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${fetchSym}&interval=${interval}&limit=${limit}`);
        let list = res.data.data || [];

        // BingX returns array of objects {open, high, low, close, volume, time}
        // We sort oldest to newest to match technical indicators logic
        list.sort((a, b) => a.time - b.time);

        return list.map(k => ({
            open: parseFloat(k.open),
            high: parseFloat(k.high),
            low: parseFloat(k.low),
            close: parseFloat(k.close),
            volume: parseFloat(k.volume),
            closeTime: parseInt(k.time)
        }));
    } catch (e) {
        return null;
    }
}

let telegramBot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
}

let globalMarketState = {
    btcTrend: 'NEUTRAL',
    btc1h: 'NEUTRAL',
    btc4h: 'NEUTRAL',
    btc1d: 'NEUTRAL',
    ethTrend: 'NEUTRAL',
    btcDomTrend: 'NEUTRAL',
    dxyTrend: 'NEUTRAL',
    timestamp: 0
};

const CONFIG = {
    minRR: 1.5,           // 1.5-2.0 arası (Eski katı kural)
    obLookback: 30,       // 14-50 arası  
    minScore: 55,         // Short sinyalleri için kalite barajı (13 stop'un 10'unu elediği için 55)
    fvgRequired: false,   // true/false
    sma50Filter: 'soft',  // 'hard'/'soft'
    adxThreshold: 25,     // 15-35 arası
    maxActiveTrades: 10,  // Aynı anda maksimum açık BOT işlemi
    priceTolerancePct: 0.3, // İşleme girmek için tolerans %
    isMacroNewsDay: false, // FOMC, NFP gibi ekstrem günlerde EURUSD filtresi
    useMacroFilter: false, // Gecici bir sure makro bloklama ve puanlamalar donduruldu (saf teknik analiz)
    maxSlPct: 3.5,         // Maksimum stop loss % (bunu aşanlar reddedilir)
    premiumSlThreshold: 2.5, // Stop oranı %2.5'i aşan riskli işlemlerde premium RR zorunluluğu
    premiumRR: 2.0         // Riskli işlemler için en az 1:2 R:R zorunluluğu
};

// --- GLOBAL MARKET SENSOR START ---
async function fetchBinanceKlines(symbol, interval) {
    try {
        const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=100`);
        return res.data.map(k => ({
            close: parseFloat(k[4]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            open: parseFloat(k[1]),
            volume: parseFloat(k[5]),
            closeTime: parseInt(k[6])
        }));
    } catch (e) { return null; }
}

async function fetchBybitKlinesGlobal(symbol, interval) {
    try {
        const res = await axios.get(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=100`);
        return res.data.result.list.map(k => ({
            close: parseFloat(k[4]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            open: parseFloat(k[1]),
            volume: parseFloat(k[5]),
            closeTime: parseInt(k[0])
        })).reverse();
    } catch (e) { return null; }
}

async function fetchCoinGeckoDominance() {
    try {
        const res = await axios.get("https://api.coingecko.com/api/v3/global");
        const mcp = res.data.data.market_cap_percentage;
        return {
            btc: mcp.btc || 50,
            usdt: mcp.usdt || 5,
            alt: Math.max(0, 100 - (mcp.btc || 50) - (mcp.usdt || 5) - (mcp.eth || 10) - (mcp.bnb || 3) - (mcp.sol || 2))
        };
    } catch (e) {
        return { btc: 50, usdt: 5, alt: 15 };
    }
}

function calculateTrendFromKlines(klines) {
    const defaultRes = { trend: 'NEUTRAL', rsi: 50, ema: 0, sma: 0, close: 0 };
    if (!klines || klines.length < 50) return defaultRes;
    const closes = klines.map(k => k.close);
    const ema20 = EMA.calculate({ period: 20, values: closes });
    const sma50 = SMA.calculate({ period: 50, values: closes });
    const { RSI } = require('technicalindicators');
    const rsi = RSI.calculate({ period: 14, values: closes });

    if (!ema20.length || !sma50.length || !rsi.length) return defaultRes;

    const lastClose = closes[closes.length - 1];
    const lastEma = ema20[ema20.length - 1];
    const lastSma = sma50[sma50.length - 1];
    const lastRsi = rsi[rsi.length - 1];

    let trend = 'NEUTRAL';
    if (lastClose > lastEma && lastEma > lastSma && lastRsi >= 55) trend = 'STRONG_BULL';
    else if (lastClose > lastSma && lastRsi >= 50) trend = 'BULL';
    else if (lastClose < lastEma && lastEma < lastSma && lastRsi <= 45) trend = 'STRONG_BEAR';
    else if (lastClose < lastSma && lastRsi <= 50) trend = 'BEAR';

    return { trend, rsi: lastRsi, ema: lastEma, sma: lastSma, close: lastClose };
}

async function analyzeGlobalMarket() {
    try {
        console.log('[GLOBAL SENSOR] Fetching macro market and dominance data...');
        const [btc1h, btc4h, btc1d, eth4h, eth1d, dom4h, cgDom] = await Promise.all([
            fetchBybitKlinesGlobal('BTCUSDT', '60'),
            fetchBybitKlinesGlobal('BTCUSDT', '240'),
            fetchBybitKlinesGlobal('BTCUSDT', 'D'),
            fetchBybitKlinesGlobal('ETHUSDT', '240'),
            fetchBybitKlinesGlobal('ETHUSDT', 'D'),
            fetchBinanceKlines('BTCDOMUSDT', '4h'),
            fetchCoinGeckoDominance()
        ]);

        const btc1hObj = calculateTrendFromKlines(btc1h);
        const btc4hObj = calculateTrendFromKlines(btc4h);
        const btc1dObj = calculateTrendFromKlines(btc1d);
        const eth4hObj = calculateTrendFromKlines(eth4h);
        const eth1dObj = calculateTrendFromKlines(eth1d);
        const dom4hObj = calculateTrendFromKlines(dom4h);

        let finalBtc = btc4hObj.trend;
        if ((btc4hObj.trend === 'BULL' || btc4hObj.trend === 'STRONG_BULL') && (btc1dObj.trend === 'BULL' || btc1dObj.trend === 'STRONG_BULL')) {
            finalBtc = 'STRONG_BULL';
        } else if ((btc4hObj.trend === 'BEAR' || btc4hObj.trend === 'STRONG_BEAR') && (btc1dObj.trend === 'BEAR' || btc1dObj.trend === 'STRONG_BEAR')) {
            finalBtc = 'STRONG_BEAR';
        }

        globalMarketState = {
            btcTrend: finalBtc,
            btc1h: btc1hObj.trend,
            btc4h: btc4hObj.trend,
            btc1d: btc1dObj.trend,
            btc1dObj: btc1dObj,
            ethTrend: eth4hObj.trend,
            eth1dObj: eth1dObj,
            btcDomTrend: dom4hObj.trend,
            cgDom: cgDom,
            timestamp: Date.now()
        };
        console.log(`[GLOBAL SENSOR] BTC: ${globalMarketState.btcTrend} | USDT.D: %${globalMarketState.cgDom.usdt.toFixed(1)} | ETH: ${globalMarketState.ethTrend}`);
    } catch (e) {
        console.error('[GLOBAL SENSOR] Error:', e.message);
    }
}
// --- GLOBAL MARKET SENSOR END ---

async function getUsdtPairsAndAssets() {
    try {
        const response = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        const symbols = response.data.data;
        const ignoredStables = ['USDC-USDT', 'USD1-USDT', 'USDE-USDT', 'BUSD-USDT', 'TUSD-USDT', 'FDUSD-USDT', 'EUR-USDT', 'DAI-USDT', 'USTC-USDT', 'PYUSD-USDT', 'CRCLX-USDT', 'NXPC-USDT'];
        
        let cryptoPairs = [];
        let tradFiAssets = [];
        let freshMap = {};

        symbols.forEach(s => {
            if (!s.symbol.endsWith('-USDT') || ignoredStables.includes(s.symbol)) return;

            const vol = parseFloat(s.quoteVolume);
            
            if (s.symbol.startsWith('NC')) {
                // TradFi (Sentetikler) İçin Hacim Barajı (500k USD)
                if (vol > 500000) {
                    const bingxSymbol = s.symbol;
                    let cleanSymbol = bingxSymbol.replace('2USD-USDT', '').replace('-USDT', '');
                    let fetchId = cleanSymbol;

                    if (bingxSymbol.startsWith('NCSK')) {
                         fetchId = cleanSymbol.replace('NCSK', ''); // AAPL, NVDA
                         cleanSymbol = fetchId;
                    } else if (bingxSymbol.startsWith('NCFX')) {
                         let fx = cleanSymbol.replace('NCFX', ''); // EUR2CHF
                         cleanSymbol = fx.replace('2', ''); // EURCHF
                         fetchId = cleanSymbol + '=X'; // EURCHF=X
                    } else {
                         // NCCO veya NCSI Endeksler ve Emtialar
                         let baseCode = cleanSymbol.replace('NCCO', '').replace('NCSI', '').replace('724', '');
                         if (baseCode === 'OILBRENT') baseCode = 'BRENT';
                         if (baseCode === 'OILWTI') baseCode = 'WTI';
                         
                         if (ASSET_MAPPING[cleanSymbol]) {
                             fetchId = ASSET_MAPPING[cleanSymbol].fetchId;
                         } else {
                             fetchId = baseCode; // Fallback
                         }
                         cleanSymbol = baseCode;
                    }

                    const finalSymbol = cleanSymbol === 'GOLD' ? 'XAUUSD' : (cleanSymbol === 'XAG' ? 'XAGUSD' : cleanSymbol);
                    
                    freshMap[finalSymbol] = bingxSymbol;

                    tradFiAssets.push({
                        symbol: finalSymbol,
                        isAsset: true,
                        fetchId: fetchId,
                        bingxSymbol: bingxSymbol,
                        volume: vol
                    });
                }
            } else {
                // Kripto Pariteler (3 Milyon USD Barajı)
                if (vol > 3000000) {
                   const cleanCrypto = s.symbol.replace('-', '');
                   freshMap[cleanCrypto] = s.symbol; // BTCUSDT -> BTC-USDT
                   cryptoPairs.push({
                       symbol: cleanCrypto,
                       volume: vol
                   });
                }
            }
        });

        global.BINGX_SYMBOL_MAP = freshMap; // Tercümanı hafızaya kaydet
        return { cryptoPairs, tradFiAssets };
    } catch (error) {
        console.error('BingX Ticker Error:', error.message);
        return { cryptoPairs: [], tradFiAssets: [] };
    }
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Aktif sinyalleri kontrol et, duruma göre Win veya Loss yap
async function checkActiveSignals() {
    try {
        const activeSignals = await db.all("SELECT * FROM signals WHERE status = 'ACTIVE'");
        if (!activeSignals || activeSignals.length === 0) return;

        console.log(`[SCANNER] Checking ${activeSignals.length} active signals...`);

        // Batch fetch all prices at once (BingX API)
        const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        const priceMap = {};
        
        // TradFi Tercuman (Reverse Map) 
        const reverseMap = {};
        if (global.BINGX_SYMBOL_MAP) {
             Object.keys(global.BINGX_SYMBOL_MAP).forEach(k => {
                 reverseMap[global.BINGX_SYMBOL_MAP[k]] = k;
             });
        }

        res.data.data.forEach(t => {
             let mappedKey = t.symbol.replace('-', '');
             if (reverseMap[t.symbol]) mappedKey = reverseMap[t.symbol];
             priceMap[mappedKey] = parseFloat(t.lastPrice);
        });

        // --- AUTO TRADING CHECK START ---
        if (process.env.BINGX_API_KEY) {
            try {
                // Sadece veritabanında tablomuz varsa çalışır (database.js db error atmaması için tablonun olduğunu varsayıyoruz)
                const activeTrades = await db.all("SELECT * FROM user_trades WHERE status = 'ACTIVE'");
                for (const trade of activeTrades) {
                    try {
                        const position = await getPosition(trade.symbol);
                        if (!position || parseFloat(position.size) === 0) {
                            // Pozisyon Borsada Kapanmış (TP/SL)
                            console.log(`[AUTO-TRADE-CHECK] Pozisyon Borsada Kapalı Tespit Edildi: ${trade.symbol}`);
                            const currentP = priceMap[trade.symbol];
                            if (currentP) {
                                let pnl = 0;
                                if (trade.type === 'LONG') pnl = ((currentP - trade.entryPrice) / trade.entryPrice) * 100 * 10;
                                else pnl = ((trade.entryPrice - currentP) / trade.entryPrice) * 100 * 10;

                                let reason = pnl > 0 ? 'NATIVE_TP' : 'NATIVE_SL';
                                await db.run(
                                    "UPDATE user_trades SET status = 'CLOSED', pnl = ?, closeReason = ?, closedAt = CURRENT_TIMESTAMP WHERE id = ?",
                                    [pnl, reason, trade.id]
                                );

                                // UI FAVORILER SENKRONIZASYONU (Borsada kapanan manuel islemlerin web arayuzunde asili kalmamasi icin)
                                const customFavStatus = pnl >= 0 ? 'WIN' : 'LOSS';
                                await db.run(
                                    "UPDATE favorites SET customStatus = ?, customPnl = ?, closedAt = CURRENT_TIMESTAMP WHERE telegramId = ? AND signalId = ? AND customStatus IS NULL",
                                    [customFavStatus, pnl, trade.telegramId, trade.signalId]
                                );

                                // Orijinal Global sinyal duruyor olabilir. Ancak Kullanıcı Şahsi Favorilerinde "Aktif" olanları göstermeyeceğimizden listeden düşecektir.
                            }
                        } else {
                            // --- BREAKEVEN TRAILING STOP LOGIC ---
                            const isBreakeven = trade.isBreakeven || 0;
                            if (isBreakeven === 0) {
                                const currentP = priceMap[trade.symbol];
                                if (currentP) {
                                    const risk = Math.abs(trade.entryPrice - trade.stopPrice);
                                    let reachedTP1 = false;
                                    let newStopLoss = trade.entryPrice;

                                    if (trade.type === 'LONG') {
                                        const tp1 = trade.entryPrice + risk;
                                        if (currentP >= tp1) reachedTP1 = true;
                                        newStopLoss = trade.entryPrice * 1.0015; // Komisyonu kurtarmak için %0.15 üstü
                                    } else {
                                        const tp1 = trade.entryPrice - risk;
                                        if (currentP <= tp1) reachedTP1 = true;
                                        newStopLoss = trade.entryPrice * 0.9985; // Komisyonu kurtarmak için %0.15 altı
                                    }

                                    if (reachedTP1) {
                                        try {
                                            await updateStopLoss(trade.symbol, newStopLoss, trade.targetPrice);
                                            await db.run("UPDATE user_trades SET isBreakeven = 1 WHERE id = ?", [trade.id]);
                                            console.log(`[TRAILING-STOP] ${trade.symbol} 1R hedefine ulaştı. StopLoss girişe çekildi: ${newStopLoss}`);

                                            // Send Telegram Message
                                            if (telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
                                                const msg = `🛡️ *KORUMA DEVREDE!* [${trade.symbol}]\nİşlem İlk Kâr Hedefine (1R) ulaştı. Zarar Etme Riski Sıfırlandı, Stop Loss maliyetin hemen önüne (${newStopLoss.toFixed(4)}) çekildi!`;
                                                telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, msg, { parse_mode: 'Markdown' });
                                            }
                                        } catch (err) {
                                            console.error("[TRAILING-STOP] Güncelleme Hatası:", err.message);
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e) { }
                }
            } catch (e) { }
        }
        // --- AUTO TRADING CHECK END ---

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
                let isBreakevenCandid = signal.reachedTwoPercent;
                if (pnl >= 2.0 && !signal.reachedTwoPercent) {
                    await db.run("UPDATE signals SET reachedTwoPercent = 1 WHERE id = ?", [signal.id]);
                    isBreakevenCandid = 1;
                }

                if (newStatus === 'LOSS' && isBreakevenCandid) {
                    newStatus = 'BREAKEVEN';
                }

                if (newStatus) {
                    (async () => {
                        try {
                            let netUsd = null;
                            const { getNetIncome } = require('./bingx-trade');
                            // Bekle ki borsa income geçmişini tam işlesin
                            await new Promise(res => setTimeout(res, 2000));
                            netUsd = await getNetIncome(signal.symbol, signal.createdAt);

                            if (netUsd !== null && netUsd !== undefined) {
                                await db.run("UPDATE signals SET status = ?, netPnlUsd = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [newStatus, netUsd, signal.id]);
                                console.log(`[SCANNER] Signal ${signal.symbol} closed as ${newStatus} (Net PnL: $${netUsd.toFixed(4)})`);
                            } else {
                                await db.run("UPDATE signals SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [newStatus, signal.id]);
                                console.log(`[SCANNER] Signal ${signal.symbol} closed as ${newStatus} (Net PnL: YAKALANAMADI)`);
                            }

                            // Telegram Bildirimi (TP veya SL)
                            if (typeof telegramBot !== 'undefined' && telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
                                try {
                                    const isTP = (newStatus === 'WIN');
                                    let pnlText = (netUsd !== null && netUsd !== undefined) ? `💸 *Net PnL:* $${netUsd.toFixed(2)}` : `📊 *Kapanış Durumu:* Piyasa Emriyle Kapatıldı.`;

                                    let msg = "";
                                    if (isTP) {
                                        msg = `🎯 *TAKE PROFIT (HEDEF VURULDU)!* [${signal.symbol}]\nElyte Sinyali başarıyla kâr hedefine ulaştı ve kapatıldı.\n\n${pnlText}\n\nPeriskop AI hedefini vurdu! 🔭`;
                                    } else {
                                        if (signal.reachedTwoPercent) {
                                            msg = `🛑 *STOP LOSS ÇALIŞTI (BAŞABAŞ)* [${signal.symbol}]\nİşlem 1R sonrası kârı korumak için giriş seviyesinden kapatıldı.\n\nZarar Koruma (Breakeven) Devrede! 🛡️`;
                                        } else {
                                            msg = `🛑 *STOP LOSS!* [${signal.symbol}]\nİşlem maalesef zarardurdur seviyesine temas etti ve kapatıldı.\n\nRisk yönetimi daima hayat kurtarır. 🛡️`;
                                        }
                                    }
                                    
                                    // TELEGRAM MESAJI GONDER
                                    telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, msg, { parse_mode: 'Markdown' });
                                    
                                } catch (tgErr) {
                                    console.error("TG Send Error on Close:", tgErr.message);
                                }
                            }

                            // Google Sheets'te Güncelle
                            const googleApi = require('./google-api');
                            if (googleApi.updateSheetSignalStatus) {
                                await googleApi.updateSheetSignalStatus(signal.id, newStatus);
                            }
                        } catch (err) {
                            console.error("[SCANNER ASYNC CLOSE ERROR]:", err);
                        }
                    })();
                }
            } catch (e) {
                // Ignore single coin error
            }
        }
    } catch (e) {
        console.error("Error checking active signals:", e);
    }

    // Pozisyonlar kapanmış olabilir, boşalan yerleri doldur
    // await backfillTrades(); // KULLANICI TALEBI: Otomatik "Eski Sinyalleri Doldurma" iptal edildi. Slotlar yeni sinyallere saklanacak.
}

async function backfillTrades() {
    if (!process.env.BINGX_API_KEY || !process.env.PERISKOP_TELEGRAM_ID) return;

    try {
        const activeCountRes = await db.get("SELECT COUNT(*) as count FROM user_trades WHERE status = 'ACTIVE'");
        const activeCount = activeCountRes ? activeCountRes.count : 0;

        if (activeCount >= CONFIG.maxActiveTrades) return;

        let slotsAvailable = CONFIG.maxActiveTrades - activeCount;

        // Havuz: Henüz BOT'ta açık işlemi olmayan Sinyalleri çek (Sıralama: Kalite Skoru yüksek olan önce)
        const candidateSignals = await db.all(`
            SELECT s.* 
            FROM signals s
            LEFT JOIN user_trades ut ON s.id = ut.signalId
            WHERE s.status = 'ACTIVE' AND ut.id IS NULL
            ORDER BY s.qualityScore DESC, s.createdAt DESC
        `);

        if (candidateSignals.length === 0) return;

        console.log(`[BACKFILL] Bos slot: ${slotsAvailable}. Bekleyen ${candidateSignals.length} adet havuz sinyali degerlendiriliyor...`);

        // BingX Fiyatları
        const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        const priceMap = {};
        res.data.data.forEach(t => priceMap[t.symbol.replace('-', '')] = parseFloat(t.lastPrice));

        for (const signal of candidateSignals) {
            if (slotsAvailable <= 0) break;

            const currentPrice = priceMap[signal.symbol];
            if (!currentPrice) continue;

            const diffPct = Math.abs((currentPrice - signal.entryPrice) / signal.entryPrice) * 100;
            if (diffPct <= CONFIG.priceTolerancePct) {
                // Şart sağlandı: Limiti yemedik, fiyat da çok kaçmamış
                console.log(`[BACKFILL] Uygun fiyat bulundu! Emir Gönderiliyor: ${signal.symbol} (Score: ${signal.qualityScore})`);
                try {
                    const orderId = await placeOrder(signal.symbol, signal.type, currentPrice, signal.targetPrice, signal.stopPrice);
                    if (orderId) {
                        await db.run(
                            "INSERT INTO user_trades (telegramId, signalId, symbol, type, entryPrice, targetPrice, stopPrice, status, bybitOrderId) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)",
                            [process.env.PERISKOP_TELEGRAM_ID, signal.id, signal.symbol, signal.type, currentPrice, signal.targetPrice, signal.stopPrice, orderId]
                        );

                        const checkFav = await db.get("SELECT id FROM favorites WHERE telegramId = ? AND signalId = ?", [process.env.PERISKOP_TELEGRAM_ID, signal.id]);
                        if (!checkFav) {
                            await db.run("INSERT INTO favorites (telegramId, signalId) VALUES (?, ?)", [process.env.PERISKOP_TELEGRAM_ID, signal.id]);
                        }
                        slotsAvailable--;
                    }
                } catch (e) {
                    console.error(`[BACKFILL] Hata:`, e.message);
                }
            } else {
                const dir = currentPrice > signal.entryPrice ? 'Yukarı' : 'Aşağı';
                console.log(`[BACKFILL] Atlanıyor: ${signal.symbol} (Fiyat %${diffPct.toFixed(2)} ${dir} kaçmış. Tolerans: %${CONFIG.priceTolerancePct})`);
            }
        }
    } catch (e) {
        console.error("Backfill Error:", e);
    }
}

async function analyzeCoin(symbolInfo) {
    try {
        const sym = typeof symbolInfo === 'string' ? symbolInfo : symbolInfo.symbol;
        const klinesFull = await fetchCandles(symbolInfo, 60, 300);
        if (!klinesFull || klinesFull.length < 250) return null;

        const closesFull = klinesFull.map(k => k.close);
        const ema200Values = EMA.calculate({ period: 200, values: closesFull });
        const curEma200 = ema200Values[ema200Values.length - 1];

        // Orijinal indikatör uyumu için son 100 işlem mumunu kesiyoruz
        const klines = klinesFull.slice(-100);

        const opens = klines.map(k => k.open);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const closes = klines.map(k => k.close);
        const volumes = klines.map(k => k.volume);

        const currentPrice = closes[closes.length - 1];
        const rangeHigh = Math.max(...highs);
        const rangeLow = Math.min(...lows);
        const eq = (rangeHigh + rangeLow) / 2;

        const atrRes = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
        const currentATR = atrRes[atrRes.length - 1] || (currentPrice * 0.015);

        let avgATR = currentATR;
        if (atrRes.length >= 14) {
            const last14 = atrRes.slice(-14);
            avgATR = last14.reduce((acc, val) => acc + val, 0) / 14;
        }

        // TEMEL HESAPLAMALAR
        const recentLows = lows.slice(-6);
        const recentHighs = highs.slice(-6);
        let recentMin = Math.min(...recentLows);
        let recentMax = Math.max(...recentHighs);
        let dipDeviation = false;
        let tepeDeviation = false;

        // MATEMATİKSEL LİKİDİTE KONTROLÜ (SWEEP & RECLAIM ZORUNLU TABAN KURAL)
        let sweepIdxLong = -1;
        if (recentMin <= rangeLow * 1.005 && currentPrice > rangeLow) {
            let sweepIdx = lows.lastIndexOf(recentMin);
            if (sweepIdx !== -1) {
                if (currentPrice > highs[sweepIdx]) { // CHOCH
                    dipDeviation = true;
                    sweepIdxLong = sweepIdx;
                }
            }
        }

        let sweepIdxShort = -1;
        if (recentMax >= rangeHigh * 0.995 && currentPrice < rangeHigh) {
            let sweepIdx = highs.lastIndexOf(recentMax);
            if (sweepIdx !== -1) {
                if (currentPrice < lows[sweepIdx]) {
                    tepeDeviation = true;
                    sweepIdxShort = sweepIdx;
                }
            }
        }

        // SWEEP YOKSA IŞLEM YOK
        if (!dipDeviation && !tepeDeviation) return null;

        const direction = dipDeviation ? 'LONG' : 'SHORT';

        // 🔥 ASİMETRİK LİKİDİTE (DUAL LIQUIDITY) FİLTRESİ
        const globalVol = typeof symbolInfo === 'object' && symbolInfo.volume ? symbolInfo.volume : 999999999;
        if (direction === 'LONG' && globalVol < 4000000) {
            // Hacim 4 Milyonun altındaysa LONG YASAK (Slippage / Scam Wick koruması)
            return null;
        }
        if (direction === 'SHORT' && globalVol < 2000000) {
            // Hacim 2 Milyonun altındaysa SHORT YASAK
            return null;
        }

        // --- GLOBAL MARKET CONTEXT FILTER / EXTREME BLOCKERS ---
        let eurusdDailyPenalty = 0;
        if (CONFIG.useMacroFilter && !symbolInfo.isAsset) {
            const btc1d = globalMarketState.btc1dObj;
            if (btc1d && btc1d.rsi > 0 && btc1d.rsi < 25 && btc1d.close < btc1d.ema && btc1d.close < btc1d.sma) {
                if (direction === 'LONG') return null; // BTC EXTREME BEAR - ALTCOIN LONG BLOCKED
            }
            const eth1d = globalMarketState.eth1dObj;
            if (eth1d && eth1d.rsi > 75 && eth1d.close > eth1d.ema && eth1d.close > eth1d.sma) {
                if (direction === 'SHORT') return null; // ETH EXTREME BULL - ALTCOIN SHORT BLOCKED
            }
        } else if (symbolInfo.isAsset) {
            // EURUSD Günlük SMA 200 Filtresi
            if (sym === 'EURUSD') {
                if (CONFIG.isMacroNewsDay) {
                    eurusdDailyPenalty += 20;
                }
                const eu1d = await fetchCandles(symbolInfo, 1440, 205);
                if (eu1d && eu1d.length >= 200) {
                    const sma200 = SMA.calculate({ period: 200, values: eu1d.map(x => x.close) });
                    const curSma = sma200[sma200.length - 1];
                    if (direction === 'LONG' && currentPrice < curSma) eurusdDailyPenalty += 15;
                    if (direction === 'SHORT' && currentPrice > curSma) eurusdDailyPenalty += 15;
                }
            }
        }

        // --- SKORLAMA (SCORING) ALTYAPISI ---
        let qualityScore = 0;
        let warnings = [];

        // --- MACRO 200 EMA FİLTRESİ ---
        if (direction === 'LONG' && currentPrice < curEma200) {
            qualityScore -= 15;
            warnings.push('Bearish 200 EMA (-15)');
        }
        if (direction === 'SHORT' && currentPrice > curEma200) {
            qualityScore -= 15;
            warnings.push('Bullish 200 EMA (-15)');
        }

        if (eurusdDailyPenalty > 0) {
            qualityScore -= eurusdDailyPenalty;
            warnings.push(`Macro EURUSD Risk (-${eurusdDailyPenalty})`);
        }
        let breakdown = { ob: false, fvg: false, rvol: 0, adx: 0, rr: 0, trend4h: "neutral", globalVol: globalVol };

        // DOMİNANS HARMAN SCORING (-25 ile +43 puan)
        if (CONFIG.useMacroFilter && !symbolInfo.isAsset && globalMarketState.cgDom) {
            let macroScore = 0;
            const cgDom = globalMarketState.cgDom;

            // BTC Dominans
            if (globalMarketState.btcDomTrend === 'BEAR' || globalMarketState.btcDomTrend === 'STRONG_BEAR') {
                macroScore += 15; // Altseason!
            } else if (globalMarketState.btcDomTrend === 'BULL' || globalMarketState.btcDomTrend === 'STRONG_BULL') {
                macroScore -= 10;
            }

            // USDT Dominans (DXY YERİNE!)
            if (cgDom.usdt > 5) {
                macroScore -= 10; // Korku!
                warnings.push(`USDT.D Risk (%${cgDom.usdt.toFixed(1)})`);
            } else {
                macroScore += 8;  // Risk iştahı
            }

            // ALT Dominans (ETH Trend bazlı referans ile)
            if (cgDom.alt > 20 && (globalMarketState.ethTrend === 'BULL' || globalMarketState.ethTrend === 'STRONG_BULL')) {
                macroScore += 20; // Altlar parlıyor
            } else if (cgDom.alt < 15 && (globalMarketState.ethTrend === 'BEAR' || globalMarketState.ethTrend === 'STRONG_BEAR')) {
                macroScore -= 12; // Altlar sönüyor
            }

            qualityScore += macroScore;
        }

        // 3. Volatilite (ATR) Ani Haber/Fakeout Filtresi
        if (currentATR > avgATR * 2.0) {
            qualityScore -= 15;
            warnings.push('High Volatility (ATR Spike -15)');
        }

        // 4. RSI (1H) Tükenmişlik (Over-extension) Filtresi
        const rsiRes = require('technicalindicators').RSI.calculate({ period: 14, values: closes });
        const currentRSI = rsiRes.length > 0 ? rsiRes[rsiRes.length - 1] : 50;

        if (direction === 'LONG' && currentRSI > 75) {
            if (symbolInfo && symbolInfo.isAsset) {
                qualityScore += 5;
                warnings.push('Aşırı Alım Değil, Güçlü Değerleme Trendi (RSI > 75) (+5)');
            } else {
                qualityScore -= 10;
                warnings.push('RSI Overbought for LONG (-10)');
            }
        } else if (direction === 'SHORT' && currentRSI < 25) {
            if (symbolInfo && symbolInfo.isAsset) {
                qualityScore += 5;
                warnings.push('Aşırı Satım Değil, Güçlü Ayı Trendi Desteği (RSI < 25) (+5)');
            } else {
                qualityScore -= 10;
                warnings.push('RSI Oversold for SHORT (-10)');
            }
        }

        // 5. RSI Hidden Divergence (Gizli Uyumsuzluk) Bonusu
        const sweepIdx = direction === 'LONG' ? sweepIdxLong : sweepIdxShort;
        let hasHiddenDivergence = false;

        const getRSI = (idx) => {
            const rIdx = idx - 14;
            return (rIdx >= 0 && rIdx < rsiRes.length) ? rsiRes[rIdx] : 50;
        };

        if (sweepIdx > 20) {
            const currentSweepPrice = direction === 'LONG' ? lows[sweepIdx] : highs[sweepIdx];
            const currentSweepRSI = getRSI(sweepIdx);

            // Son 30 mumdan 5 mum oncesine kadar tarama (Gecmis dalgayi bulma)
            const lookbackStart = Math.max(14, sweepIdx - 30);
            const lookbackEnd = sweepIdx - 5;

            if (direction === 'LONG') {
                let prevLowest = Infinity;
                let prevLowestRSI = 50;
                let foundBase = false;

                for (let k = lookbackStart; k <= lookbackEnd; k++) {
                    if (lows[k] < prevLowest) {
                        prevLowest = lows[k];
                        prevLowestRSI = getRSI(k);
                        foundBase = true;
                    }
                }
                // Gizli Boğa: Fiyat Higher Low, RSI Lower Low yapiyorsa
                if (foundBase && currentSweepPrice > prevLowest && currentSweepRSI < prevLowestRSI) {
                    hasHiddenDivergence = true;
                }
            } else {
                let prevHighest = -Infinity;
                let prevHighestRSI = 50;
                let foundBase = false;

                for (let k = lookbackStart; k <= lookbackEnd; k++) {
                    if (highs[k] > prevHighest) {
                        prevHighest = highs[k];
                        prevHighestRSI = getRSI(k);
                        foundBase = true;
                    }
                }
                // Gizli A: Fiyat Lower High, RSI Higher High yapiyorsa
                if (foundBase && currentSweepPrice < prevHighest && currentSweepRSI > prevHighestRSI) {
                    hasHiddenDivergence = true;
                }
            }
        }

        if (hasHiddenDivergence) {
            qualityScore += 5;
            warnings.push('Hidden Divergence (+5)');
        }

        // 1. ORDER BLOCK (OB) - SADELEŞTİRİLMİŞ 20 MUM KONTROLÜ
        const obZone = direction === 'LONG' ? [rangeLow - (currentATR * 1.5), rangeLow + (currentATR * 1.5)] : [rangeHigh - (currentATR * 1.5), rangeHigh + (currentATR * 1.5)];
        const obCandlesStart = closes.length - CONFIG.obLookback - 6; // exclude the sweep recent 6
        let hasOB = false;
        for (let i = obCandlesStart; i <= closes.length - 6; i++) {
            if (i < 0) continue;
            if (direction === 'LONG' && closes[i] < opens[i] && closes[i] <= obZone[1] && closes[i] >= obZone[0]) {
                if (highs[i + 1] > highs[i]) { hasOB = true; break; }
            } else if (direction === 'SHORT' && closes[i] > opens[i] && closes[i] >= obZone[0] && closes[i] <= obZone[1]) {
                if (lows[i + 1] < lows[i]) { hasOB = true; break; }
            }
        }
        if (hasOB) {
            qualityScore += 25;
            warnings.push('Order Block (+25)');
            breakdown.ob = true;
        }

        // 2. FVG (FAIR VALUE GAP) - OPSİYONEL
        let hasFVG = false;
        const lastIdx = closes.length - 1;
        for (let i = lastIdx - 2; i <= lastIdx; i++) {
            if (i >= 2) {
                if (direction === 'LONG' && highs[i - 2] < lows[i]) hasFVG = true;
                if (direction === 'SHORT' && lows[i - 2] > highs[i]) hasFVG = true;
            }
        }
        if (hasFVG) {
            qualityScore += 15;
            warnings.push('FVG Confirmed (+15)');
            breakdown.fvg = true;
        } else if (CONFIG.fvgRequired) {
            return null; // Eğer mutlaka FVG istersen
        }

        // 3. HACİM (RVOL)
        const vol20 = volumes.slice(-21, -1);
        const avgVol = vol20.reduce((a, b) => a + b, 0) / 20;
        const recentVol = Math.max(...volumes.slice(-3));
        const rvolRatio = recentVol / (avgVol || 1);
        breakdown.rvol = parseFloat(rvolRatio.toFixed(2));
        if (rvolRatio >= 1.2) {
            qualityScore += 15;
            warnings.push('High Volume Spike (+15)');
        }

        // 4. ADX REJİMİ
        const adxResult = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
        const currentADX = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 0;
        breakdown.adx = Math.round(currentADX);
        if (currentADX > 25) {
            qualityScore += 10;
            warnings.push('Strong Trend (ADX > 25) (+10)');
        } else if (currentADX < 20) {
            qualityScore -= 10;
            warnings.push('Choppy Market Limit (ADX < 20) (-10)');
        }

        // 4.5 VWAP KONTROLÜ (SADECE HİSSELER)
        if (sym === 'AAPL' || sym === 'TSLA' || sym === 'NASDAQ') {
            const vPeriod = 20;
            if (closes.length >= vPeriod) {
                let sumPv = 0;
                let sumV = 0;
                for (let i = closes.length - vPeriod; i < closes.length; i++) {
                    const typPrice = (highs[i] + lows[i] + closes[i]) / 3;
                    sumPv += typPrice * volumes[i];
                    sumV += volumes[i];
                }
                const vwap = sumPv / (sumV || 1);
                if (direction === 'LONG' && currentPrice > vwap) { qualityScore += 8; warnings.push('VWAP Uyum (+8)'); }
                else if (direction === 'SHORT' && currentPrice < vwap) { qualityScore += 8; warnings.push('VWAP Uyum (+8)'); }
            }
        }

        // 5. 4H MTF TREND UYUMU
        let trend4h = "neutral";
        try {
            // Fetch 4H proxy or true 4H
            const klines4h = await fetchCandles(symbolInfo, 240, 50);
            const closes4h = klines4h.map(k => k.close);
            const sma4h = SMA.calculate({ values: closes4h, period: 50 });
            const currentPrice4H = closes4h[closes4h.length - 1];
            const sma50_4H = sma4h[sma4h.length - 1];

            if (currentPrice4H > sma50_4H) trend4h = "bullish";
            else if (currentPrice4H < sma50_4H) trend4h = "bearish";
            breakdown.trend4h = trend4h;

            if (direction === 'LONG') {
                if (trend4h === 'bullish') {
                    qualityScore += 15;
                } else {
                    warnings.push('Counter-trend 4H');
                    qualityScore -= 5;
                    if (CONFIG.sma50Filter === 'hard') return null;
                }
            } else if (direction === 'SHORT') {
                if (trend4h === 'bearish') {
                    qualityScore += 15;
                } else {
                    warnings.push('Counter-trend 4H');
                    qualityScore -= 5;
                    if (CONFIG.sma50Filter === 'hard') return null;
                }
            }
        } catch (e) { }

        // 5.5 BAYRAK/FLAMA (FLAG/PENNANT) FORMASYONU
        let poleSize = 0;
        let hasFlagPennant = false;
        const scanIdx = closes.length - 1;

        if (scanIdx >= 10) {
            for (let fLen = 3; fLen <= 7; fLen++) {
                const poleEndIdx = scanIdx - fLen;
                const poleStartIdx = Math.max(0, poleEndIdx - 5);

                if (poleEndIdx <= poleStartIdx) continue;

                const movePct = (closes[poleEndIdx] - opens[poleStartIdx]) / opens[poleStartIdx];

                if (direction === 'LONG' && movePct >= 0.05) {
                    poleSize = closes[poleEndIdx] - opens[poleStartIdx];
                    let flagLowest = Math.min(...lows.slice(poleEndIdx + 1, scanIdx + 1));
                    const flagRetracement = (closes[poleEndIdx] - flagLowest) / poleSize;

                    if (flagRetracement > 0 && flagRetracement < 0.6) {
                        hasFlagPennant = true;
                        break;
                    }
                } else if (direction === 'SHORT' && movePct <= -0.05) {
                    poleSize = opens[poleStartIdx] - closes[poleEndIdx];
                    let flagHighest = Math.max(...highs.slice(poleEndIdx + 1, scanIdx + 1));
                    const flagRetracement = (flagHighest - closes[poleEndIdx]) / poleSize;

                    if (flagRetracement > 0 && flagRetracement < 0.6) {
                        hasFlagPennant = true;
                        break;
                    }
                }
            }
        }

        if (hasFlagPennant) {
            qualityScore += 10;
            breakdown.flagPattern = true;
            warnings.push('Flag/Pennant (+10)');
            if (breakdown.rvol >= 1.2) {
                qualityScore += 5; // Ekstra RVOL uyum bonusu
                warnings.push('Flag RVOL Bonus (+5)');
            }
        }

        // --- YENİ İNDİKATÖR PAKETİ (WIN RATE BOOST +48) ---
        // 1. KAMA KALDIRILDI (Ichimoku ile ayni amaci tasidigi icin Redundant bulundu)

        // 2. Stochastic RSI (Aşırı Alım/Satım Cezası ±10)
        const stochRSIRes = StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });
        if (stochRSIRes && stochRSIRes.length > 0) {
            const lastStoch = stochRSIRes[stochRSIRes.length - 1];
            if (direction === 'LONG' && lastStoch.k > 80) {
                if (symbolInfo && symbolInfo.isAsset) {
                    qualityScore += 5; warnings.push('Momentum Kırılımı: StochRSI Aşırı Alım (+5)');
                } else {
                    qualityScore -= 10; warnings.push('StochRSI Overbought (-10)');
                }
            } else if (direction === 'SHORT' && lastStoch.k < 20) {
                if (symbolInfo && symbolInfo.isAsset) {
                    qualityScore += 5; warnings.push('Ayı Momentum Direnci: StochRSI Aşırı Satım (+5)');
                } else {
                    qualityScore -= 10; warnings.push('StochRSI Oversold (-10)');
                }
            }
        }

        // 3. Ichimoku Cloud (+15 Puan Trend Onayı)
        const ichiRes = IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 });
        if (ichiRes && ichiRes.length > 0) {
            const currentIchi = ichiRes[ichiRes.length - 1];
            if (direction === 'LONG') {
                if (currentPrice > currentIchi.spanA && currentPrice > currentIchi.spanB && currentIchi.conversion > currentIchi.base) {
                    qualityScore += 15; warnings.push('Ichimoku Bull Trend (+15)');
                }
            } else if (direction === 'SHORT') {
                if (currentPrice < currentIchi.spanA && currentPrice < currentIchi.spanB && currentIchi.conversion < currentIchi.base) {
                    qualityScore += 15; warnings.push('Ichimoku Bear Trend (+15)');
                }
            }
        }

        // 4. Order Flow Delta (Hacim Dağılımı Yaklaşımı ±15 Puan)
        const currentOpen = opens[opens.length - 1];
        const currentHigh = highs[highs.length - 1];
        const currentLow = lows[lows.length - 1];
        const currentClose = closes[closes.length - 1];
        const currentVol = volumes[volumes.length - 1];
        if (currentHigh > currentLow && currentVol > 0) {
            const buyVol = currentVol * ((currentClose - currentLow) / (currentHigh - currentLow));
            const sellVol = currentVol * ((currentHigh - currentClose) / (currentHigh - currentLow));
            const buyRatio = buyVol / (currentVol || 1);
            const sellRatio = sellVol / (currentVol || 1);

            if (direction === 'LONG') {
                if (buyRatio > 0.60) {
                    qualityScore += 15; warnings.push('Order Flow Aggressive Bull (+15)');
                } else if (sellRatio > 0.60) {
                    qualityScore -= 15; warnings.push('Order Flow Aggressive Bear Res (-15)');
                }
            } else if (direction === 'SHORT') {
                if (sellRatio > 0.60) {
                    qualityScore += 15; warnings.push('Order Flow Aggressive Bear (+15)');
                } else if (buyRatio > 0.60) {
                    qualityScore -= 15; warnings.push('Order Flow Aggressive Bull Sup (-15)');
                }
            }
        }

        // 5. Günlük MA Golden Cross (+10 Puan) (Sadece kalite skoru yüksek olanlara API tasarrufu için sorulur)
        if (qualityScore >= 25) {
            try {
                const dailyKlines = await fetchCandles(symbolInfo, 1440, 200);
                if (dailyKlines && dailyKlines.length >= 200) {
                    const dailyCloses = dailyKlines.map(k => k.close);
                    const sma50_1dArr = SMA.calculate({ period: 50, values: dailyCloses });
                    const sma200_1dArr = SMA.calculate({ period: 200, values: dailyCloses });

                    if (sma50_1dArr.length > 0 && sma200_1dArr.length > 0) {
                        const sma50_1d = sma50_1dArr[sma50_1dArr.length - 1];
                        const sma200_1d = sma200_1dArr[sma200_1dArr.length - 1];
                        const dPrice = dailyCloses[dailyCloses.length - 1];

                        if (direction === 'LONG') {
                            if (sma50_1d > sma200_1d && dPrice > sma200_1d) {
                                qualityScore += 10; warnings.push('1D Golden Cross (+10)');
                            } else if (sma50_1d < sma200_1d) {
                                qualityScore -= 10; warnings.push('1D Death Cross (-10)');
                            }
                        } else if (direction === 'SHORT') {
                            if (sma50_1d < sma200_1d && dPrice < sma200_1d) {
                                qualityScore += 10; warnings.push('1D Bear Cross (+10)');
                            } else if (sma50_1d > sma200_1d) {
                                qualityScore -= 10; warnings.push('1D Golden Reject (-10)');
                            }
                        }
                    }
                }
            } catch (e) { } // Hata olursa es geç
        }

        // --- YENİ V2.6: PORTFOLIO CORRELATION FILTER (-12 Puan Cezası) ---
        try {
            const activeTrades = await db.all("SELECT symbol, type FROM user_trades WHERE status = 'ACTIVE'");
            const cryptoMajors = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];

            if (cryptoMajors.includes(sym)) {
                let sameGrpCount = activeTrades.filter(t => cryptoMajors.includes(t.symbol) && t.type === direction).length;
                if (sameGrpCount >= 2) {
                    qualityScore -= 12;
                    warnings.push(`Diversity Penalty (Too many active ${direction} in Majors) (-12)`);
                }
            }
        } catch (e) { }

        // --- OPTIONS GAMMA WALL & MAX PAIN (SADECE VARLIKLAR İÇİN) ---
        if (symbolInfo && symbolInfo.isAsset) { // Kriptolarda çalışmaz
            try {
                // Şimdilik sadece AAPL, TSLA, NASDAQ testi yapıyoruz
                const allowedOptionsTests = ['AAPL', 'TSLA', 'NVDA', 'NQ=F', 'QQQ', 'SPY'];
                if (allowedOptionsTests.includes(sym)) {
                    const optEdge = await analyzeOptionsFlow(sym, currentPrice);
                    if (optEdge) {
                        let optionsConfluence = 0;

                        // 1. Put/Call Ratio Yorumu
                        if (direction === 'LONG' && optEdge.pcr > 1.2) {
                            qualityScore += 10; optionsConfluence++; warnings.push(`Aşırı Put Yazılmış (PCR ${optEdge.pcr}) -> LONG Squeeze (+10)`);
                        } else if (direction === 'SHORT' && optEdge.pcr < 0.8) {
                            qualityScore += 10; optionsConfluence++; warnings.push(`Aşırı Call Yazılmış (PCR ${optEdge.pcr}) -> SHORT Baskısı (+10)`);
                        }

                        // 2. Max Pain Çekimi (+8)
                        const distToMaxPain = Math.abs(currentPrice - optEdge.maxPain) / currentPrice;
                        if (distToMaxPain > 0.01 && distToMaxPain < 0.08) { // %1 ile %8 arası uzaktaysa mıknatıs çalışır
                            if (direction === 'LONG' && optEdge.maxPain > currentPrice) {
                                qualityScore += 8; optionsConfluence++; warnings.push(`Max Pain Çekimi (${optEdge.maxPain}) (+8)`);
                            } else if (direction === 'SHORT' && optEdge.maxPain < currentPrice) {
                                qualityScore += 8; optionsConfluence++; warnings.push(`Max Pain Çekimi (${optEdge.maxPain}) (+8)`);
                            }
                        }

                        // 3. Gamma Wall Destek/Direnci (+7)
                        if (direction === 'LONG' && optEdge.putWall > 0 && currentPrice < optEdge.putWall * 1.05 && currentPrice > optEdge.putWall) {
                            qualityScore += 7; optionsConfluence++; warnings.push(`Put Wall Desteği (${optEdge.putWall}) (+7)`);
                        } else if (direction === 'SHORT' && optEdge.callWall > 0 && currentPrice > optEdge.callWall * 0.95 && currentPrice < optEdge.callWall) {
                            qualityScore += 7; optionsConfluence++; warnings.push(`Call Wall Direnci (${optEdge.callWall}) (+7)`);
                        }

                        // Confluence Bonusu (2 veya daha fazla options kuralı tutarsa +5 ekstra)
                        if (optionsConfluence >= 2) {
                            qualityScore += 5; warnings.push(`💎 Kurumsal Opsiyon Confluence Bonusu (+5)`);
                        }
                    }
                }
            } catch (err) { }
        }

        // 6. RISK / REWARD (R:R) HESAPLAMASI & 1:3 CAP
        let targetP = eq;
        let dynamicStop = 0;
        let risk = 0, reward = 0;
        let slMultiplier = (sym === 'XAUUSD' || sym === 'XAGUSD' || sym === 'USOIL') ? 2.5 : 1.5;

        // Gap Fill Analysis for Stocks & Commodities
        let hasGap = false;
        let gapTarget = 0;
        if (sym === 'AAPL' || sym === 'TSLA' || sym === 'NASDAQ' || sym === 'XAUUSD' || sym === 'XAGUSD' || sym === 'USOIL') {
            for (let g = 1; g < 15; g++) {
                const gapSize = opens[closes.length - g] - closes[closes.length - g - 1];
                if (direction === 'LONG' && gapSize < -(currentPrice * 0.005)) { // Gap down
                    hasGap = true; gapTarget = closes[closes.length - g - 1]; break;
                } else if (direction === 'SHORT' && gapSize > (currentPrice * 0.005)) { // Gap up
                    hasGap = true; gapTarget = closes[closes.length - g - 1]; break;
                }
            }

            // DXY Gap Confluence Bonus iptal edildi
        }

        if (direction === 'LONG') {
            dynamicStop = currentPrice - (currentATR * slMultiplier);
            risk = currentPrice - dynamicStop;

            // Hedef: Bayrak varsa Kırılım + Direk Boyu, yoksa EQ Likidite Noktası
            targetP = hasFlagPennant ? (currentPrice + poleSize) : eq;

            // Hisselerde Gap Fill Hedefi
            if (hasGap && gapTarget > currentPrice) {
                targetP = gapTarget;
                warnings.push('Gap Fill TP Target Set');
            }

            // FVG varsa hedefi daraltma
            if (hasFVG && targetP > currentPrice + (currentPrice * 0.02)) {
                targetP = currentPrice + (currentPrice * 0.02); // Minimum FVG safe zone
            }

            reward = targetP - currentPrice;

            // 1:3 R:R Cap Uyumlu Kesinti (Tıraşlama)
            let maxReward = risk * 3.0; // Max 3x SL Limits
            if (reward > maxReward) {
                reward = maxReward;
                targetP = currentPrice + reward;
                warnings.push('TP Capped (1:3 Max)');
            }
        } else {
            dynamicStop = currentPrice + (currentATR * slMultiplier);
            risk = dynamicStop - currentPrice;

            targetP = hasFlagPennant ? (currentPrice - poleSize) : eq;

            if (hasGap && gapTarget < currentPrice) {
                targetP = gapTarget;
                warnings.push('Gap Fill TP Target Set');
            }

            if (hasFVG && targetP < currentPrice - (currentPrice * 0.02)) {
                targetP = currentPrice - (currentPrice * 0.02);
            }

            reward = currentPrice - targetP;

            // 1:3 R:R Cap
            let maxReward = risk * 3.0;
            if (reward > maxReward) {
                reward = maxReward;
                targetP = currentPrice - reward;
                warnings.push('TP Capped (1:3 Max)');
            }
        }


        let riskPct = (risk / currentPrice) * 100;
        
        // PERISKOP RISK MATRIX: Kademeli Filtreleme
        // 1. Maksimum SL % Kesicisi
        if (riskPct > CONFIG.maxSlPct) {
            return null; 
        }

        // 2. Dinamik R:R Talebi
        let requiredRR = CONFIG.minRR;
        if (riskPct > CONFIG.premiumSlThreshold) {
            requiredRR = CONFIG.premiumRR;
            warnings.push(`Premium RR Required (>%${CONFIG.premiumSlThreshold} Risk)`);
        }

        let requiredReward = risk * requiredRR;

        let organicRR = risk > 0 ? (reward / risk) : 0; // Doğal hedef R:R'si

        // 3. Mevcut analiz (EQ, FVG) hedefi, requiredReward'ın altındaysa hedefi esnet/uzat
        if (reward < requiredReward) {
            reward = requiredReward;
            if (direction === 'LONG') targetP = currentPrice + reward;
            else targetP = currentPrice - reward;
            warnings.push(`Target Extended to ${requiredRR}R`);
        }

        let finalRR = risk > 0 ? (reward / risk) : 0;
        breakdown.rr = parseFloat(finalRR.toFixed(2));

        // R:R Bonusu Kaldırıldı (Saf PA Kalitesi İçin)

        // Genel RR filtresi (Safety Check)
        if (finalRR < requiredRR) return null; 

        // --- PERPLEXITY ELITE FILTER (v2.0) + CHATGPT SWEEP/ENGULFING ---
        let currentJ = closes.length - 1;

        // BÖLÜM A: TETİKLEME (Kurşun) Slotu -> Maksimum +20 Puan (Wick veya Engulfing)
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

        // Tetik Slotu Kararı (İkisi de 20 puandır, toplanmaz)
        if (hasKillerWick || hasEngulfing) {
            qualityScore += 20;
            if (hasKillerWick && hasEngulfing) {
                warnings.push('Tetikleyici: Wick + Engulfing Confluence (+20)');
            } else if (hasKillerWick) {
                warnings.push('Tetikleyici: Killer Wick (+20)');
            } else {
                warnings.push('Tetikleyici: Kurumsal Engulfing (+20)');
            }
        }

        // BÖLÜM B: TUZAK (Context) Slotu -> Hacim ve Likidite
        // 3. Liquidity Sweep (Stop Patlatma Mıknatısı) -> +15 Puan
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
            warnings.push('Tuzak: Liquidity Sweep (Stop Temizliği) (+15)');
        }

        // 4. Volume Shelter (Hacim Sığınağı) -> +12 Puan
        let shortTermVolAvg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        let lastVol = volumes[currentJ];
        if (direction === 'LONG' && lastVol < shortTermVolAvg * 0.9 && closes[currentJ] < opens[currentJ]) {
            qualityScore += 12;
            warnings.push('Tuzak: Volume Shelter (Zayıf Satış) (+12)');
        } else if (direction === 'SHORT' && lastVol < shortTermVolAvg * 0.9 && closes[currentJ] > opens[currentJ]) {
            qualityScore += 12;
            warnings.push('Tuzak: Volume Shelter (Zayıf Alış) (+12)');
        }
        // --- END PERPLEXITY & CHATGPT FILTER ---

        // SONUÇ: TETİKLENME (TRIGGER) - MIXED SCORE SİSTEMİ
        // Eski Sınırlar: LONG 55 | SHORT CONFIG.minScore (55)
        // if (direction === 'LONG' && qualityScore < 55) return null;
        // if (direction === 'SHORT' && qualityScore < CONFIG.minScore) return null;

        // V2.9 (Zodyak Elite) Yeni Acımasız Barajlar (RR Hariç Saf PA Barajı 65 Seçildi)
        if (direction === 'LONG' && qualityScore < 65) {
            return null;
        }
        if (direction === 'SHORT' && qualityScore < 65) {
            return null;
        }

        // Log the detailed summary to console exactly as requested for Backtesting
        console.log(JSON.stringify({
            symbol: sym,
            direction,
            qualityScore,
            breakdown,
            warnings
        }, null, 2));

        return {
            symbol: sym,
            type: direction,
            entryPrice: currentPrice,
            targetPrice: targetP,
            stopPrice: dynamicStop,
            qualityScore: qualityScore,
            warnings: JSON.stringify(warnings),
            macroState: globalMarketState,
            breakdown: breakdown,
            isAsset: symbolInfo.isAsset || false
        };
    } catch (e) {
        // console.error(e);
    }
    return null;
}
let isScanning = false;

async function runScan() {
    if (isScanning) {
        console.log('[SCANNER] Tarama zaten devam ediyor, atlanıyor...');
        return;
    }
    isScanning = true;

    try {
        console.log('[SCANNER] Starting BingX pairs scan for new signals...');

        // 2. Yeni pariteleri tara (Kripto + TradFi Dynamic Engine)
        const { cryptoPairs, tradFiAssets } = await getUsdtPairsAndAssets();
        
        // Akıllı Mesai Kalkanı (Istanbul Timezone: 15:30 - 23:00)
        const istanbulTimeStr = new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" });
        const istDate = new Date(istanbulTimeStr);
        const day = istDate.getDay();
        const hour = istDate.getHours();
        const minute = istDate.getMinutes();
        
        const isWeekend = day === 0 || day === 6;
        const timeInMinutes = hour * 60 + minute;
        // 15:30 -> 15*60 + 30 = 930
        // 23:00 -> 23*60 = 1380
        const isInstitutionalHours = timeInMinutes >= 930 && timeInMinutes <= 1380;
        
        const isActiveTradFiSession = !isWeekend && isInstitutionalHours;
        const assetsToScan = isActiveTradFiSession ? tradFiAssets : [];

        const allPairs = [...cryptoPairs, ...assetsToScan];
        console.log(`[SCANNER] Found ${cryptoPairs.length} USDT pairs and ${assetsToScan.length} assets to scan${!isActiveTradFiSession ? ' (TradFi Sleep Mode)' : ''}.`);

        let signalCount = 0;

        for (let i = 0; i < allPairs.length; i++) {
            const symbolInfo = allPairs[i];
            const symbol = typeof symbolInfo === 'string' ? symbolInfo : symbolInfo.symbol;

            // Aktif sinyali olan coini tekrar tarayıp yeni sinyal üretmeye gerek yok (Spam önleme)
            const existingActive = await db.get("SELECT id FROM signals WHERE symbol = ? AND status = 'ACTIVE'", [symbol]);
            if (existingActive) continue;

            const signal = await analyzeCoin(symbolInfo);
            if (signal) {
                let formattedVol = '-';
                if (signal.breakdown && signal.breakdown.globalVol) {
                    formattedVol = (signal.breakdown.globalVol / 1000000).toFixed(1) + 'M';
                }
                const volumeTextForDb = signal.breakdown && signal.breakdown.rvol ? `${formattedVol} (${signal.breakdown.rvol}x)` : formattedVol;
                
                // +--- SHADOW BLOCK CHECK (AI MEMORY) ---+
                let isBlocked = false;
                let blockReason = "";
                let blockLessonId = null;

                try {
                    const activeLessons = await db.all("SELECT * FROM ai_lessons WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 15");
                    
                    if (activeLessons && activeLessons.length > 0) {
                        const lessonsText = activeLessons.map(l => `[Ders ID: ${l.id}] - ${l.lessonText}`).join('\n');
                        const prompt = `Sen PeriskopAI Otonom Fon Yöneticisisin. Sana geçmişteki zararlarımızdan çıkardığımız "KARA LİSTE" dersleri ve şu an girmeyi planladığımız GÜNCEL BİR SİNYAL gönderiyorum.
                        
AKTİF DERSLER (Hafıza):
${lessonsText}

GÜNCEL SİNYAL GİRİŞ HARİTASI:
Varlık: ${signal.symbol}
Yön: ${signal.type}
Toplam Kalite Skoru: ${signal.qualityScore}
Grafik Bileşenleri (Uyarılar): ${signal.warnings}

Soru: Yeni oluşan bu sinyal, Aktif Derslerdeki bir hataya/tuzağa çok benziyor mu?
Eğer bu işlemi RİSKLİ/HATALI buluyorsan ve engellemek istiyorsan sadece "ENGEL: [Hangi Ders ID'si nedeniyle engellediğini ve 1 kısa Cümle Sebebini Yaz]" formatında cevap ver.
Eğer derslerden biriyle doğrudan çelişmiyorsa sadece "ONAY" yaz.`;

                        const blockRes = await aiModel.generateContent(prompt);
                        const blockText = blockRes.response.text();
                        
                        if (blockText.includes("ENGEL:")) {
                            isBlocked = true;
                            blockReason = blockText.split("ENGEL:")[1].trim();
                            const match = blockText.match(/Ders ID:?\s*(\d+)/i) || blockText.match(/Ders.(\d+)/i);
                            if (match) blockLessonId = parseInt(match[1]);
                        }
                    }
                } catch (err) {
                    console.error("[SHADOW] Error checking AI memory:", err.message);
                }

                if (isBlocked) {
                    console.log(`[SHADOW BLOCK] Sinyal Engellendi: ${signal.symbol} -> ${blockReason}`);
                    await db.run(
                        "INSERT INTO shadow_trades (symbol, type, entryPrice, targetPrice, stopPrice, lessonId, qualityScore) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        [signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice, blockLessonId, signal.qualityScore]
                    );

                    // Telegram Admin'e Uyarı Gönder
                    if (bot && CONFIG.telegramAdminId) {
                        bot.sendMessage(CONFIG.telegramAdminId, `🤖 *Otonom Ajan Sinyali Reddetti (Shadow Mode)* 🤖\n\n🎯 *Parite:* #${signal.symbol} (${signal.type})\n⛔ *Sebep:* ${blockReason}\n\nBu sinyal veritabanına ve gruba düşmedi. Sadece gölge modunda arka planda PnL takibine alındı.`, { parse_mode: 'Markdown' });
                    }
                    continue; // Skip DB insertion and everything else
                }
                // +--- END SHADOW BLOCK ---+

                const insertResult = await db.run(
                    "INSERT INTO signals (symbol, type, entryPrice, targetPrice, stopPrice, qualityScore, warnings, rvol) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice, signal.qualityScore, signal.warnings, volumeTextForDb]
                );
                const signalId = insertResult.id;
                console.log(`[SCANNER] New ${signal.type} signal for ${signal.symbol}! ID: ${signalId}`);

                // Google Sheets'e Yaz
                try {
                    const dateStr = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
                    const tpPercent = signal.type === 'LONG' ? ((signal.targetPrice - signal.entryPrice) / signal.entryPrice) * 100 : ((signal.entryPrice - signal.targetPrice) / signal.entryPrice) * 100;
                    const slPercent = signal.type === 'LONG' ? ((signal.entryPrice - signal.stopPrice) / signal.entryPrice) * 100 : ((signal.stopPrice - signal.entryPrice) / signal.entryPrice) * 100;

                    let macroPrefix = "";
                    if (signal.macroState) {
                        macroPrefix = `[BTC: ${signal.macroState.btcTrend}, ETH: ${signal.macroState.ethTrend}] - `;
                    }
                    const combinedWarnings = macroPrefix + (signal.warnings || "");

                    let formattedVolSheet = '-';
                    if (signal.breakdown && signal.breakdown.globalVol) {
                        formattedVolSheet = (signal.breakdown.globalVol / 1000000).toFixed(1) + 'M';
                    }
                    const volumeTextSheet = signal.breakdown && signal.breakdown.rvol ? `${formattedVolSheet} (${signal.breakdown.rvol}x)` : formattedVolSheet;

                    await appendToSheet([
                        dateStr,
                        signal.symbol,
                        signal.qualityScore || 0,
                        signal.type,
                        `%${tpPercent.toFixed(2)}`,
                        `%${slPercent.toFixed(2)}`,
                        'ACTIVE',
                        combinedWarnings,
                        signalId,
                        volumeTextSheet
                    ]);
                } catch (err) {
                    console.error("[SHEETS] Sinyal tabloya yazılamadı:", err);
                }

                // --- AUTO TRADING BLOCK START ---
                if (process.env.BINGX_API_KEY && process.env.PERISKOP_TELEGRAM_ID && !symbolInfo.isAsset) {
                    try {
                        const activeCountRes = await db.get("SELECT COUNT(*) as count FROM user_trades WHERE status = 'ACTIVE'");
                        const activeCount = activeCountRes ? activeCountRes.count : 0;

                        if (activeCount >= CONFIG.maxActiveTrades) {
                            console.log(`[AUTO-TRADE] Limit (${CONFIG.maxActiveTrades}) dolu! Sinyal ${signal.symbol} havuza eklendi.`);
                        } else {
                            // Aynı gün içinde aynı coine girildi mi? (Sinyal 2. veya 3. kez mi düşüyor?)
                            const todayStr = new Date().toISOString().split('T')[0];
                            const existingSignalsToday = await db.all(
                                "SELECT id FROM signals WHERE symbol = ? AND date(createdAt) = ?",
                                [signal.symbol, todayStr]
                            );

                            // Şu anki sinyali havuza yeni attığımız için ilk sinyalin length'i 1 olur. 1'den büyükse 2. veya 3. kez geliyordur.
                            if (existingSignalsToday.length <= 1) {
                                console.log(`[AUTO-TRADE] Borsaya Emir Gönderiliyor: ${signal.symbol}`);
                                try {
                                    const orderId = await placeOrder(signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice);
                                    if (orderId) {
                                        await db.run(
                                            "INSERT INTO user_trades (telegramId, signalId, symbol, type, entryPrice, targetPrice, stopPrice, status, bybitOrderId) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)",
                                            [process.env.PERISKOP_TELEGRAM_ID, signalId, signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice, orderId]
                                        );

                                        // Ekranda favori yıldızı yanması için standart tabloya da yaz
                                        const checkFav = await db.get("SELECT id FROM favorites WHERE telegramId = ? AND signalId = ?", [process.env.PERISKOP_TELEGRAM_ID, signalId]);
                                        if (!checkFav) {
                                            await db.run("INSERT INTO favorites (telegramId, signalId) VALUES (?, ?)", [process.env.PERISKOP_TELEGRAM_ID, signalId]);
                                        }
                                        console.log(`[AUTO-TRADE] Başarılı! Favorilere kayıt edildi.`);
                                    }
                                } catch (e) {
                                    console.error(`[AUTO-TRADE] Borsa Emir İletim Hatası:`, e.message);
                                }
                            } else {
                                console.log(`[AUTO-TRADE] Atlandı: ${signal.symbol} için bugün önceden sinyal üretilmiş (${existingSignalsToday.length}. kez geliyor). Sadece panele yansıtıldı.`);
                            }
                        }
                    } catch (e) {
                        console.error("[AUTO-TRADE] Hata:", e.message);
                    }
                }
                // --- AUTO TRADING BLOCK END ---

                if (telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
                    try {
                        const hasFlag = Array.isArray(signal.warnings) ? signal.warnings.some(w => w.includes('Flag')) : (signal.warnings && signal.warnings.includes('Flag'));
                        const flagPart = hasFlag ? `🔥 Formasyon: Bayrak/Flama Modeli Tespit Edildi, +10 Kalite Puanı eklendi.\n\n` : `\n`;
                        const categoryTag = signal.isAsset ? '[VARLIKLAR (FX/Emtia)]' : '[KRİPTO]';
                        const msg = `🚨 *Elyte Sinyal Uygulaması Üzerinde '${categoryTag}' Kategorisinde Yeni Bir Sinyal Düştü!*\n\n` +
                            `⭐ Kalite Skoru: *${signal.qualityScore}*\n` +
                            `🎯 Yön: *${signal.type}*\n` + flagPart +
                            `_Detaylar ve seviyeler için Elyte aplikasyonuna girebilirsiniz..._ 🔭\n\n` +
                            `🔗 Web Platformu:\nhttps://www.elytesignals.com/dashboard`;
                        telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, msg, { parse_mode: 'Markdown' });
                    } catch (e) {
                        console.error("Telegram send signal failed:", e.message);
                    }
                }

                signalCount++;
            }

            // Rate limit'i aşmamak için her istek arası 100ms bekle (1 saniyede 10 istek, limite çok uzak)
            await delay(100);
        }

        console.log(`[SCANNER] Scan complete. Found ${signalCount} new signals.`);
    } finally {
        isScanning = false;
    }
}
async function sendNightlyReport() {
    console.log('[SCANNER] Generating Nightly Quality Score Report...');
    try {
        let yesterdaysDate = new Date();
        // UTC'de olduğumuz varsayımı ile: dünü almak için
        yesterdaysDate.setDate(yesterdaysDate.getDate() - 1);
        const dayString = yesterdaysDate.toISOString().split('T')[0];

        const allSignals = await db.all("SELECT qualityScore, status, symbol FROM signals WHERE date(createdAt) = ?", [dayString]);

        const detailedData = {};
        let totalWins = 0; let totalLosses = 0; let totalActive = 0;

        allSignals.forEach(s => {
            if (!detailedData[s.qualityScore]) detailedData[s.qualityScore] = { WIN: 0, LOSS: 0, ACTIVE: 0 };
            detailedData[s.qualityScore][s.status]++;
            if (s.status === 'WIN') totalWins++;
            if (s.status === 'LOSS') totalLosses++;
            if (s.status === 'ACTIVE') totalActive++;
        });

        let totalClosed = totalWins + totalLosses;
        let winRate = totalClosed > 0 ? ((totalWins / totalClosed) * 100).toFixed(1) : 0;

        // Sabit her sinyale 30$ kasa attıysak PnL hesabı
        // Basitçe: her Win %3 kar (yaklaşık), her Loss %1.5 zarar = spotta. vs..
        // Tam rakamlar için Price hesabı eklemedik ama kaba Karşılaştırma verebiliriz.
        let totalSignalsOfDayLog = totalWins + totalLosses + totalActive;

        let reportText = `🤖 *Periskop AI - Gün Sonu Özeti*\n`;
        reportText += `📅 *Tarih:* ${dayString}\n\n`;
        reportText += `📈 *Günlük İstatistikler:*\n`;
        reportText += `📊 Toplam İşlem: ${totalSignalsOfDayLog}\n`;
        reportText += `✅ Başarılı: ${totalWins} İşlem\n`;
        reportText += `⛔ Stop: ${totalLosses} İşlem\n`;
        reportText += `⏳ Açık: ${totalActive} İşlem\n`;
        reportText += `🎯 *Başarı Oranı: %${winRate}*\n\n`;

        let scores = Object.keys(detailedData).sort((a, b) => b - a);
        if (scores.length === 0) {
            reportText += `Dün piyasada pozisyon açılmadı.\n\n`;
        }

        reportText += `_Elyte Signals Otomasyonu ile 03:00'te üretilmiştir._\n\n`;

        // YEDEKLEME İŞLEMİ (Mesajı Gece Raporuna Göm)
        try {
            const backupMessage = await backupSystem();
            reportText += backupMessage;
        } catch (backupErrorStr) {
            reportText += backupErrorStr;
        }

        if (telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
            await telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, reportText, { parse_mode: 'Markdown' });
            console.log('[SCANNER] Nightly report & Backup status successfully sent to Telegram.');
        }

        // --- GOOGLE SHEETS YEDEKLEME (Yeni Yapı) ---
        try {
            const rowsToInsert = [];
            let totalSignalsOfDay = totalWins + totalLosses + totalActive;
            let dayClosed = totalWins + totalLosses;
            let dayWrStr = dayClosed > 0 ? ((totalWins / dayClosed) * 100).toFixed(1) + '%' : '-';

            const ALL_SCORES = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

            for (let i = 0; i < ALL_SCORES.length; i++) {
                let score = ALL_SCORES[i];
                let data = detailedData[score] || { WIN: 0, LOSS: 0, ACTIVE: 0 };
                let scoreTotal = data.WIN + data.LOSS + data.ACTIVE;
                let closed = data.WIN + data.LOSS;
                let wr = closed > 0 ? ((data.WIN / closed) * 100).toFixed(1) + '%' : '-';

                if (i === 0) {
                    rowsToInsert.push([
                        score,                 // Skor Puanı
                        scoreTotal,            // Sinyal Sayısı
                        data.WIN,              // TP
                        data.LOSS,             // SL
                        wr,                    // WR
                        totalSignalsOfDay,     // Toplam Sinyal Sayısı
                        dayString,             // Tarih
                        dayWrStr               // Günlük Toplam WR
                    ]);
                } else {
                    rowsToInsert.push([
                        score,                 // Skor Puanı
                        scoreTotal,            // Sinyal Sayısı
                        data.WIN,              // TP
                        data.LOSS,             // SL
                        wr,                    // WR
                        "",                    // Toplam Sinyal Sayısı (Boş)
                        "",                    // Tarih (Boş)
                        ""                     // Günlük Toplam WR (Boş)
                    ]);
                }
            }

            if (rowsToInsert.length > 0) {
                const googleApi = require('./google-api');
                await googleApi.appendToSheet(rowsToInsert, 'REPORT');
            }
        } catch (e) {
            console.error('[SCANNER] Google Sheets entegrasyon hatası:', e.message);
        }

    } catch (error) {
        console.error('[SCANNER] Send Nightly Report Error: ', error);
    }
}

function backupSystem() {
    return new Promise((resolve, reject) => {
        console.log('[SCANNER] Starting nightly system backup to Server...');
        try {
            const dateStr = new Date().toISOString().split('T')[0];
            const path = require('path');

            // AWS veya lokal fark etmeksizin root dizinini bul
            const sourceFolder = __dirname;
            const backupDir = path.join(__dirname, '..', 'backups');
            const backupFolder = path.join(backupDir, `ElyteSignal_Backup_${dateStr}`);

            // Klasörü yarat ve yedekle
            const cmd = `mkdir -p "${backupFolder}" && rsync -av --exclude="node_modules" --exclude=".git" --exclude=".expo" "${sourceFolder}/" "${backupFolder}/"`;
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.error('[SCANNER] Backup Failed:', error.message);
                    reject(`⚠️ *Elyte Sistem Yedekleme Hatası!*\n\`${error.message}\``);
                    return;
                }
                console.log(`[SCANNER] Backup successfully created at: ${backupFolder}`);
                resolve(`📦 *Sistem Yedeği Başarıyla Alındı!*\nKlasör: \`${backupFolder}\`\nDostum, kodların ve sistemin her gece olduğu gibi güvenli sunucu dizinine yedeklendi! 🫡`);
            });
        } catch (e) {
            console.error('[SCANNER] Backup Exception:', e);
            reject(`⚠️ *Elyte Sistem Yedekleme Hatası!*\n\`${e.message}\``);
        }
    });
}

function startScanner() {
    // 1. Aktif pozisyonların Stop/TP durumlarını HER DAKİKA kontrol et
    cron.schedule('* * * * *', () => {
        checkActiveSignals();
    });

    // 2. Yeni sinyal yakalama algoritmasını 5 DAKİKADA BİR çalıştır (Agresif Mid-Hour CHoCH Tespiti)
    cron.schedule('*/5 * * * *', () => {
        runScan();
    });

    // 2.5 Global Market Sensörünü 15 DAKİKADA BİR (Farklı dakikada) çalıştır
    cron.schedule('5,20,35,50 * * * *', () => {
        analyzeGlobalMarket();
    });

    // 3. Gece 03:00'da (Türkiye Saati ile Gün Kapanışı) gecelik rapor yolla ve yedekle (Birleşik Mesaj)
    cron.schedule('0 3 * * *', () => {
        sendNightlyReport();
    }, {
        scheduled: true,
        timezone: "Europe/Istanbul"
    });

    // Uygulama ilk açıldığında da 1 kez çalışsın
    // Çakışmayı ve birden fazla instancesi engellemek için timeout
    setTimeout(() => {
        analyzeGlobalMarket().then(() => {
            checkActiveSignals();
            runScan();
        });
    }, 2000);
}

module.exports = {
    startScanner,
    sendNightlyReport,
    backfillTrades,
    setBot: (b) => telegramBot = b,
    getGlobalMarketState: () => globalMarketState
};
