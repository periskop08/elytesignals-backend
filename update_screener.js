const fs = require('fs');
const filePath = './screener_engine.js';
let data = fs.readFileSync(filePath, 'utf8');

// 1. Add RSI, EMA import
data = data.replace("const { GoogleGenerativeAI } = require('@google/generative-ai');", 
"const { GoogleGenerativeAI } = require('@google/generative-ai');\nconst { RSI, EMA } = require('technicalindicators');");

// 2. We will inject SP500 Check before the main loop
const sp500Check = `
        console.log("[ALTAY_BEY] Makro S&P 500 Çöküş Radarı Kontrol Ediliyor...");
        let sp500State = "DÜŞÜK RİSK (BULL MARKET)";
        try {
            const today = new Date();
            const yearAgo = new Date(today);
            yearAgo.setFullYear(today.getFullYear() - 1);
            const spData = await yahooFinance.historical('^GSPC', { period1: yearAgo.toISOString().split('T')[0], interval: '1d' });
            if (spData && spData.length > 200) {
                const spCloses = spData.map(d => d.close);
                const spEma200 = EMA.calculate({ values: spCloses, period: 200 });
                const currentSpPrice = spCloses[spCloses.length - 1];
                const ema200Value = spEma200[spEma200.length - 1];
                
                if (currentSpPrice < ema200Value) {
                    sp500State = "🔴 YÜKSEK RİSK (ÇÖKÜŞ SİNYALİ - SP500 EMA200 ALTINDA)";
                } else if (currentSpPrice < spCloses[spCloses.length - 20]) {
                    sp500State = "🟡 ORTA RİSK (Kısa Vadeli Düzeltme)";
                }
            }
        } catch(e) { console.log("SP500 Check Error:", e.message); }
`;
data = data.replace(`        let potentialSymbols = [];`, `${sp500Check}\n        let potentialSymbols = [];`);

// 3. Instead of filtering just "day_gainers" etc, we ADD 'SQQQ' and 'SH' to potential symbols so Hamdi Bey analyzes them too IF the market is crashing!
const dynamicSymbols = `
        let potentialSymbols = [];
        if (sp500State.includes("YÜKSEK RİSK")) {
            console.log("[ALTAY_BEY] Piyasa Cokus Sinyali, Inverse ETF'ler Taramaya Ekleniyor (SQQQ, SH).");
            potentialSymbols.push("SQQQ", "SH"); // Inverse ETFs
        }
`;
data = data.replace("let potentialSymbols = [];", dynamicSymbols);

// 4. Inject Historical Data calculation inside the symbol loop
const historicalInjection = `
                let swingData = { rsi: "Bilinmiyor", ema50: "Bilinmiyor", ema200: "Bilinmiyor", trend: "Bilinmiyor" };
                try {
                    const today = new Date();
                    const yearAgo = new Date(today);
                    yearAgo.setFullYear(today.getFullYear() - 1); // Get 1 year for 200 EMA
                    const hist = await yahooFinance.historical(symbol, { period1: yearAgo.toISOString().split('T')[0], interval: '1d' });
                    if (hist && hist.length > 200) {
                        const closes = hist.map(h => h.close);
                        const rsiVals = RSI.calculate({ values: closes, period: 14 });
                        const ema50Vals = EMA.calculate({ values: closes, period: 50 });
                        const ema200Vals = EMA.calculate({ values: closes, period: 200 });
                        
                        swingData.rsi = rsiVals.length > 0 ? rsiVals[rsiVals.length - 1].toFixed(2) : "Bilinmiyor";
                        swingData.ema50 = ema50Vals.length > 0 ? ema50Vals[ema50Vals.length - 1].toFixed(2) : "Bilinmiyor";
                        swingData.ema200 = ema200Vals.length > 0 ? ema200Vals[ema200Vals.length - 1].toFixed(2) : "Bilinmiyor";
                        
                        if (currentPrice > parseFloat(swingData.ema50) && currentPrice > parseFloat(swingData.ema200)) {
                            swingData.trend = "Trend Yukarı (Boğa)";
                        } else if (currentPrice < parseFloat(swingData.ema50) && currentPrice < parseFloat(swingData.ema200)) {
                            swingData.trend = "Trend Aşağı (Çöküş/Ayı)";
                        } else {
                            swingData.trend = "Yatay / Konsolidasyon";
                        }
                    }
                } catch(e) { console.error("Swing Data Fetch Error:", e.message); }
`;
data = data.replace("                // Kantan Haber İstihbaratını DB'den çek", `${historicalInjection}\n                // Kantan Haber İstihbaratını DB'den çek`);

fs.writeFileSync(filePath, data);
console.log("Pre-prompt injections complete.");
