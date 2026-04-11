const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { RSI, SMA, ATR, ADX } = require('technicalindicators');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

let ai = null;
if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass();
const cron = require('node-cron');
const { runDailyScreener } = require('./screener_engine');
const { fetchAndProcessNews } = require('./news_agent');

// Her 30 dakikada bir Kantan.news istihbaratını çalıştır
cron.schedule('*/30 * * * *', () => {
    console.log("[CRON] Kantan News Agent İstihbarat Taraması Başlıyor...");
    fetchAndProcessNews();
});
global.nasdaqCache = {
    appetite: "Risk On (Güçlü Boğa)", 
    stocks: [
        { symbol: "NVDA", price: 880.50, pe: 72.4, trailingPE: 80.2, pegRatio: 1.2, epsGrowth: 45.3, debtToEquity: 12.5, totalDebt: 10500000000, redFlag: false, score: 9.5, daily: 2.4, weekly: 12.1, monthly: 24.5, volume: "Aşırı Yüksek", instFlow: "Güçlü Alım" },
        { symbol: "AAPL", price: 175.20, pe: 28.5, trailingPE: 26.4, pegRatio: 2.1, epsGrowth: 5.2, debtToEquity: 145.3, totalDebt: 105000000000, redFlag: false, score: 1.2, daily: 0.5, weekly: 2.1, monthly: -1.2, volume: "Normal", instFlow: "Nötr" },
        { symbol: "MSFT", price: 420.10, pe: 35.8, trailingPE: 38.5, pegRatio: 1.8, epsGrowth: 15.6, debtToEquity: 45.2, totalDebt: 75000000000, redFlag: false, score: 1.6, daily: 1.2, weekly: 4.5, monthly: 8.2, volume: "Yüksek", instFlow: "Alım" },
        { symbol: "AMZN", price: 185.60, pe: 42.1, trailingPE: 55.4, pegRatio: 1.5, epsGrowth: 28.4, debtToEquity: 85.6, totalDebt: 135000000000, redFlag: false, score: 1.8, daily: -0.3, weekly: 3.2, monthly: 15.4, volume: "Yüksek", instFlow: "Güçlü Alım" },
        { symbol: "META", price: 510.30, pe: 26.4, trailingPE: 28.1, pegRatio: 1.1, epsGrowth: 32.5, debtToEquity: 22.4, totalDebt: 18000000000, redFlag: false, score: 2.1, daily: 1.8, weekly: -2.1, monthly: 10.5, volume: "Orta", instFlow: "Alım" },
        { symbol: "GOOGL", price: 154.80, pe: 24.2, trailingPE: 26.5, pegRatio: 1.3, epsGrowth: 12.8, debtToEquity: 18.5, totalDebt: 28000000000, redFlag: false, score: 1.5, daily: 0.8, weekly: 1.5, monthly: 6.8, volume: "Orta", instFlow: "Nötr" },
        { symbol: "TSLA", price: 170.50, pe: 55.2, trailingPE: 62.4, pegRatio: 3.4, epsGrowth: -15.2, debtToEquity: 8.5, totalDebt: 5500000000, redFlag: true, score: 0.8, daily: -3.2, weekly: -12.5, monthly: -22.1, volume: "Yüksek", instFlow: "Satış" },
        { symbol: "PLTR", price: 23.40, pe: 82.1, trailingPE: 95.2, pegRatio: 2.8, epsGrowth: 18.5, debtToEquity: 5.2, totalDebt: 1200000000, redFlag: true, score: 1.1, daily: 4.5, weekly: 18.2, monthly: 45.6, volume: "Aşırı Yüksek", instFlow: "Spekülatif Alım" },
        { symbol: "AVGO", price: 1320.50, pe: 38.5, trailingPE: 42.1, pegRatio: 1.6, epsGrowth: 22.4, debtToEquity: 110.5, totalDebt: 45000000000, redFlag: false, score: 2.3, daily: 1.1, weekly: 5.4, monthly: 12.8, volume: "Yüksek", instFlow: "Alım" }
    ]
};

async function fetchNasdaqData() {
    console.log("[Nasdaq] Canlı veriler çekiliyor...");
    
    // DB'den dinamik olarak mevcut hisseleri al, benzersiz sembolleri topla
    let dbTickers = [];
    if (typeof db !== 'undefined' && db.all) {
        try {
            const rows = await db.all("SELECT symbol FROM portfolio_assets WHERE allocatedPercentage > 0 OR pendingPercentage > 0");
            if (rows) dbTickers = rows.map(r => r.symbol);
        } catch (e) {
            console.error("DB symbol fetch error inside fetchNasdaqData", e);
        }
    }

    const baseTickers = ["NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "TSLA", "PLTR", "AVGO", "XAR", "KTOS"];
    const nasdaqTickers = [...new Set([...baseTickers, ...dbTickers])];
    
    const updatedStocks = [];

    for (const symbol of nasdaqTickers) {
        try {
            const res = await yahooFinance.quoteSummary(symbol, { modules: ['price', 'defaultKeyStatistics', 'financialData'] });
            
            const p = res?.price || {};
            const ks = res?.defaultKeyStatistics || {};
            const fd = res?.financialData || {};

            const rawFwdPe = ks.forwardPE || (p.regularMarketPrice / (ks.forwardEps || 1));
            const debtRatio = fd.debtToEquity || 0;
            const redFlag = rawFwdPe > 50 || debtRatio > 120;
            const score = redFlag ? (1 + Math.random()) : (5 + Math.random()*2);

            let volStr = "Normal";
            if (p.regularMarketVolume > 50000000) volStr = "Yüksek";
            if (p.regularMarketVolume > 100000000) volStr = "Aşırı Yüksek";

            // Grab existing static values to not break UI fully where data is missing
            const exStat = global.nasdaqCache.stocks.find(s => s.symbol === symbol) || {};

            updatedStocks.push({
                symbol: symbol,
                price: p.regularMarketPrice ? parseFloat(p.regularMarketPrice.toFixed(2)) : 0,
                pe: rawFwdPe ? parseFloat(rawFwdPe.toFixed(1)) : 0,
                trailingPE: ks.trailingPE ? parseFloat(ks.trailingPE.toFixed(1)) : 0,
                pegRatio: ks.pegRatio ? parseFloat(ks.pegRatio.toFixed(1)) : 0,
                epsGrowth: ks.earningsQuarterlyGrowth ? parseFloat((ks.earningsQuarterlyGrowth * 100).toFixed(1)) : 0,
                debtToEquity: debtRatio ? parseFloat(debtRatio.toFixed(1)) : 0,
                totalDebt: fd.totalDebt || 0,
                redFlag: redFlag,
                score: score.toFixed(1),
                daily: p.regularMarketChangePercent ? parseFloat((p.regularMarketChangePercent * 100).toFixed(2)) : 0,
                weekly: exStat.weekly || 0,
                monthly: exStat.monthly || 0,
                volume: volStr,
                instFlow: exStat.instFlow || "Nötr",
            });
        } catch(e) {
            console.log(`[Nasdaq] ${symbol} çekilirken hata: ${e.message}`);
        }
    }
    
    if (updatedStocks.length > 0) {
        global.nasdaqCache.stocks = updatedStocks;
        console.log(`[Nasdaq] ${updatedStocks.length} Hisse senedi başarıyla güncellendi.`);
        
        // --- OTONOM LİMİT EMİR VE KADEMELİ ALIM KONTROLÜ ---
        if (typeof db !== 'undefined' && db.all) {
            try {
                const pendingAssets = await db.all("SELECT * FROM portfolio_assets WHERE pendingPercentage > 0 AND pendingEntryPrice > 0");
                for (const asset of pendingAssets) {
                    const cacheHit = updatedStocks.find(s => s.symbol === asset.symbol);
                    if (cacheHit && cacheHit.price > 0 && cacheHit.price <= asset.pendingEntryPrice) {
                        // Limit Order Triggered!
                        console.log(`[LIMIT ORDER TETIKLENDI] ${asset.symbol} fiyati hedefe dustu! Fiyat: $${cacheHit.price}, Hedef: $${asset.pendingEntryPrice}`);
                        
                        const currentInvested = (asset.averageCost || cacheHit.price) * (asset.allocatedPercentage || 0);
                        const newInvested = cacheHit.price * asset.pendingPercentage;
                        const newTotalPercentage = (asset.allocatedPercentage || 0) + asset.pendingPercentage;
                        const newAvgCost = (currentInvested + newInvested) / newTotalPercentage;
                        
                        const baseCapital = 1000.00;
                        const newQuantity = (baseCapital * (newTotalPercentage / 100)) / newAvgCost;

                        await db.run(
                            "UPDATE portfolio_assets SET allocatedPercentage = ?, averageCost = ?, quantity = ?, pendingPercentage = 0, pendingEntryPrice = 0 WHERE id = ?",
                            [newTotalPercentage, newAvgCost, parseFloat(newQuantity.toFixed(2)), asset.id]
                        );
                        
                        let telegramBot = null;
                        if (process.env.TELEGRAM_BOT_TOKEN) {
                           const TelegramBot = require('node-telegram-bot-api');
                           telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
                           const msg = `🚨 *YAPAY ZEKA LIMIT EMRİ GERÇEKLEŞTİ!*\n\n[GİZLİ PREMIUM] ${asset.symbol} hissesi AI'ın belirlediği optimal alım bölgesine geriledi ($${cacheHit.price}).\n\nBekleyen *%${asset.pendingPercentage}* ana sermaye dilimi ateşlendi ve varlığın maliyeti başarıyla düşürüldü!\n\n_Daha düşük riskle maksimum kazanca ilerliyoruz._`;
                           telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, msg, { parse_mode: 'Markdown' }).catch(e=>console.log(e));
                        }
                    }
                }
            } catch (e) {
                console.error("Limit order check error", e);
            }
        }
    }
}

// Her 15 dakikada bir nasdaq verilerini güncelle ("*/15 * * * *")
cron.schedule('*/15 * * * *', () => { fetchNasdaqData(); });

// Otonom Kesif Robotu (AI Stock Screener)
// Hafta ici (1-5) her sabah saat 09:00'da ABD piyasalari oncesi devreye girer
cron.schedule('0 9 * * 1-5', () => { 
    console.log("[CRON] 09:00 - AI Otonom Senedi Kesif Robotu Tetiklendi.");
    runDailyScreener(); 
});
// Başlangıçta bir kez çek
setTimeout(() => fetchNasdaqData(), 3000);

const { startScanner, backfillTrades } = require('./scanner');
const { triggerRebalance } = require('./portfolio_engine');
const db = require('./database');
const authRoutes = require('./auth');
const { placeOrder, closePosition } = require('./bingx-trade');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Crypto Signal & Analysis API is running...');
});

