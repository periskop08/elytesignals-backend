const YFClass = require('yahoo-finance2').default;
const yahooFinance = new YFClass();
const db = require('./database');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const TelegramBot = require('node-telegram-bot-api');
const { RSI, EMA } = require('technicalindicators');
require('dotenv').config();

let ai = null;
if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

let telegramBot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
}

async function runDailyScreener() {
    console.log("[ALTAY_BEY] Otomatik günluk borsa taramasi basliyor...");

    if (!ai) {
        console.error("[ALTAY_BEY] Gemini API Key bulunamadi, tarama durduruldu.");
        return;
    }

    try {
        // Find best candidates dynamically using Yahoo Screener. 
        // We look broadly at multiple screeners to find aggressive opportunities.
        const queryOptionsList = [
            { scrIds: 'day_gainers', count: 5 },
            { scrIds: 'aggressive_small_caps', count: 5 },
            { scrIds: 'undervalued_growth_stocks', count: 5 }
        ];

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

        let potentialSymbols = [];
        if (sp500State.includes("YÜKSEK RİSK")) {
            console.log("[ALTAY_BEY] Piyasada ÇÖKÜŞ var. Inverse ETF'ler taranacak (SQQQ, SH).");
            potentialSymbols.push("SQQQ", "SH"); 
        }
        for (const q of queryOptionsList) {
            try {
                const res = await yahooFinance.screener(q);
                if (res && res.quotes) {
                    res.quotes.forEach(q => potentialSymbols.push(q.symbol));
                }
            } catch(err) {
                 console.error(`[ALTAY_BEY] Screener ${q.scrIds} error:`, err.message);
            }
        }
        
        // Uniquify symbols
        potentialSymbols = [...new Set(potentialSymbols)].filter(Boolean);
        if (potentialSymbols.length === 0) {
            console.log("[ALTAY_BEY] Tarayici hisse bulamadi.");
            return;
        }

        console.log(`[ALTAY_BEY] Toplam ${potentialSymbols.length} ham aday bulundu. Yapay zeka filteresine giriyor...`);

        // Check against existing portfolio assets to only discover NEW ones
        const existingRows = await db.all("SELECT symbol FROM portfolio_assets");
        const existingSet = new Set(existingRows.map(r => r.symbol));
        const newCandidates = potentialSymbols.filter(s => !existingSet.has(s)).slice(0, 5); // Limit to top 5 fresh candidates per day to respect API limits

        if (newCandidates.length === 0) {
            console.log("[ALTAY_BEY] Yeni hisse adayi bulunamadi.");
            return;
        }

        console.log(`[ALTAY_BEY] Gemini ${newCandidates.length} adayi inisellestiriyor:`, newCandidates);

        let addedAny = false;

        for (const symbol of newCandidates) {
            try {
                // Fetch basic fundamental info for the prompt or baseline
                let currentPrice = 0;
                let metricsObj = {};
                try {
                     const qs = await yahooFinance.quoteSummary(symbol, { modules: ['price', 'defaultKeyStatistics', 'financialData'] });
                     currentPrice = qs?.price?.regularMarketPrice || 0;
                     metricsObj.pegRatio = qs?.defaultKeyStatistics?.pegRatio !== undefined ? qs.defaultKeyStatistics.pegRatio.toFixed(2) : "Bilinmiyor";
                     metricsObj.forwardPE = qs?.defaultKeyStatistics?.forwardPE !== undefined ? qs.defaultKeyStatistics.forwardPE.toFixed(2) : "Bilinmiyor";
                     metricsObj.trailingPE = qs?.defaultKeyStatistics?.trailingPE !== undefined ? qs.defaultKeyStatistics.trailingPE.toFixed(2) : "Bilinmiyor";
                     metricsObj.priceToSales = qs?.defaultKeyStatistics?.priceToSalesTrailing12Months !== undefined ? qs.defaultKeyStatistics.priceToSalesTrailing12Months.toFixed(2) : "Bilinmiyor";
                     metricsObj.fcf = qs?.financialData?.freeCashflow ? `$${(qs.financialData.freeCashflow / 1e9).toFixed(2)} Milyar` : "Bilinmiyor";
                     metricsObj.debtToEbitda = (qs?.financialData?.totalDebt && qs?.financialData?.ebitda) ? (qs.financialData.totalDebt / qs.financialData.ebitda).toFixed(2) : "Bilinmiyor";
                     metricsObj.revenueGrowth = qs?.financialData?.revenueGrowth !== undefined ? (qs.financialData.revenueGrowth * 100).toFixed(2) + "%" : "Bilinmiyor";
                } catch(e) {}

                let swingData = { rsi: "Bilinmiyor", ema50: "Bilinmiyor", ema200: "Bilinmiyor", trend: "Bilinmiyor" };
                try {
                    const today = new Date();
                    const yearAgo = new Date(today);
                    yearAgo.setFullYear(today.getFullYear() - 1); 
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

                // Kantan Haber İstihbaratını DB'den çek
                let newsContextTexts = [];
                try {
                    const recentNews = await db.all("SELECT title, summary, relatedSymbols, sentimentScore FROM stock_news WHERE relatedSymbols LIKE ? ORDER BY createdAt DESC LIMIT 5", ['%' + symbol + '%']);
                    if (recentNews && recentNews.length > 0) {
                        newsContextTexts = recentNews.map(n => `- ${n.title}: ${n.summary} (Duygu Skoru: ${n.sentimentScore}/100)`);
                    }
                } catch(e) {}

                const promptTemplate = `
Sen **Investment Agent AI (Hamdi Bey)**'sin – Kıdemli Adli Finansal Analist ve Nicel Quant Fon Başkanı. Görevin: Sadece bilanço okumak değil, piyasa trendlerini (Swing Trading) ve Makro Çöküş koşullarını tarayarak "Spot Hisse veya Ters ETF" kararlarını matematiksel/teknik mükemmellikle vermektir. Yarı iletken, savunma ve inovasyon teknoloji hisselerine (ve çöküşte SQQQ gibi defanslara) odaklanırsın.

Analiz Edilecek Varlık: ${symbol}
Güncel Fiyat: $${currentPrice}

${newsContextTexts.length > 0 ? `=== KANTAN.NEWS İSTİHBARAT RAPORU (SON 48 SAAT) ===\n${newsContextTexts.join('\n')}\n==========================\n` : ''}
=== TEMEL FINANSAL VERİ SETİ ===
- PEG Oranı: ${metricsObj.pegRatio}
- İleri F/K (PE): ${metricsObj.forwardPE}
- FCF (Serbest Nakit): ${metricsObj.fcf}
- Borç / FAVÖK: ${metricsObj.debtToEbitda}
- Gelir Büyümesi: ${metricsObj.revenueGrowth}

=== MAKRO (SP500) DURUMU ===
- SP500 Risk Seviyesi: ${sp500State}

=== GÜNLÜK (SWING) TEKNİK VERİLERİ ===
- Genel Trend (EMA50 / EMA200 Kıyası): ${swingData.trend}
- Günlük EMA 50: $${swingData.ema50}
- Günlük EMA 200: $${swingData.ema200}
- Günlük RSI (14): ${swingData.rsi}
==========================

**Hamdi Bey Taktik Kuralları & Şablonları (Option C):**

1. **SWING TRADE STRATEJİSİ (Hisse Long Yönlü)**:
    - Günlük RSI 30 civarındaysa (Aşırı Satım) ve bilanço kaliteliyse: Harika Fırsat!
    - Günlük fiyat EMA 200'e temas ediyorsa (Destek reaksiyonu): Harika Fırsat!
    - Eğer RSI > 70 ise ve fiyat EMA50'den çok uzaklaşmışsa: İşlem Açma! (Ekstrapahalı Balonu). Büyüme/Nakit akışı çok iyi olsa bile tekniğe sadık kal ve Skoru düşür.

2. **INVERSE ETF VE NAKİT DEFANSI**:
    - Analiz edilen varlık "SQQQ" veya "SH" gibi bir Ters ETF ise ve SP500 durumu "🔴 YÜKSEK RİSK" moduna geçmişse: Bu varlığa EN YÜKSEK PUANI (95+) VER! Ters ETF'yi sepetimize sigorta (Hedge) amaçlı eklememizi sağla. Makro çöküşlerde hisse senedi değil Ters Fon almak birincil önceliğindir!

3. **GENEL İŞLEM VE DEĞERLEME KURALI**:
    - Gelir artarken Kâr Marjı daralıyorsa "Pazar Payı için Fiyat Kırma" riskidir.
    - Şirketin P/E, PEG çarpanı aşırı primliyse "Balon" de.

ZORUNLU ÇIKTI FORMATI:
Yanıtını KESİNLİKLE JSON FORMATINDA ver.
{
    "ceoScore": [0-100 Liderlik Kalitesi],
    "edgeScore": [0-100 Makro/Teknik/Moat Uyumu Puanı],
    "earningsScore": [0-100 Bilanço ve Trend Onay Puanı],
    "insiderScore": [0-100 Risk Yönetim / Defans Puanı],
    "patentScore": [0-100 Eko-Sistem/Patent Puanı],
    "sentimentPercent": [0-100 Karar Gücü Puanı. 85+ ise kesin PORTFÖYE EKLENİR (AL)],
    "entryPriceTarget": [0.00 şeklinde Optimal Alım (Destek MA) Fiyat Tahmini],
    "summary": "120 karakterlik (Ucuz/Adil/Pahalı) durum özeti ve nihai AL/SAT kararı",
    "detailedReport": "Aşağıdaki kurala uygun kapsamlı metin (JSON yapısını bozmadan)"
}

*** JSON İÇİNDEKİ detailedReport ALANI İÇİN KAPSAMLI ŞABLON (Markdown olarak) ***
### Varlık Analizi ve Swing Trend Tezi: ${symbol}
1. **Swing Teknik ve Makro Konum**: [RSI durumu, EMA destekleri ve mevcut SP500 makro çöküş riskine göre varlığın alım bölgesinde olup olmadığının tespiti.]
2. **Finansal Metrikler ve Moat Değerlemesi**: [Büyüme durumu, FCF ve P/E kıyası. Nihai kararın (Ucuz/Adil/Pahalı) belirtilmesi.]
3. **Katalizörler ve Ekosistem Ağı**: [Kantan News istihbaratındaki stratejik anlaşmaların etkisi.]
4. **DEĞERLEME VE REKABET RİSKLERİ**: [AI Yıkım riski veya aşırı fiyatlama riski.]
5. **Optimal Alım Fiyatı ve Teknik Strateji**:
   - **Destek Alımı**: [Tahmini EMA destek seviyesi.]
   - **Upside Breakout**: [Direnç kırılımı stratejisi.]
`;

                const model = ai.getGenerativeModel({ model: "gemini-3.1-pro-preview" });
                const result = await model.generateContent({
                    contents: [{ role: "user", parts: [{ text: promptTemplate }] }],
                    generationConfig: { responseMimeType: "application/json" }
                });

                const text = result.response.text().trim();
                const parsed = JSON.parse(text);

                // AI Approval Threshold check
                if (parsed.sentimentPercent > 85) {
                    console.log(`[ALTAY_BEY] ${symbol} basariyla incelendi ve skor: ${parsed.sentimentPercent}. Portfoye ekleniyor.`);
                    
                    // Insert into AI Sentiments database
                    await db.run("DELETE FROM ai_sentiments WHERE symbol = ?", [symbol]);
                    await db.run(
                       "INSERT INTO ai_sentiments (symbol, ceoScore, edgeScore, earningsScore, insiderScore, patentScore, sentimentPercent, summary, detailedReport) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                       [symbol, parsed.ceoScore || 0, parsed.edgeScore || 0, parsed.earningsScore || 0, parsed.insiderScore || 0, parsed.patentScore || 0, parsed.sentimentPercent || 0, parsed.summary, parsed.detailedReport]
                    );

                    // Insert into Portfolio Asset (2% immediate, 3% pending weighting allocation!)
                    const qty = currentPrice > 0 ? Math.floor((500 * 0.02) / currentPrice) : 1;
                    const entryTarget = parsed.entryPriceTarget ? parseFloat(parsed.entryPriceTarget) : 0;
                    
                    await db.run(
                        "INSERT INTO portfolio_assets (symbol, type, allocatedPercentage, averageCost, quantity, aiScore, ceoScore, edgeScore, insiderScore, patentScore, lastStatus, pendingPercentage, pendingEntryPrice) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        [symbol, 'STOCK', 2, currentPrice || 0, qty || 1, parsed.sentimentPercent || 0, parsed.ceoScore || 0, parsed.edgeScore || 0, parsed.insiderScore || 0, parsed.patentScore || 0, 'ACTIVE', 3, entryTarget]
                    );

                    // Send Telegram Alert safely
                    if (telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
                        const msg = `🚀 *YAPAY ZEKA FIRSAT KEŞFİ!*\n\nAltay Bey, Amerikan borsasındaki taramalarda yüksek potansiyelli bir hisse tespit etti ve portföye  *%5 ağırlıkla* dahil etti!\n\n💎 *Hisse:* GİZLİ (Premium)\n🎯 *AI Skoru:* ${parsed.sentimentPercent}/100\n💼 *Sektör Teknoloji/Inovasyon:* ${parsed.edgeScore}/100\n\n📌 _Hissenin çok kapsamlı Gemini 3.1 Pro detaylı fon raporu an itibariyle Varlık Yöneticisi sekmesine yüklendi, hemen siteye göz atabilirsiniz._`;
                        telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, msg, { parse_mode: 'Markdown' }).catch(e => console.error("Telegram error:", e));
                    }
                    
                    addedAny = true;
                } else {
                    console.log(`[ALTAY_BEY] ${symbol} skoru dusuk kaldi (${parsed.sentimentPercent}). Elendi.`);
                }
            } catch (evalErr) {
                console.error(`[ALTAY_BEY] ${symbol} analiz hatasi:`, evalErr.message);
            }
            
            // Wait 5 seconds between evaluating candidates to avoid Rate Limiting
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
    } catch(err) {
        console.error("[ALTAY_BEY] Engine Main Error:", err);
    }
}

module.exports = { runDailyScreener };