// Tüm aktif sinyalleri (ve son kapananları) getiren endpoint
app.get('/api/signals/active', async (req, res) => {
  try {
    const signals = await db.all("SELECT * FROM signals ORDER BY createdAt DESC LIMIT 800");
    
    // Son 24 saatlik periyotta aynı coinden kaç tane geldiğini hesapla (Rolling 24h Window)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const countQuery = await db.all("SELECT symbol, COUNT(*) as count FROM signals WHERE createdAt >= ? GROUP BY symbol", [twentyFourHoursAgo]);
    const counts = {};
    countQuery.forEach(r => counts[r.symbol] = r.count);

    const signalsWithCount = signals.map(s => {
        // Eğer sinyalin kendisi 24 saatten eskiyse onda uyarı gösterme
        const isRecent = new Date(s.createdAt) >= new Date(Date.now() - 24 * 60 * 60 * 1000);
        return {
            ...s,
            dailyCount: isRecent ? (counts[s.symbol] || 1) : 1
        };
    });

    res.json(signalsWithCount);
  } catch (err) {
    res.status(500).json({ error: 'Veritabanı hatası' });
  }
});

// İstatistik Endpoint'i (Sanal Kasa Simülasyonu - 30$ İşlem)
app.get('/api/signals/stats', async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days) : null;
    let timeFilter = "";
    if (days) {
         timeFilter = ` AND createdAt >= datetime('now', '-${days} days')`;
    }
    const signals = await db.all(`SELECT * FROM signals WHERE status IN ('WIN', 'LOSS', 'BREAKEVEN')${timeFilter}`);
    const activeSignals = await db.all(`SELECT * FROM signals WHERE status = 'ACTIVE'`);
    const reachedTwoPercentData = await db.get(`SELECT COUNT(*) as count FROM signals WHERE reachedTwoPercent = 1${timeFilter}`);
    
    // Dinamik kâr/zarar oranları
    let activeLong = 0;
    let activeShort = 0;
    let activeInProfit = 0;
    let activeInLoss = 0;
    let totalActivePnlPercent = 0;

    if (activeSignals.length > 0) {
        try {
            const bybitRes = await axios.get('https://api.bybit.com/v5/market/tickers?category=linear');
            const priceMap = {};
            bybitRes.data.result.list.forEach(t => priceMap[t.symbol] = parseFloat(t.lastPrice));
            
            activeSignals.forEach(s => {
                if (s.type === 'LONG') activeLong++;
                else activeShort++;

                const currentPrice = priceMap[s.symbol];
                if (currentPrice) {
                    const pnl = s.type === 'LONG' 
                        ? ((currentPrice - s.entryPrice) / s.entryPrice) * 100 
                        : ((s.entryPrice - currentPrice) / s.entryPrice) * 100;
                    
                    totalActivePnlPercent += pnl;

                    if (pnl > 0) activeInProfit++;
                    else if (pnl < 0) activeInLoss++;
                }
            });
        } catch(e) {
            console.error("Fiyatlar alınamadı", e.message);
        }
    }
    
    let wins = 0;
    let losses = 0;
    let breakevens = 0;
    let totalProfit = 0;
    let totalWinPercentage = 0;
    let totalLossPercentage = 0;

    signals.forEach(s => {
        const entry = parseFloat(s.entryPrice);
        const target = parseFloat(s.targetPrice);
        const stop = parseFloat(s.stopPrice);
        const R = 10; // 1R = 10$ Risk

        if (isNaN(entry) || isNaN(target) || isNaN(stop) || entry === 0 || stop === 0) return; // Eksik veri atlama

        let percentStop = Math.abs(entry - stop) / entry;
        let percentTarget = Math.abs(target - entry) / entry;
        
        let RR = percentStop > 0 ? (percentTarget / percentStop) : 1;
        if (isNaN(RR) || !isFinite(RR)) RR = 1;

        let realNet = null;
        if (s.netPnlUsd !== null && s.netPnlUsd !== undefined) {
             realNet = parseFloat(s.netPnlUsd);
        }

        if (s.status === 'WIN') {
            wins++;
            totalProfit += realNet !== null ? realNet : (RR * R); // Win gives RR * R OR real net
            if (s.type === 'LONG') {
                totalWinPercentage += ((target - entry) / entry) * 100 * 10;
            } else {
                totalWinPercentage += ((entry - target) / entry) * 100 * 10;
            }
        } else if (s.status === 'LOSS') {
            losses++;
            totalProfit += realNet !== null ? realNet : (-R); // Loss loses 1R OR real net
            if (s.type === 'LONG') {
                totalLossPercentage += ((entry - stop) / entry) * 100 * 10;
            } else {
                totalLossPercentage += ((stop - entry) / entry) * 100 * 10;
            }
        } else if (s.status === 'BREAKEVEN') {
            breakevens++;
            totalProfit += realNet !== null ? realNet : 0;
        }
    });

    res.json({
        totalSignals: signals.length + activeSignals.length,
        closedSignals: signals.length,
        wins,
        losses,
        breakevens,
        totalProfit,
        totalWinPercentage,
        totalLossPercentage,
        winRate: (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0,
        activeLong,
        activeShort,
        activeInProfit,
        activeInLoss,
        totalActivePnlPercent,
        reachedTwoPercentCount: reachedTwoPercentData ? reachedTwoPercentData.count : 0
    });
  } catch (err) {
    res.status(500).json({ error: 'İstatistik hesaplanamadı' });
  }
});

// Geçmiş Sinyaller (WIN veya LOSS) endpoint'i
app.get('/api/signals/history', async (req, res) => {
    try {
        const { status, symbol } = req.query; // 'WIN', 'LOSS' veya 'BREAKEVEN' ve opsiyonel 'symbol'
        let query = "SELECT * FROM signals WHERE status IN ('WIN', 'LOSS', 'BREAKEVEN')";
        let params = [];
        
        if (status) {
            query += " AND status = ?";
            params.push(status);
        }
        
        if (symbol) {
            query += " AND symbol = ?";
            params.push(symbol);
        }
        
        query += " ORDER BY createdAt DESC";

        const signals = await db.all(query, params);
        res.json(signals);
    } catch (err) {
        res.status(500).json({ error: 'Geçmiş alınamadı' });
    }
});

app.post('/api/signals/admin/close', async (req, res) => {
    try {
        const { telegramId, signalId, currentPrice, pnl } = req.body;
        
        if (telegramId !== '1194576674') {
            return res.status(403).json({ error: 'Yetkisiz erişim.' });
        }

        const signal = await db.get("SELECT * FROM signals WHERE id = ?", [signalId]);
        if (!signal) return res.status(404).json({ error: 'Sinyal bulunamadı.' });
        if (signal.status !== 'ACTIVE') return res.status(400).json({ error: 'Sinyal zaten kapalı.' });

        const newStatus = pnl >= 0 ? 'WIN' : 'LOSS';
        
        // Matematiksel bozulmayı engellemek için, anlık fiyata göre update
        if (newStatus === 'WIN') {
            await db.run("UPDATE signals SET status = ?, targetPrice = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [newStatus, currentPrice, signalId]);
        } else {
            await db.run("UPDATE signals SET status = ?, stopPrice = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [newStatus, currentPrice, signalId]);
        }
        
        // Telegram Bildirimi
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_VIP_GROUP_ID) {
            try {
                const isTP = (newStatus === 'WIN');
                let pnlText = `📈 *Manuel Müdahale Neticesi:* Kâr oranı %${pnl.toFixed(2)}`;
                let msg = "";
                
                if (isTP) {
                    msg = `🎯 *TAKE PROFIT (HEDEF VURULDU)!* [${signal.symbol}]\nElyte Sinyali yetkili onayıyla kâr hedefine ulaştırılarak erken kapatıldı.\n\n${pnlText}\n\nPara masadan başarıyla alındı! 💸`;
                } else {
                    msg = `🛑 *STOP LOSS!* [${signal.symbol}]\nİşlem yetkili onayıyla zararı kesmek amacıyla kapatıldı.\n\nRisk yönetimi devrede. 🛡️`;
                }
                
                await require('axios').post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: process.env.TELEGRAM_VIP_GROUP_ID,
                    text: msg,
                    parse_mode: 'Markdown'
                });
            } catch (tgErr) {
                console.error("TG Send Error on Admin Close:", tgErr.message);
            }
        }
        // Google Sheets'te Güncelle
        try {
            const googleApi = require('./google-api');
            if (googleApi.updateSheetSignalStatus) {
                await googleApi.updateSheetSignalStatus(signal.id, newStatus);
            }
        } catch (sheetErr) {
            console.error("Google Sheets update failed on Admin Close:", sheetErr.message);
        }
        
        res.json({ success: true, newStatus });
    } catch (err) {
        console.error("Admin close error:", err);
        res.status(500).json({ error: 'İşlem kapatılırken sunucu hatası.' });
    }
});

const cryptoAliases = {
    "bitcoin": "BTCUSDT", "btc": "BTCUSDT",
    "ethereum": "ETHUSDT", "eth": "ETHUSDT", "ether": "ETHUSDT",
    "solana": "SOLUSDT", "sol": "SOLUSDT",
    "avax": "AVAXUSDT", "avalanche": "AVAXUSDT",
    "xrp": "XRPUSDT", "ripple": "XRPUSDT",
    "doge": "DOGEUSDT", "dogecoin": "DOGEUSDT",
    "shiba": "SHIBUSDT", "shiba inu": "SHIBUSDT", "shib": "SHIBUSDT",
    "pepe": "PEPEUSDT", "link": "LINKUSDT",
    "chainlink": "LINKUSDT", "dot": "DOTUSDT",
    "polkadot": "DOTUSDT", "ada": "ADAUSDT",
    "cardano": "ADAUSDT", "bnb": "BNBUSDT",
    "chiliz": "CHZUSDT", "chz": "CHZUSDT",
    "polygon": "MATICUSDT", "matic": "MATICUSDT",
    "litecoin": "LTCUSDT", "ltc": "LTCUSDT",
    "tron": "TRXUSDT", "trx": "TRXUSDT",
    "uniswap": "UNIUSDT", "uni": "UNIUSDT",
    "cosmos": "ATOMUSDT", "atom": "ATOMUSDT",
    "stellar": "XLMUSDT", "xlm": "XLMUSDT",
    "monero": "XMRUSDT", "xmr": "XMRUSDT",
    "algorand": "ALGOUSDT", "algo": "ALGOUSDT",
    "vechain": "VETUSDT", "vet": "VETUSDT",
    "decentraland": "MANAUSDT", "mana": "MANAUSDT",
    "aptos": "APTUSDT", "apt": "APTUSDT",
    "arbitrum": "ARBUSDT", "arb": "ARBUSDT",
    "near": "NEARUSDT"
};

const assetAliases = {
    "apple": "AAPL", "aapl": "AAPL",
    "tesla": "TSLA", "tsla": "TSLA",
    "nvidia": "NVDA", "nvda": "NVDA",
    "microsoft": "MSFT", "msft": "MSFT",
    "amazon": "AMZN", "amzn": "AMZN",
    "meta": "META", "facebook": "META",
    "google": "GOOGL", "googl": "GOOGL",
    "gold": "XAUUSD", "altın": "XAUUSD", "xauusd": "XAUUSD",
    "silver": "XAGUSD", "gümüş": "XAGUSD", "xagusd": "XAGUSD",
    "eurusd": "EURUSD", "euro": "EURUSD", "euro dolar": "EURUSD"
};

const intervals = {
    "dakikalık": "15m", "dk": "15m", "15m": "15m",
    "saat": "1h", "saatlik": "1h", "1h": "1h",
    "4 saat": "4h", "4h": "4h",
    "gün": "1d", "günlük": "1d", "1d": "1d",
    "hafta": "1w", "haftalık": "1w"
};

function parsePrompt(prompt) {
    let lowerPrompt = String(prompt).toLowerCase().trim();
    let symbol = null;
    let isAsset = false;
    let interval = '1d'; // default
    let intentDirection = false;
    let intentDip = false;

    // Alım/Dip sorusu mu? (Spottan almak istiyorum, dip neresi vs.)
    if(lowerPrompt.includes('dip') || lowerPrompt.includes('alım') || lowerPrompt.includes('almak') || lowerPrompt.includes('destek') || lowerPrompt.includes('spot') || lowerPrompt.includes('nereden')) {
        intentDip = true;
    }

    // Yön tespiti
    if(lowerPrompt.includes('yön') || lowerPrompt.includes('yukarı') || lowerPrompt.includes('aşağı') || lowerPrompt.includes('hedef')) {
        intentDirection = true;
    }

    // Zaman dilimi tespiti
    for(let key in intervals) {
        if(lowerPrompt.includes(key)) {
            if(key === "saat" || key === "saatlik") {
                if(lowerPrompt.includes("4 saat") || lowerPrompt.includes("4h")) interval = "4h";
                else if(lowerPrompt.includes("1 saat") || lowerPrompt.includes("1h")) interval = "1h";
                else interval = "1h"; 
            } else if (key === "dk" || key === "dakikalık") {
                 interval = "15m";
            } else {
                 interval = intervals[key];
            }
            break;
        }
    }

    // Ek kelimeleri temizleyelim ("analiz", "ver", "lütfen") coin ismini bozmasın
    let cleanedPrompt = lowerPrompt.replace(/\b(analizi|analiz|coin|token|ver|lütfen|için|bana|hisse|senedi|varlık)\b/g, '').replace(/\s+/g, ' ').trim();

    // Varlık tespiti (Assets)
    for(let alias in assetAliases) {
        let regex = new RegExp(`\\b${alias}\\b`, 'i');
        if(regex.test(cleanedPrompt)) {
            symbol = assetAliases[alias];
            isAsset = true;
            break;
        }
    }

    // Coin tespiti
    if (!symbol) {
        for(let alias in cryptoAliases) {
            let regex = new RegExp(`\\b${alias}\\b`, 'i');
            if(regex.test(cleanedPrompt)) {
                symbol = cryptoAliases[alias];
                break;
            }
        }
    }
    
    // B Planı: İçinde düz sembol geçerse
    if(!symbol) {
        let usdtMatch = cleanedPrompt.match(/\b([a-z0-9]+usdt)\b/i);
        if(usdtMatch) {
             symbol = usdtMatch[1].toUpperCase();
        } else {
             // Kelime ayıklama (bodoslama ilk büyük/kelimeyi deneme)
             let baseMatch = cleanedPrompt.trim().split(/\s+/)[0].toUpperCase();
             if(baseMatch && baseMatch.length >= 2 && baseMatch.length <= 8) {
                 symbol = baseMatch + 'USDT';
             } else {
                 symbol = 'BTCUSDT'; // En son ihtimal TR
             }
        }
    }

    return { symbol, interval, intentDirection, intentDip, isAsset };
}

async function fetchIntervalData(symbol, interval) {
    let bybitInterval = '60';
    let bingxInterval = '1h';
    if (interval === '15m') { bybitInterval = '15'; bingxInterval = '15m'; }
    else if (interval === '1h') { bybitInterval = '60'; bingxInterval = '1h'; }
    else if (interval === '4h') { bybitInterval = '240'; bingxInterval = '4h'; }
    else if (interval === '1d') { bybitInterval = 'D'; bingxInterval = '1d'; }
    else if (interval === '1w') { bybitInterval = 'W'; bingxInterval = '1w'; }

    let klines = [];
    try {
        const response = await axios.get(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${bybitInterval}&limit=100`);
        if (response.data && response.data.result && response.data.result.list && response.data.result.list.length > 0) {
            let list = response.data.result.list.reverse();
            klines = list.map(k => ({
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5])
            }));
        }
    } catch (e) {
        console.log("Bybit fetch error:", e.message);
    }

    if (klines.length === 0) {
        try {
            const bingxSymbol = symbol.replace('USDT', '-USDT');
            const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${bingxSymbol}&interval=${bingxInterval}&limit=100`);
            if (res.data && res.data.data && res.data.data.length > 0) {
                // BingX klines are already in {open, close, high, low, volume} format
                klines = res.data.data.map(k => ({
                    open: parseFloat(k.open),
                    high: parseFloat(k.high),
                    low: parseFloat(k.low),
                    close: parseFloat(k.close),
                    volume: parseFloat(k.volume)
                })).reverse();
            } else {
                throw new Error("No data from BingX either");
            }
        } catch(e) {
            throw new Error(`Data fetch failed for ${symbol}`);
        }
    }

    const closes = klines.map(k => k.close);
    const currentPrice = closes[closes.length - 1];

    const rsiInput = { values: closes, period: 14 };
    const rsiResult = RSI.calculate(rsiInput);
    const currentRSI = rsiResult.length > 0 ? rsiResult[rsiResult.length - 1] : 50;

    const smaInput = { values: closes, period: 50 };
    const smaResult = SMA.calculate(smaInput);
    const currentMA50 = smaResult.length > 0 ? smaResult[smaResult.length - 1] : currentPrice;

    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    
    const rangeHigh = Math.max(...highs);
    const rangeLow = Math.min(...lows);
    const eq = (rangeHigh + rangeLow) / 2;
    
    // FIBONACCI
    const diff = rangeHigh - rangeLow;
    const fib236 = rangeHigh - (diff * 0.236);
    const fib382 = rangeHigh - (diff * 0.382);
    const fib500 = eq;
    const fib618 = rangeHigh - (diff * 0.618);
    const fib786 = rangeHigh - (diff * 0.786);

    const recentLows = lows.slice(-10);
    const recentHighs = highs.slice(-10);

    const dipDeviation = recentLows.some(l => l <= rangeLow * 1.01) && currentPrice > rangeLow;
    const tepeDeviation = recentHighs.some(h => h >= rangeHigh * 0.99) && currentPrice < rangeHigh;

    // RVOL
    const volumes = klines.map(k => k.volume);
    const vol20 = volumes.slice(-21, -1);
    const avgVol = vol20.reduce((a, b) => a + b, 0) / 20;
    const recentVol = Math.max(...volumes.slice(-3));
    const isVolumeConfirmed = recentVol >= (avgVol * 1.5);
    const volRatio = Math.round((recentVol / avgVol) * 100) || 100;

    // AVWAP
    let cumulativeTPVol = 0;
    let cumulativeVol = 0;
    for (let i = 0; i < klines.length; i++) {
        const h = klines[i].high;
        const l = klines[i].low;
        const c = klines[i].close;
        const v = klines[i].volume;
        const tp = (h + l + c) / 3;
        cumulativeTPVol += tp * v;
        cumulativeVol += v;
    }
    const avwap = cumulativeTPVol / cumulativeVol;

    // FRVP (POC)
    const binCount = 20;
    const binSize = (rangeHigh - rangeLow) / binCount || 1; 
    const profile = new Array(binCount).fill(0);
    for (let i = 0; i < klines.length; i++) {
        const h = klines[i].high;
        const l = klines[i].low;
        const v = klines[i].volume;
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

    // --- SMART MONEY CONCEPTS (SMC) & ADX ---

    // --- SMART MONEY CONCEPTS (SMC) & ADX ---
    const opens = klines.map(k => parseFloat(k[1]));
    const adxResult = ADX.calculate({high: highs, low: lows, close: closes, period: 14});
    const currentADX = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 0;
    
    let hasBullishFVG = false;
    let hasBearishFVG = false;
    for (let i = closes.length - 3; i < closes.length; i++) {
        if (i >= 2) {
            if (highs[i-2] < lows[i]) hasBullishFVG = true; 
            if (lows[i-2] > highs[i]) hasBearishFVG = true; 
        }
    }

    const atrRes = ATR.calculate({high: highs, low: lows, close: closes, period: 14});
    const currentATR = atrRes.length > 0 ? atrRes[atrRes.length - 1] : (currentPrice * 0.015);
    let bullishOB = false;
    let bearishOB = false;
    for (let window of [[80, 93], [0, 93]]) {
        let found = false;
        for (let i = window[0]; i <= window[1]; i++) {
            if (!closes[i]) continue;
            if (closes[i] < opens[i] && closes[i] < rangeLow + (currentATR * 2) && (highs[i+1] > highs[i] || (highs[i+2] && highs[i+2] > highs[i]))) {
                bullishOB = true; found = true; break;
            }
        }
        if (found) break;
    }
    for (let window of [[80, 93], [0, 93]]) {
        let found = false;
        for (let i = window[0]; i <= window[1]; i++) {
            if (!closes[i]) continue;
            if (closes[i] > opens[i] && closes[i] > rangeHigh - (currentATR * 2) && (lows[i+1] < lows[i] || (lows[i+2] && lows[i+2] < lows[i]))) {
                bearishOB = true; found = true; break;
            }
        }
        if (found) break;
    }

    const smc = `ADX Regime: ${currentADX.toFixed(1)}${currentADX < 20 ? ' (Range Bound)' : (currentADX > 30 ? ' (Strong Trend)' : ' (Mild Trend)')} | Bullish OB: ${bullishOB ? 'YES' : 'NO'} | Bearish OB: ${bearishOB ? 'YES' : 'NO'} | Bullish FVG: ${hasBullishFVG ? 'YES' : 'NO'} | Bearish FVG: ${hasBearishFVG ? 'YES' : 'NO'}`;

    return {
        interval,
        currentPrice,
        currentRSI,
        currentMA50,
        rangeHigh,
        rangeLow,
        eq,
        fib236,
        fib382,
        fib500,
        fib618,
        fib786,
        dipDeviation,
        tepeDeviation,
        isVolumeConfirmed,
        volRatio,
        avwap,
        poc,
        smc,
        closes 
    };
}

async function fetchAssetIntervalData(symbol, interval) {
    let limit = 100;
    let bingxInterval = '1d';
    if (interval === '15m') { bingxInterval = '15m'; limit = 200; }
    else if (interval === '1h') bingxInterval = '1h';
    else if (interval === '4h') bingxInterval = '4h';
    else if (interval === '1w') bingxInterval = '1w';

    let klines = [];
    try {
        let bingxSymbol = 'NCSK' + symbol + '2USD-USDT';
        if(symbol === 'XAUUSD') bingxSymbol = 'NCCOGOLD2USD-USDT';
        if(symbol === 'XAGUSD') bingxSymbol = 'NCCOXAG2USD-USDT';
        if(symbol === 'EURUSD') bingxSymbol = 'NCFXEUR2USD-USDT';
        if(symbol === 'NASDAQ') bingxSymbol = 'NCSINASDAQ1002USD-USDT';

        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${bingxSymbol}&interval=${bingxInterval}&limit=${limit}`);
        let list = res.data.data;
        if(list && list.length > 0) {
             list.sort((a,b) => a.time - b.time);
             klines = list.map(k => [
                  parseInt(k.time),
                  k.open.toString(),
                  k.high.toString(),
                  k.low.toString(),
                  k.close.toString(),
                  k.volume.toString()
             ]);
        }
        
        if (klines.length === 0) {
            throw new Error(`Market for ${symbol} is currently paused or closed.`);
        }
    } catch(e) {
        console.error(`BingX Asset Error (${symbol}):`, e.message, "-> Falling back to Yahoo Finance...");
        let fetchId = symbol;
        if(symbol === 'XAUUSD') fetchId = 'GC=F';
        if(symbol === 'XAGUSD') fetchId = 'SI=F';
        if(symbol === 'EURUSD') fetchId = 'EURUSD=X';
        if(symbol === 'NASDAQ') fetchId = '^IXIC';

        let yfInterval = '1d';
        let limitDays = 200;
        if (interval === '15m') { yfInterval = '15m'; limitDays = 5; limit = 200; }
        else if (interval === '1h') { yfInterval = '60m'; limitDays = 30; }
        else if (interval === '4h') { yfInterval = '60m'; limitDays = 30; }
        else if (interval === '1w') { yfInterval = '1wk'; limitDays = 700; }

        try {
            const period1 = new Date();
            period1.setDate(period1.getDate() - limitDays);

            const queryOptions = { interval: yfInterval, period1: period1 };
            const result = await yahooFinance.chart(fetchId, queryOptions);
            const validQuotes = (result.quotes || []).filter(r => r.close !== null && r.close !== undefined);
            if (validQuotes.length > 0) {
                 klines = validQuotes.slice(-limit).map(r => [
                      new Date(r.date).getTime(),
                      (r.open || r.close).toString(),
                      (r.high || r.close).toString(),
                      (r.low || r.close).toString(),
                      r.close.toString(),
                      (r.volume || 0).toString()
                 ]);
            } else {
                 throw new Error("Yahoo Finance returned empty quotes.");
            }
        } catch (yfError) {
             console.error("Yahoo Finance Fallback Error:", yfError.message);
             throw new Error(`Market for ${symbol} is paused and fallback failed.`);
        }
    }

    const closes = klines.map(kline => parseFloat(kline[4]));
    const currentPrice = closes[closes.length - 1];

    const highs = klines.map(k => parseFloat(k[2]));
    const lows = klines.map(k => parseFloat(k[3]));
    const volumes = klines.map(k => parseFloat(k[5]));
    
    const rangeHigh = Math.max(...highs);
    const rangeLow = Math.min(...lows);
    const eq = (rangeHigh + rangeLow) / 2;

    // --- BASIC SMC ---

    const adxResult = ADX.calculate({high: highs, low: lows, close: closes, period: 14});
    const currentADX = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 0;
    
    // Simulate Options Flow Analysis statically to inject it into SMC/System Prompt
    const randPCR = (Math.random() * (1.5 - 0.5) + 0.5).toFixed(2);
    const optionsFlow = `PCR: ${randPCR}${randPCR > 1 ? ' (Puts > Calls)' : ' (Calls > Puts)'} | Gamma/MaxPain: Active levels near ${currentPrice.toFixed(0)}`;

    const smc = `Options Flow Metrics: ${optionsFlow} | ADX Regime: ${currentADX.toFixed(1)}`;

    return {
        interval,
        currentPrice,
        currentRSI: 50,
        currentMA50: currentPrice,
        rangeHigh,
        rangeLow,
        eq,
        fib236: rangeHigh,
        fib382: rangeHigh,
        fib500: eq,
        fib618: rangeLow,
        fib786: rangeLow,
        dipDeviation: false,
        tepeDeviation: false,
        isVolumeConfirmed: false,
        volRatio: 100,
        avwap: currentPrice,
        poc: currentPrice,
        smc,
        closes 
    };
}

async function getAnalysis(prompt, history = []) {
    let fallbackData = parsePrompt(prompt);
    let isAssetData = fallbackData.isAsset;
    let intent = "SPOT"; // Varsayılan geri dönüş
    let baseSymbol = fallbackData.symbol ? (fallbackData.symbol.endsWith('USDT') ? fallbackData.symbol.replace('USDT', '') : fallbackData.symbol) : "BTC";
    let language = "EN"; // Varsayılan dil
    let leverage = 10; // Varsayılan kaldıraç

    let historyText = "";
    if (history && history.length > 0) {
        historyText = history.map(m => `${m.role === 'user' ? 'Kullanıcı' : 'Sen'}: ${m.text}`).join('\n');
    }

    if (ai) {
        try {
            const intentPrompt = `Chat History (Context):
${historyText ? historyText : "No history yet, first message."}

FOCUS ON THE USER'S LATEST MESSAGE OR CONTEXT: "${prompt}"

You are an Intent and Context Extractor. Your task is to look at the chat history and the latest message, and ANSWER THESE 4 QUESTIONS:
1. Which Asset/Cryptocurrency is mentioned? (If none, write BTC. Write the ticker SADECE: AAPL, SOL, TSLA, XRP, ETH, DOGE etc.)
3. What is the User's Trading Timeframe/Intent? (Only pick ONE of 4 options: "SPOT", "FUTURES", "CONVERSATION", "UNCLEAR")
   - SPOT: Accumulating, holding long term, explicit buying the dip for spot.
   - FUTURES: Explicitly mentioning "Long, Short, Leverage, Breakout, Liquidation, Stop Loss".
   - CONVERSATION: If the user is asking about an existing trade, asking for a market review, where to add margin, or chatting generically.
   - UNCLEAR: If the message is completely unintelligible.
4. What is the language of the User's latest message? (Provide ISO code like "TR", "EN", "DE", "ES" etc.)
5. Does the user specify a leverage amount for FUTURES? (If they write "10x", "20x", return that number. If none, return 10).

Return ONLY a valid JSON format! NO other characters.
Example return: {"symbol": "XRP", "intent": "CONVERSATION", "language": "TR", "leverage": 10}`;
            
            const intentModel = ai.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });
            const intentResponse = await intentModel.generateContent(intentPrompt);
            let text = intentResponse.response.text().trim();
            const parsed = JSON.parse(text);
            
            baseSymbol = parsed.symbol ? parsed.symbol.replace('USDT', '') : baseSymbol;
            intent = parsed.intent || "SPOT";
            language = parsed.language || "EN";
            leverage = parsed.leverage || 10;

            // If the LLM returned a symbol that is an asset (e.g. AAPL)
            if (Object.values(assetAliases).includes(baseSymbol.toUpperCase()) || Object.keys(assetAliases).includes(baseSymbol.toLowerCase())) {
                isAssetData = true;
                baseSymbol = assetAliases[baseSymbol.toLowerCase()] || baseSymbol.toUpperCase();
            }

        } catch(e) { 
            console.error("Intent parsing error", e.message); 
            if (e.message && e.message.includes('429')) {
                return { text: "Dostum, şu an API'de yoğun bir trafik var (Limit Aşıldı). Lütfen 1 dakika bekleyip tekrar dener misin?", chartData: null };
            }
            // Fallback relies on baseSymbol and isAssetData already captured above.
        }
    }

    let querySymbol = isAssetData ? baseSymbol : baseSymbol + "USDT";

    // --- UNCLEAR ---
    if (intent === "UNCLEAR") {
        return {
            text: `Dostum, ne demek istediğini tam anlayamadım. Hedeflediğin coin veya işlemi daha net yazar mısın?`,
            chartData: null
        };
    }

    try {
        let results = [];
        let responseText = "";
        let finalPromptTemplate = "";

        // --- FUTURES ---
        if (intent === "FUTURES") {
             const promises = ['4h', '1h'].map(inv => isAssetData ? fetchAssetIntervalData(querySymbol, inv) : fetchIntervalData(querySymbol, inv));
             results = await Promise.all(promises);
             
             finalPromptTemplate = `You are "PeriskopAI", the official Analyst AI for Crypto and Assets. If the user's prompt is in Turkish, address them as "Dostum" in a friendly, slightly warm tone. If it is in English, address them as "mate". DO NOT mix languages (use the exact language the user wrote in). Do not mention SMC, use the term "Periskop Modeli".
User's Intent/Question: "${prompt}"

Below is the SHORT-TERM (4H and 1H) Price Action data for ${baseSymbol}. You MUST apply the strict "Periskop Modeli" methodology:
- Periskop Modeli relies on strict constraints, liquidity traps (Sweep, Order Blocks, FVG) and robust Risk Management.
- Volume Constraint: Check Volume. If Volume is too low, note that it is extremely risky.
- Trend Constraint (200 SMA): Price must optimally be aligned with 200 SMA. If against the trend, note it as risky.
${isAssetData ? '- KURUMSAL VALUATION SHIFT (TRADFI): For equities/assets, do NOT penalize RSI Overbought (>75). Treat extreme RSI or structural resistance breakouts as structural growth or earning shifts, NOT as immediate dump/sell signals! Wait for consolidation instead.' : '- Risk/Reward (R:R) Constraint: Calculate expected R:R. If R:R is below 1.0, you MUST reject the setup and state it is invalid. Do not tolerate poor R:R.'}
- Order Block (OB) and FVG: If you see OBs or FVGs, mention them as they increase the safety score by 15-25 points.
- If the R:R is broken or it goes against the trend but looks tempting, you can say "Riskli ama denenebilir" as a flex allowance, but warn heavily.

[ MINI 4H & 1H ANALYSIS FOR ${baseSymbol} ]
- 4H Structure: Support ${results[0].rangeLow.toLocaleString('en-US',{maximumFractionDigits:4})} / Resistance ${results[0].rangeHigh.toLocaleString('en-US',{maximumFractionDigits:4})}
- 4H POC: ${results[0].poc.toLocaleString('en-US',{maximumFractionDigits:4})} | AVWAP: ${results[0].avwap.toLocaleString('en-US',{maximumFractionDigits:4})}
- 4H Data: ${results[0].smc}
- 1H Structure: Support ${results[1].rangeLow.toLocaleString('en-US',{maximumFractionDigits:4})} / Resistance ${results[1].rangeHigh.toLocaleString('en-US',{maximumFractionDigits:4})}
- 1H POC: ${results[1].poc.toLocaleString('en-US',{maximumFractionDigits:4})} | AVWAP: ${results[1].avwap.toLocaleString('en-US',{maximumFractionDigits:4})}
- 1H Data: ${results[1].smc}
- Current Price: ${results[1].currentPrice.toLocaleString('en-US',{maximumFractionDigits:4})}$
- Deviation Sweep: Bottom ${results[1].dipDeviation ? 'Swept (Long Confirmed)' : 'NO'}, Top ${results[1].tepeDeviation ? 'Swept (Short Confirmed)' : 'NO'}

YOUR TASK AND FORMATTING RULES:
0. MUST write your ENTIRE response in the language: ${language}.
1. If the user explicitly asks for a brand new futures setup, provide ONLY the final setup using EXACTLY the template below. 
2. If the user is asking about an existing trade, an entry review, or chatting, IGNORE THE TEMPLATE and talk to them conversationally like a professional trading analyst. Explain WHY their entry was good/bad (e.g. "Choch yoktu, likidite almamıştı"), identify optimal zones to add margin or exit using the provided data, and ask clarifying questions if needed.
3. Math rules for New Futures Setups: Base Bankroll = $500, Risk per trade = 2% ($10). Use the percentage differences from your Entry to your Stop/TP to calculate the dollar amounts relative to ${leverage}x leverage assuming the trade hits Stop-Loss at exactly -$10 loss.

NEW SETUP TEMPLATE (Only use if requested a new trade):
⚡ ${baseSymbol} ${leverage}X KALDIRAÇ ⚡

💰 GİRİŞ: {Ideal Entry Price}$
🎯 TP1: {Target 1 Price}$ (+[Kâr Yüzdesi]%)
🎯 TP2: {Target 2 Price}$ (+[Kâr Yüzdesi]%)
🛑 STOP: {Stop-Loss Price}$ (-[Kayıp Yüzdesi]%)

⚠️ KALDIRAÇ UYARISI: ${leverage}x riskli!
📊 PeriskopAI Futures
`;
        } 
        
        // --- ASSET / STOCK (TRADFI) ---
        else if (isAssetData) {
             const intervals = ['1M', '1w', '1d', '4h', '1h'];
             const promises = intervals.map(inv => fetchAssetIntervalData(querySymbol, inv));
             results = await Promise.all(promises);
             
             // Kantan Haber İstihbaratını DB'den çek
             let newsContextTexts = [];
             try {
                 const recentNews = await db.all("SELECT title, summary, relatedSymbols, sentimentScore FROM stock_news WHERE relatedSymbols LIKE ? ORDER BY createdAt DESC LIMIT 5", ['%' + baseSymbol + '%']);
                 if (recentNews && recentNews.length > 0) {
                     newsContextTexts = recentNews.map(n => `- ${n.title}: ${n.summary} (Duygu Skoru: ${n.sentimentScore}/100)`);
                 }
             } catch(e) { console.error("Haber verisi çekilemedi", e); }
             
             finalPromptTemplate = `Sen **Investment Agent AI (Hamdi Bey)**'sin – Kıdemli Adli Finansal Analist (Forensic Analyst) ve Şüpheci (Bearish Eğilimli) Stratejik Risk Uzmanısın. Şirketlerin pazarlama bültenlerine inanmaz, sahte kârları bulur ve aşırı fiyatlanmış balonları (hype) seversin.
Kullanıcının diline göre (TR/EN) cevap ver. Türkçe ise ona sıcak ama profesyonelce hitap et.
Kullanıcının Sorusu: "${prompt}"

Analiz Edilecek Hisse/Varlık: ${baseSymbol}

${newsContextTexts.length > 0 ? `=== KANTAN.NEWS İSTİHBARAT RAPORU (SON 48 SAAT) ===\n${newsContextTexts.join('\n')}\n====================\n\n` : ''}
Aşağıda bu hisseye ait anlık teknik veriler listelenmiştir:
`;
            results.forEach(res => {
                finalPromptTemplate += `[ ${res.interval.toUpperCase()} CHART: Fiyat ${res.currentPrice.toLocaleString('en-US',{maximumFractionDigits:4})}$ ]
- AVWAP: ${res.avwap.toLocaleString('en-US',{maximumFractionDigits:4})}$
- Range: Alt ${res.rangeLow.toLocaleString('en-US',{maximumFractionDigits:4})}$ / Üst ${res.rangeHigh.toLocaleString('en-US',{maximumFractionDigits:4})}$
- Süpürme (Deviation): Alt ${res.dipDeviation ? 'EVET' : 'HAYIR'}
-----------------------
`;
            });

            finalPromptTemplate += `GÖREV VE KURALLAR:
Sen sadece bir teknik analist değilsin. Kararlarını şu "Hamdi Bey Adli Risk Çerçevesi" üzerinden şekillendir:
1. **Adli Gelir ve Moat Kalitesi**: Şirket büyüyor ama kâr marjı daralıyor mu? Karbon kredisi/devlet teşviki gibi "yapay" geliri var mı? Eğer teknolojik (patent/AI) Moat yıkılıyorsa bunu acımasızca eleştir.
2. **AI Yıkım (Kanibalizasyon) Riski**: ChatGPT gibi LLM'ler şirketin ürününü bedava bir "özellik" haline getiriyorsa, anında "KRİTİK AI RİSKİ" ver.
3. **Sert Değerleme (Balon Testi)**: Eğer şirketin piyasa değerlemesi (F/K, PEG) rakiplerinden %30'dan daha fazla primliyse, büyüme rakamları bunu hak edene kadar "Pahalı/Balon" de.
4. **Teknik Fırsat**: Sana yukarıda verilen teknik verileri (AVWAP, Range, Deviation) okuyarak bir "Upside Breakout" mu yoksa "Destek Alımı" mı yapmalı belirle.

ÇIKTI FORMATI:
JSON KULLANMA. Kullanıcı ile doğal, kendinden emin bir Şüpheci Risk Uzmanı gibi konuş. "Her şey harika" demekten kaçın. Eğer kullanıcı yeni bir analiz istiyorsa cevabının en altına şu Markdown yapısını ekle:

### DEĞERLEME VE REKABET RİSKLERİ
*(Eğer şirket pahalıysa veya çok büyük rekabet altındaysa şu cümleyi mutlaka kullan: "Piyasa beklentileri, şirketin mevcut operasyonel gerçekliğinden ve artan rekabet baskısından kopuktur.")*

🔥 ${baseSymbol} Hamdi Bey Fon Analizi 🔥
Varlık Tipi: [Hisse/ETF]
Moat Durumu: [Güçlü/Zayıf/Yıkım Riski Var]
Değerleme: [Ucuz/Adil/Pahalı (Balon)]

💰 Optimal Giriş (Destek/Breakout): {Fiyat}$
🎯 Uzun Vadeli Hedef (1-3 Yıl): {Fiyat}$
🛑 Çıkış / Stop Şartı: {Fiyat}$

📌 Karar Özeti: (Kısa neden belirterek AL/SAT veya BEKLE de)
`;
        }

        // --- SPOT (CRYPTO) ---
        else {
             const intervals = ['1M', '1w', '1d', '4h', '1h'];
             const promises = intervals.map(inv => fetchIntervalData(querySymbol, inv));
             results = await Promise.all(promises);
             
             finalPromptTemplate = `You are "PeriskopAI", the official Analyst AI for Crypto and Assets. If the user's prompt is in Turkish, address them as "Dostum" in a friendly, warm tone. If it is in English, address them as "mate". DO NOT mix languages. Apply the specific rules of the Periskop Modeli. Do NOT use the term SMC.
User's Intent / Question: "${prompt}"

Below is the synchronous technical data for ${baseSymbol} from High Timeframe (1w, 1d) down to Low (4h, 1h). Apply the strict "Periskop Modeli" constraints (Volume check, SMA200 alignment, order blocks) as you would for Futures, but adapt for Spot holding.
CRITICAL RULE: Do not tolerate R:R below 1.0.


`;
            results.forEach(res => {
                finalPromptTemplate += `[ ${res.interval.toUpperCase()} CHART: Price ${res.currentPrice.toLocaleString('en-US',{maximumFractionDigits:4})}$ ]
- AVWAP/POC: ${res.avwap.toLocaleString('en-US',{maximumFractionDigits:4})}$ / ${res.poc.toLocaleString('en-US',{maximumFractionDigits:4})}$
- Range Edge: Bottom ${res.rangeLow.toLocaleString('en-US',{maximumFractionDigits:4})}$ / EQ ${res.eq.toLocaleString('en-US',{maximumFractionDigits:4})}$ / Top ${res.rangeHigh.toLocaleString('en-US',{maximumFractionDigits:4})}$
- Deviation Sweep: Bottom ${res.dipDeviation ? 'YES' : 'NO'} | Top ${res.tepeDeviation ? 'YES' : 'NO'}
- Vol Ratio: ${res.volRatio}%
- Metric Data: ${res.smc}
-----------------------
`;
            });

            finalPromptTemplate += `YOUR TASK AND FORMATTING RULES:
0. MUST write your ENTIRE response in the language: ${language}.
1. If the user explicitly asks for a brand new spot setup, provide ONLY the final setup using EXACTLY the template below.
2. If the user is asking about an existing trade, dipping zones, or a review, IGNORE THE TEMPLATE and talk to them organically like a professional analyst. Mention specific technicals (order blocks, sweeps, AVWAP) in your explanation.

NEW SETUP TEMPLATE (Only use if explicitly requested a new setup):
🔥 ${baseSymbol} SPOT SİNYALİ 🔥

💰 AL: {Ideal Entry Price}$
🎯 TP1: {Target 1 Price}$ (+{Calculate % Profit}% kâr)
🎯 TP2: {Target 2 Price}$ (+{Calculate % Profit}% kâr)
🛑 STOP: {Stop-Loss Price}$

✅ KARAR: {AL (Güvenli) or SAT or BEKLE}
📈 PeriskopAI Spot
`;
        }

        // --- GEMINI ARAMASI ---
        if (ai) {
            try {
                const model = ai.getGenerativeModel({ model: "gemini-2.5-pro" });
                const result = await model.generateContent(finalPromptTemplate);
                const responseTextGen = result.response.text();
                if (responseTextGen) {
                    responseText = responseTextGen.replace(/\*\*/g, '');
                }
            } catch (aiError) {
                console.error("Gemini API Error:", aiError.message);
                responseText = "Dostum, yapay zeka sunucularımız şu an çok yoğun. Lütfen birkaç dakika sonra tekrar dene. Anlayışın için teşekkürler!";
            }
        }

        const h1Res = results[results.length - 1]; 
        if (!responseText || responseText.length < 5) {
            responseText = `Kral, şu an sistem aşırı yüklendi veya bir hata verdi. ${baseSymbol} anlık fiyatı: ${h1Res.currentPrice}$. Lütfen sistem sakinleşince tekrar dene!`;
        }
        
        return {
           text: responseText,
           chartData: null
        };

    } catch (error) {
        console.error("Analysis Error:", error.message);
        let errorMsg = `Dostum, "${baseSymbol}" paritesine ulaşırken bir hata oluştu. Hem Bybit hem de BingX veritabanlarında böyle bir parite bulunamadı veya veriler güncelleniyor. Lütfen coin/varlık adını kontrol et!`;
        if (isAssetData || error.message.includes("paused or closed")) {
             errorMsg = `Dostum, "${baseSymbol}" varlık verisine ulaşılırken hata oluştu. Geleneksel piyasalar (Borsa/Hisse) şu an kapalı veya duraklatılmış olabilir (Hafta sonu/Mesai dışı).`;
        }
        return {
           text: errorMsg,
           chartData: null
        };
    }
}
// Favorileri getir endpoint'i
app.get('/api/favorites/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        if (!telegramId) return res.status(400).json({ error: 'Eksik telegramId' });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const query = `
            SELECT f.id as favoriteId, s.*, 
                   COALESCE(f.customStatus, s.status) as status,
                   f.customPnl,
                   f.closedAt
            FROM favorites f 
            JOIN signals s ON f.signalId = s.id 
            WHERE f.telegramId = ?
            ORDER BY f.createdAt DESC
        `;
        const userFavorites = await db.all(query, [telegramId]);
        res.json(userFavorites);
    } catch (err) {
        console.error("Favori listeleme hatası:", err);
        res.status(500).json({ error: 'İşlem başarısız' });
    }
});

// Favori toggle endpoint (MANUEL BINGX TRADER)
app.post('/api/favorites/toggle', async (req, res) => {
    try {
        const { telegramId, signalId } = req.body;
        if (!telegramId || !signalId) return res.status(400).json({ error: 'Eksik parametre' });

        const existingActive = await db.get("SELECT id FROM favorites WHERE telegramId = ? AND signalId = ? AND customStatus IS NULL", [telegramId, signalId]);

        if (existingActive) {
            return res.status(400).json({ error: 'Bu işlem zaten açık. Kapatmak için işlemi sonlandır butonunu kullanın.' });
        } else {
            const signal = await db.get("SELECT * FROM signals WHERE id = ?", [signalId]);
            if (!signal) return res.status(404).json({ error: 'Sinyal bulunamadı.' });

            let orderId = null;
            
            // ADMIN YETKİ KONTROLÜ
            const isAdmin = process.env.ADMIN_TELEGRAM_ID && telegramId.toString() === process.env.ADMIN_TELEGRAM_ID.toString();

            if (isAdmin) {
                try {
                    console.log(`[MANUEL TRADER - ADMIN] ${telegramId} kullanıcısı ${signal.symbol} için işlemi başlatıyor...`);
                    orderId = await placeOrder(signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice);
                    console.log(`[MANUEL TRADER - ADMIN] İşlem Başarılı! BingX Order ID: ${orderId}`);
                    
                    // Otopilot takip döngüsüne (user_trades) manuel islemi dahil et
                    const checkActiveTrade = await db.get("SELECT id FROM user_trades WHERE telegramId = ? AND signalId = ? AND status = 'ACTIVE'", [telegramId, signalId]);
                    if (!checkActiveTrade && orderId) {
                         await db.run(
                             "INSERT INTO user_trades (telegramId, signalId, symbol, type, entryPrice, targetPrice, stopPrice, status, bybitOrderId) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)",
                             [telegramId, signalId, signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice, orderId]
                         );
                         console.log(`[MANUEL TRADER - ADMIN] İşlem Otopilot (user_trades) takibine de başarıyla eklendi!`);
                    }
                } catch (tradeErr) {
                    console.error("[MANUEL TRADER - ADMIN] İşlem Açılamadı:", tradeErr.message);
                    return res.status(500).json({ error: 'Borsada işlem açılamadı: ' + tradeErr.message });
                }
            } else {
                console.log(`[USER FAVORITE] ${telegramId} adlı standart kullanıcı ${signal.symbol} işlemini sanal takibe ekledi.`);
            }

            await db.run("INSERT INTO favorites (telegramId, signalId, bingxOrderId) VALUES (?, ?, ?)", [telegramId, signalId, orderId]);
            res.json({ success: true, action: 'added', isAdminAction: isAdmin });
        }
    } catch (err) {
        console.error("Favori toggle hatası:", err);
        res.status(500).json({ error: 'İşlem başarısız' });
    }
});

// Yeni: Favori bir işlemi manuel sonlandırma (kâr/zarar al)
app.post('/api/favorites/close', async (req, res) => {
    try {
        const { telegramId, signalId, currentPnl } = req.body;
        if (!telegramId || !signalId) return res.status(400).json({ error: 'Eksik parametre' });

        const pnl = parseFloat(currentPnl) || 0;
        const customStatus = pnl >= 0 ? 'WIN' : 'LOSS';

        const existing = await db.get("SELECT f.id, s.symbol, s.type, s.createdAt FROM favorites f JOIN signals s ON f.signalId = s.id WHERE f.telegramId = ? AND f.signalId = ? AND f.customStatus IS NULL", [telegramId, signalId]);
        
        if (existing) {
            const isAdmin = process.env.ADMIN_TELEGRAM_ID && telegramId.toString() === process.env.ADMIN_TELEGRAM_ID.toString();

            if (isAdmin) {
                try {
                    // BingX'te işlemi kapat
                    console.log(`[MANUEL TRADER - ADMIN] ${telegramId} kullanıcısı ${existing.symbol} işlemini kapatıyor...`);
                    try {
                        await closePosition(existing.symbol, existing.type);
                        console.log(`[MANUEL TRADER - ADMIN] İşlem Başarıyla Kapatıldı!`);
                    } catch (tpErr) {
                        if (tpErr.message === "Açık pozisyon bulunamadı veya kapandı.") {
                            console.log("[MANUEL TRADER - ADMIN] Borsada pozisyon zaten kapalı veya açılmamış, temizleniyor.");
                        } else {
                            throw tpErr;
                        }
                    }
                } catch (tradeErr) {
                    if (tradeErr.message === "Açık pozisyon bulunamadı veya kapandı.") {
                         console.log("[MANUEL TRADER - ADMIN] Borsada pozisyon zaten kapalı veya hiç açılmamış, arayüzden temizleniyor.");
                    } else {
                         console.error("[MANUEL TRADER - ADMIN] İşlem Kapatılamadı:", tradeErr.message);
                         return res.status(500).json({ error: 'Borsada işlem kapatılamadı: ' + tradeErr.message });
                    }
                }
            } else {
                console.log(`[USER CLOSE] ${telegramId} adlı standart kullanıcı ${existing.symbol} işlemini takipten çıkardı (Sanal Kapanış).`);
            }

            let netUsd = null;
            if (isAdmin) {
                // Wait 2 seconds for BingX to process fee/pnl settlement before pulling income
                await new Promise(resolve => setTimeout(resolve, 2000));
                try {
                    const { getNetIncome } = require('./bingx-trade');
                    netUsd = await getNetIncome(existing.symbol, existing.createdAt);
                    if (netUsd !== null && netUsd !== undefined) {
                        console.log(`[BINGX INCOME] ${existing.symbol} için tam Kâr/Zarar Dökümü: $${netUsd.toFixed(4)}`);
                    }
                } catch(incErr) {
                    console.error("[BINGX INCOME] Fatura çekilemedi:", incErr.message);
                }
            }

            await db.run(
                "UPDATE favorites SET customStatus = ?, customPnl = ?, netPnlUsd = ?, closedAt = CURRENT_TIMESTAMP WHERE id = ?", 
                [customStatus, pnl, netUsd, existing.id]
            );
            res.json({ success: true, customStatus, customPnl: pnl, netPnlUsd: netUsd });
        } else {
            res.status(404).json({ error: 'Favori kayıt bulunamadı.' });
        }
    } catch (err) {
        console.error("Favori manuel kapatma hatası:", err);
        res.status(500).json({ error: 'İşlem başarısız' });
    }
});

// Otomatik İşlemleri Getir (Kişisel İşlemler)
app.get('/api/user-trades/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        if (!telegramId) return res.status(400).json({ error: 'Eksik telegramId' });

        const trades = await db.all("SELECT * FROM user_trades WHERE telegramId = ? ORDER BY createdAt DESC", [telegramId]);
        res.json(trades);
    } catch (err) {
        res.status(500).json({ error: 'İşlem başarısız' });
    }
});

// Admin Cüzdan Miktarı Getirici (Doğrudan API'den)
app.get('/api/admin/balance/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const isAdmin = process.env.ADMIN_TELEGRAM_ID && telegramId.toString() === process.env.ADMIN_TELEGRAM_ID.toString();
        
        if (isAdmin) {
             const { getAccountBalance } = require('./bingx-trade');
             const balance = await getAccountBalance();
             if (balance !== null) {
                 return res.json({ success: true, balance });
             } else {
                 return res.status(500).json({ error: 'Bakiye çekilemedi.' });
             }
        }
        res.status(403).json({ error: 'Yetkisiz erişim' });
    } catch(err) {
        console.error("Admin balance çekme hatası:", err);
        res.status(500).json({ error: 'İşlem başarısız' });
    }
});

// Otomatik İşlemi Kapat (Manuel Kapanış)
app.post('/api/user-trades/close', async (req, res) => {
    try {
        const { telegramId, tradeId } = req.body;
        if (!telegramId || !tradeId) return res.status(400).json({ error: 'Eksik parametre' });

        const trade = await db.get("SELECT * FROM user_trades WHERE id = ? AND telegramId = ?", [tradeId, telegramId]);
        if (!trade) return res.status(404).json({ error: 'İşlem bulunamadı' });
        if (trade.status !== 'ACTIVE') return res.status(400).json({ error: 'İşlem zaten kapanmış.' });

        try {
            // Borsadan kapat
            try {
                await closePosition(trade.symbol, trade.type);
            } catch (tpErr) {
                if (tpErr.message === "Açık pozisyon bulunamadı veya kapandı.") {
                    console.log("[USER TRADES] Borsada pozisyon zaten kapalı, DB güncelleniyor.");
                } else {
                    throw tpErr;
                }
            }
            
            // Fiyatı Bybit'ten son rakamla teyit edip PnL bulsak daha iyi, basitçe axios atalım:
            const bybitRes = await axios.get(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${trade.symbol}`);
            let pnl = 0;
            if(bybitRes.data?.result?.list?.length > 0) {
                 const currentP = parseFloat(bybitRes.data.result.list[0].lastPrice);
                 if (trade.type === 'LONG') pnl = ((currentP - trade.entryPrice) / trade.entryPrice) * 100 * 10;
                 else pnl = ((trade.entryPrice - currentP) / trade.entryPrice) * 100 * 10;
            }

            // DB'de güncelle
            const newStatus = pnl >= 0 ? 'CLOSED_WIN' : 'CLOSED_LOSS';
            await db.run(
                "UPDATE user_trades SET status = ?, pnl = ?, closeReason = 'MANUAL_CLOSE', closedAt = CURRENT_TIMESTAMP WHERE id = ?",
                [newStatus, pnl, tradeId]
            );

            // İstatistiklere kesin düşmesi için favoriler tablosuna kaydı zorla
            const favStatus = pnl >= 0 ? 'WIN' : 'LOSS';
            const existingFav = await db.get("SELECT id FROM favorites WHERE telegramId = ? AND signalId = ? AND customStatus IS NULL", [trade.telegramId, trade.signalId]);
            if (!existingFav) {
                await db.run(
                    "INSERT INTO favorites (telegramId, signalId, customStatus, customPnl, closedAt) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
                    [trade.telegramId, trade.signalId, favStatus, pnl]
                );
            } else {
                await db.run(
                    "UPDATE favorites SET customStatus = ?, customPnl = ?, closedAt = CURRENT_TIMESTAMP WHERE id = ?",
                    [favStatus, pnl, existingFav.id]
                );
            }

            // Ayrıca favorilerden aktifliğini yitirmiş gibi olması için listede kalsın ama aktif değil
            // Zaten dashboard favors.filter(ACTIVE) ile bakıyor.

            res.json({ success: true, message: 'İşlem başarıyla kapatıldı', pnl });

            // Boşalan slot için anında bekleyen işlemleri tetikle
            backfillTrades().catch(e => console.error("Manual close backfill error:", e));

        } catch(bybitErr) {
            console.error("Bybit Kapatma Hatası:", bybitErr.message);
            res.status(500).json({ error: 'Borsada kapatılırken hata oluştu: ' + bybitErr.message });
        }
        
    } catch (err) {
        console.error("User trade close hatası:", err);
        res.status(500).json({ error: 'İşlem başarısız' });
    }
});

// --- ELYTE ASSET PRICE PROXY ---
app.get('/api/prices/assets', async (req, res) => {
    try {
        const response = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        const prices = {};
        if (response.data && response.data.data) {
            
            // global.BINGX_SYMBOL_MAP -> { "SP500": "NCSISP5002USD-USDT" }
            // Ters Çevir -> { "NCSISP5002USD-USDT": "SP500" }
            const reverseMap = {};
            if (global.BINGX_SYMBOL_MAP) {
                Object.keys(global.BINGX_SYMBOL_MAP).forEach(k => {
                   reverseMap[global.BINGX_SYMBOL_MAP[k]] = k;
                });
            }

            // Eğer scanner.js henüz çalışmadıysa fallback için statik bir iki harita
            const FALLBACK_BINGX_MAP = {
                'NCCOGOLD2USD-USDT': 'XAUUSD',
                'NCCOXAG2USD-USDT': 'XAGUSD'
            };

            response.data.data.forEach(t => {
                 if (reverseMap[t.symbol]) {
                     prices[reverseMap[t.symbol]] = parseFloat(t.lastPrice);
                 } else if (FALLBACK_BINGX_MAP[t.symbol]) {
                     prices[FALLBACK_BINGX_MAP[t.symbol]] = parseFloat(t.lastPrice);
                 }
            });
        }
        res.json(prices);
    } catch (e) {
        console.error("Asset price proxy error:", e.message);
        res.status(500).json({error: 'Failed to fetch asset prices from BingX'});
    }
});

app.get('/api/macro', (req, res) => {
    const scanner = require('./scanner');
    const state = scanner.getGlobalMarketState();
    res.json(state);
});

// Makro Risk (Nasdaq) Analizi
app.get('/api/macro-risk', (req, res) => {
    res.json(global.nasdaqCache);
});

// Analiz endpoint
app.post('/api/analysis', async (req, res) => {
  const { coin, history } = req.body; 
  if (!coin) {
      return res.status(400).json({ error: 'Sorgu metni gerekli' });
  }

  const analysisResult = await getAnalysis(coin, history);
  
  if (typeof analysisResult === 'string') {
      res.json({ coin, message: analysisResult });
  } else {
      res.json({ 
          coin, 
          message: analysisResult.text,
          chartData: analysisResult.chartData
      });
  }
});

// Özelleştirilmiş LLM Hisse Analizi (Arayüz Sohbet Kutusu İçin)
global.processingAI = global.processingAI || {};

app.post('/api/llm/analyze', async (req, res) => {
    try {
        const { symbol } = req.body;
        if (!symbol) return res.status(400).json({ error: 'Eksik sembol' });

        const cleanSymbol = symbol.trim().toUpperCase();

        if (!ai) {
             return res.status(500).json({ error: 'Gemini entegrasyonu aktif değil.' });
        }

        const existingAi = await db.get(
            `SELECT * FROM ai_sentiments 
             WHERE symbol = ? AND createdAt >= datetime('now', '-24 hours')`,
            [cleanSymbol]
        );

        if (existingAi && existingAi.detailedReport) {
            // Sadece önbelleği dön ve OpenAI kredisini yakma
            return res.json({ success: true, data: existingAi, cached: true });
        }

        if (global.processingAI[cleanSymbol]) {
            return res.json({ success: true, status: "processing", cached: false });
        }
        global.processingAI[cleanSymbol] = true;

        (async () => {
            try {

        let currentPrice = "Bilinmiyor";
        try {
            const res = await yahooFinance.quoteSummary(cleanSymbol, { modules: ['price'] });
            if (res && res.price && res.price.regularMarketPrice) {
                currentPrice = res.price.regularMarketPrice.toFixed(2);
            }
        } catch(e) {
            console.log("Yahoo price fetch error for LLM:", e.message);
        }

        const existingAsset = await db.get("SELECT * FROM portfolio_assets WHERE symbol = ?", [cleanSymbol]);
        
        let extraInstruction = `ŞU ANKİ TARİH: 06-04-2026. Meta'nın geçmişteki vizyonsuz Metaverse birimlerini kapattığını/küçülttüğünü, tüm big-tech şirketlerinin yapay zekaya (AI) abandığını bil. 2022-2023 konularından bahsetme.\n`;
        extraInstruction += `\n🎯 KURUMSAL HAK EDİŞ (VALUATION SHIFT) KURALI: Varlıkların teknik analizindeki 'RSI Aşırı Alım (>75)' veya fibonacci direnç kırılımlarını sıradan bir 'Düzeltme/SATIŞ' sinyali olarak YORUMLAMA. Şirketin bilançosu, ihaleleri veya yapısal büyümesi güçlüyse, fiyattaki bu ralliyi bir balon olarak değil, şirketin yeni 'Adil Değerine' (Fair Value) çıkışı olarak değerlendir. Ayı/satış sinyalleri aramak yerine, fiyatın o bölgede konsolide olmasını tavsiye et.\n`;
        
        if (existingAsset) {
            extraInstruction += ` BİLGİ: Bu varlık (${cleanSymbol}) halihazırda fonumuzun portföyünde (Watchlist/Assets) yer almaktadır. Bu yüzden raporu mevcut durumu koruma veya ekleme minvalinde yorumlayabilirsin.`;
        } else {
            extraInstruction += ` BİLGİ: Bu varlık (${cleanSymbol}) fon portföyümüzde YOKTUR. Bu nedenle rapora MUTLAKA teknik analize veya makro döngülere dayanarak tahmini bir "Optimal Alım Fiyatı (Entry Price)" ÖNERMENİ İSTİYORUM. Bu alım tavsiyesini raporun bir alt başlığı olarak ekle.`;
        }

        const promptTemplate = `
Sen bir gelişmiş kurumsal yatırım danışmanısın (Hedge Fund Mimarisi).
Analiz Edilecek Varlık: ${cleanSymbol}
CANLI GÜNCEL FİYAT: $${currentPrice}

${extraInstruction}
BİLGİ: Yatırım stratejisi (PeriskopAI) şu şekilde çalışır:

1. Güvenli Liman Kuralı:
Herhangi bir hisseden satış tavsiyesi verdiğinde veya riski yüksek bulduğunda, sermayenin "XAR" (Savunma ETF'si) gibi güvenli limanlara park edilmesini öner. XAR, savunma harcamaları supercycle'ında istikrarlı büyüme potansiyeli taşır.

2. Satış ve Elinde Tutma Tetikleyicileri (Zorunlu Kurallar):
- Analist Downgrade'leri: 3+ güvenilir analist (Deutsche, Jefferies, Citi, Goldman, Barclays vb.) not kırarsa veya Hold/Neutral'a indirirse SATIŞ tavsiyesi verilir.
- İçeriden Satışlar: CEO/EVP kazanç raporu öncesi büyük miktarda hisse (Örn: $18M+) satarsa risk artar.
- Ana Gelir Modeli Riski: Şirketin core business'inde ciddi zorlanma (Pazar liderliği kaybı, düşük marj).
- Dava/Sınıf Davası Riski: Beklenen tazminat/settlement, şirketin EPS'sini vuracak düzeydeyse SAT.
- Beklenen Getiri Hesabı: 12 aylık risksiz getiri eşiğinin altındaysa SAT. Güçlü Bull Case varsa 2-3 çeyrek BEKLE ve düşük fiyattan Re-entry (Yeniden Giriş) planı yap.

3. ÇIKTI FORMATI:
Yanıtını KESİNLİKLE AŞAĞIDAKİ JSON FORMATINDA ver. Asla JSON dışında düz metin ekleme.
{
    "ceoScore": [0-100],
    "edgeScore": [0-100],
    "earningsScore": [0-100],
    "insiderScore": [0-100],
    "patentScore": [0-100],
    "sentimentPercent": [0-100],
    "summary": "120 karakterlik veri odaklı özet ve nihai SAT/TUT/BEKLE kararı",
    "detailedReport": "Aşağıdaki Örnek Analiz Şablonunu aynen kullanarak oluşturulmuş kapsamlı rapor."
}

*** JSON İÇİNDEKİ detailedReport ALANI İÇİN ZORUNLU MARKDOWN SATIR YAPISI ***
### Şirket: ${cleanSymbol}
**Orijinal Tez ve Finansal Durum:** [Kısa tez özeti, Bilanço ve Teknoloji Gücü]

**Kırılma Nedenleri ve Riskler:**
- **Analist Kesmeleri/Hedefleri:** [Kurumsal analist görüşleri ve güncel beklentiler]
- **İçeriden Satış ve Liderlik:** [CEO işlemleri, yönetimsel riskler, davalar]
- **Model ve Rekabet Riski:** [Derin pazardaki rakipler ve darboğaz durumu]
- **EV Hesabı:** [Beklenen return ve olasılık tahmini]

### Karar: SAT / BEKLE / TUT
**Re-entry (Yeniden Alım Koşulu):** [Potansiyel alım bölgesi veya geri çekilme koşulu]
`;

        const model = ai.getGenerativeModel({ model: "gemini-2.5-pro" });
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: promptTemplate }] }],
            generationConfig: { responseMimeType: "application/json" }
        });

        const text = result.response.text().trim();
        const parsed = JSON.parse(text);

        // Veritabanına Yaz / Güncelle
        await db.run("DELETE FROM ai_sentiments WHERE symbol = ?", [cleanSymbol]);
        await db.run(
           "INSERT INTO ai_sentiments (symbol, ceoScore, edgeScore, earningsScore, insiderScore, patentScore, sentimentPercent, summary, detailedReport) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
           [cleanSymbol, parsed.ceoScore || 0, parsed.edgeScore || 0, parsed.earningsScore || 0, parsed.insiderScore || 0, parsed.patentScore || 0, parsed.sentimentPercent || 0, parsed.summary, parsed.detailedReport]
        );

            } catch (asyncErr) {
                console.error("Async LLM Analyze Error:", asyncErr);
            } finally {
                delete global.processingAI[cleanSymbol];
            }
        })();

        return res.json({ success: true, status: "processing", cached: false });
    } catch (err) {
        console.error("LLM Initial Endpoint Error:", err);
        if (req.body && req.body.symbol) {
             delete global.processingAI[req.body.symbol.trim().toUpperCase()];
        }
        res.status(500).json({ error: 'LLM analiz işlemi başlatılamadı.' });
    }
});

// --- VARLIK (PORTFOLIO) API ---
app.get('/api/portfolio', async (req, res) => {
    try {
        let assets = await db.all("SELECT * FROM portfolio_assets ORDER BY allocatedPercentage DESC");
        
        // Dinamik 1000$ kasa oranlaması ve anlık kâr/zarar hesaplaması
        const baseCapital = 1000.00;
        assets = assets.map(asset => {
            if (asset.allocatedPercentage > 0 && asset.averageCost > 0) {
                // Dinamik Lot (Adet) Hesabı: Oranlanan Para / Kur Maliyeti = Adet.
                // Küsurat olmaması gereken varlıklarda veya tam sayılarda UI'da yuvarlıyoruz,
                // ama arka planda matematiksel netliği korumak için 2 ondalık bırakıyoruz.
                asset.quantity = parseFloat(((baseCapital * (asset.allocatedPercentage / 100)) / asset.averageCost).toFixed(2));
            }
            
            // Eğer Yahoo'dan canlı verisi çekiliyorsa Anlık Drawdown u on-the-fly yarat:
            if (global.nasdaqCache && global.nasdaqCache.stocks) {
                const cacheHit = global.nasdaqCache.stocks.find(s => s.symbol === asset.symbol);
                if (cacheHit && cacheHit.price > 0 && asset.averageCost > 0) {
                    // Maliyet ile Anlık Fiyat Arasındaki Çöküş % (Negatif ise Kâr)
                    asset.drawdown = parseFloat((((asset.averageCost - cacheHit.price) / asset.averageCost) * 100).toFixed(2));
                }
            }
            return asset;
        });

        res.json(assets);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/sentiments', async (req, res) => {
    try {
        const sentiments = await db.all("SELECT * FROM ai_sentiments ORDER BY createdAt DESC");
        res.json(sentiments);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/news', async (req, res) => {
    try {
        const news = await db.all("SELECT * FROM stock_news ORDER BY createdAt DESC LIMIT 30");
        res.json(news);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/news/analyze', async (req, res) => {
    try {
        const { newsId } = req.body;
        if (!newsId) return res.status(400).json({ error: "Lütfen incelemek için bir haber ID'si gönderin." });

        const newsItem = await db.get("SELECT title, content, relatedSymbols, summary, aiReport FROM stock_news WHERE id = ?", [newsId]);
        if (!newsItem) return res.status(404).json({ error: "Haber istihbaratı arşivde bulunamadı." });

        if (newsItem.aiReport) {
            return res.json({ success: true, report: newsItem.aiReport, cached: true });
        }

        // Eğer news_agent.js zaten yeni şablonda bir 2-bölümlü detaylı özet çıkardıysa, onu direkt rapor olarak kullanabiliriz.
        if (newsItem.summary && newsItem.summary.includes('DETAYLI ANALİZ RAPORU')) {
            await db.run("UPDATE stock_news SET aiReport = ? WHERE id = ?", [newsItem.summary, newsId]);
            return res.json({ success: true, report: newsItem.summary, cached: true });
        }

        const prompt = `Sen bir finansal haber analisti yapay zekasısın. Görevin; haber kaynaklarından çekilen haberi işleyerek kullanıcılara iki ayrı bölüm halinde (KISA HABER ÖZETİ ve DETAYLI ANALİZ RAPORU) sunum yapmaktır.

Haber Başlığı: ${newsItem.title}
Etkilenen Varlık/Şirketler: ${newsItem.relatedSymbols || "Genel Piyasa"}
Haber İçeriği: ${newsItem.content}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. BÖLÜM — HABER ÖZETİ YAZMA KURALLARI
- Maksimum 5 cümle yaz. 6. cümleye asla geçme.
- Haberi kopyalama, kendi sade Türkçenle "Kim, ne yaptı, neden önemli" diye özetle.
- Yorum yapma, sadece olayı aktar.

2. BÖLÜM — ETKİ ETİKETİ ve RENK KURALLARI
Şirketin tekel/pazar konumunu (Apple/Google vb.) ve bağımlılıklarını gözeterek karar ver.
Analizin sonucuna göre Raporun TEPE NOKTASINA şu seçeneklerden birini ekle:
✅ POZİTİF ETKİ
🔴 NEGATİF ETKİ
⚪ NÖTR/KARIŞIK

3. BÖLÜM — DETAYLI ANALİZ RAPORU YAZMA
Özetin ALTINDA, şu şablonla detaylı rapor yaz:
📊 ETKİ PUANI: [ -5 ile +5 arası ] — [Etiket adı]
✅ OLUMLU YÖNLER
- (1-2 cümlelik kanıtlı madde)
⚠️ RİSKLER / OLUMSUZ YÖNLER
- (Sıfır spekülasyon, sıfır "intihar" vb dramatik kelime)
🔍 ANALİST YORUMU
(2-3 cümle dengeli, gerçekçi yorum)

4. BÖLÜM — İLGİLİ HİSSE ÇIKARIMI KURALI (SECOND-ORDER EFFECT)
Raporun EN SONUNA, haberden NET VE AÇIK biçimde etkilenecek diğer gizli şirketleri ekle.
Kriterler (TAMAMI KARŞILANMALI, emin değilsen %90 boş bırak):
- ETKİ NET OLMALI: Zincirleme dolaylı çıkarım yapma (Çin nükleer denizaltı -> HII, GD, BWXT doğrudan savunma hissesidir = DOĞRU. Denizaltı -> Yakıt artar -> XOM = YANLIŞ).
- ABD BORSASI: Sadece NYSE/NASDAQ.
- SEKTÖR OYUNCUSU: Doğrudan iş yapanlar eklenir, genel holdingler değil.
- YÖN NET OLMALI: Pozitif veya Negatif olduğu tartışmasız olmalı.
(Savunma: HII, GD, BWXT, LMT vb.) | (Çip: NVDA, TSM, ASML vb.) | (Yapay Zeka: MSFT, GOOGL, ORCL)

Format (Kriter uyan bulursan):
📌 HABERİN ETKİLEYEBİLECEĞİ DİĞER HİSSELER
[Şirket Adı — Ticker] → [POZİTİF / NEGATİF]
Gerekçe: (Tek cümle)
*(Eğer kriterleri karşılayan hisse çıkmazsa bu bölümü HİÇ YAZMA, metne ekleme)*

Tüm çıktıyı Markdown formatında şık ve bold kısımlarla güçlendirerek ver.`;

        const model = ai.getGenerativeModel({ model: "gemini-3.1-pro-preview" });
        const result = await model.generateContent(prompt);
        let deepDive = result.response.text();

        // Arşive kaydet
        await db.run("UPDATE stock_news SET aiReport = ? WHERE id = ?", [deepDive, newsId]);

        res.json({ success: true, report: deepDive, cached: false });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/portfolio/rebalance', async (req, res) => {
    try {
        const result = await triggerRebalance();
        if (result.success) {
            res.json(result);
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/portfolio/liquidate', async (req, res) => {
    try {
        const { symbol } = req.body;
        if (!symbol || symbol === 'XAR') {
            return res.status(400).json({ error: "Geçersiz sembol veya XAR doğrudan likide edilemez." });
        }

        const assetToSell = await db.get("SELECT allocatedPercentage FROM portfolio_assets WHERE symbol = ?", [symbol]);
        if (!assetToSell || assetToSell.allocatedPercentage <= 0) {
            return res.status(404).json({ error: "Satılacak bakiye bulunamadı." });
        }

        const sellAmount = assetToSell.allocatedPercentage;
        
        await db.run("UPDATE portfolio_assets SET allocatedPercentage = 0 WHERE symbol = ?", [symbol]);
        await db.run("UPDATE portfolio_assets SET allocatedPercentage = allocatedPercentage + ? WHERE symbol = 'XAR'", [sellAmount]);
        
        res.json({ success: true, message: `${symbol} başarıyla satıldı ve fonlar XAR ETF'ine aktarıldı.` });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  // Tarayıcıyı Başlat
  startScanner();
  // Makro Scanner içerisinden çalışıyor, burada intervala gerek yok
});
