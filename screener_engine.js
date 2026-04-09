const YFClass = require('yahoo-finance2').default;
const yahooFinance = new YFClass();
const db = require('./database');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const TelegramBot = require('node-telegram-bot-api');
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
    console.log("[AI SCREENER] Otomatik günluk borsa taramasi basliyor...");

    if (!ai) {
        console.error("[AI SCREENER] Gemini API Key bulunamadi, tarama durduruldu.");
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

        let potentialSymbols = [];
        for (const q of queryOptionsList) {
            try {
                const res = await yahooFinance.screener(q);
                if (res && res.quotes) {
                    res.quotes.forEach(q => potentialSymbols.push(q.symbol));
                }
            } catch(err) {
                 console.error(`[AI SCREENER] Screener ${q.scrIds} error:`, err.message);
            }
        }
        
        // Uniquify symbols
        potentialSymbols = [...new Set(potentialSymbols)].filter(Boolean);
        if (potentialSymbols.length === 0) {
            console.log("[AI SCREENER] Tarayici hisse bulamadi.");
            return;
        }

        console.log(`[AI SCREENER] Toplam ${potentialSymbols.length} ham aday bulundu. Yapay zeka filteresine giriyor...`);

        // Check against existing portfolio assets to only discover NEW ones
        const existingRows = await db.all("SELECT symbol FROM portfolio_assets");
        const existingSet = new Set(existingRows.map(r => r.symbol));
        const newCandidates = potentialSymbols.filter(s => !existingSet.has(s)).slice(0, 5); // Limit to top 5 fresh candidates per day to respect API limits

        if (newCandidates.length === 0) {
            console.log("[AI SCREENER] Yeni hisse adayi bulunamadi.");
            return;
        }

        console.log(`[AI SCREENER] Gemini ${newCandidates.length} adayi inisellestiriyor:`, newCandidates);

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

                const promptTemplate = `
Sen bir Wall Street Hedge Fund Quants Yöneticisisin. Sana gönderilen yeni ve gözden kaçmış olabilecek potansiyel hisse senedi hakkında detaylı bir "Investment Thesis" (Yatırım Tezi) oluştur.

Analiz Edilecek (Screener'dan düşen) Varlık: ${symbol}
Güncel Fiyat: $${currentPrice}

=== FINANSAL VERİ SETİ (Genişletilmiş) ===
- PEG Oranı: ${metricsObj.pegRatio}
- İleri F/K (Forward PE): ${metricsObj.forwardPE}
- Güncel F/K (Trailing PE): ${metricsObj.trailingPE}
- Fiyat/Satış (P/S): ${metricsObj.priceToSales}
- Serbest Nakit Akışı (FCF): ${metricsObj.fcf}
- Borç / FAVÖK: ${metricsObj.debtToEbitda}
- Çeyreklik Gelir Büyümesi: ${metricsObj.revenueGrowth}
==========================================

BİLGİ: Bu varlık (${symbol}) henüz portföyümüzde DEĞİL. Bu hissenin yüksek potansiyelli bir hisse olup olmadığını incele ve rapora MUTLAKA teknik analize (destek/direnç, FVG, vs.) veya makro döngülere dayanarak tahmini bir "Optimal Alım Fiyatı (Entry Price) ve Kademeli Alım Bölgesi" ÖNERMENİ İSTİYORUM.

ÇOK ÖNEMLİ KURALLAR:
1. "summary" ve "detailedReport" ALANLARININ TAMAMINI %100 TÜRKÇE VE AKICI YAZACAKSIN.
2. "detailedReport" ALANI ÇOK DETAYLI, UZUN VE KAPSAMLI OLMALIDIR (En az 500 kelime). Raporu tam olarak şu Markdown başlıklarıyla yapılandır:

   - ### 1. Genişletilmiş Finansal İzleme Tablosu
   (Bu başlığın tam altına PEG, F/K, P/S, Nakit Akışı gibi *yukarıda sağladığım* metrikleri kullanan vizyoner ve şık bir Markdown tablosu ekle ve rakamları profesyonelce yorumla. Tablonun çok anlaşılır olmasına dikkat et.)
   
   - ### 2. Mükemmel Şirket ve Çarpan Şişkinliği Riski (Paslanma Etkisi)
   (Aşırı büyüme (Hyper-growth), Teknoloji veya Savunma şirketlerini analiz ederken piyasa doygunluğunu ve Çarpan Şişkinliği riskini göz önüne al. Şirket harika bile olsa, operasyonel hantallaşma durumu ve fiyat çarpanlarının zirveye ulaşma riskini (Paslanma Etkisi) eleştirerek uyar. 'Sadece iyi şirket diye her fiyattan alınmaz' disipliniyle risk analizi yap.)
   
   - ### 3. Teknolojik/Operasyonel Keskinlik (Edge Score)
   - ### 4. Liderlik, Kongre/Senato İşlemleri (Insider) ve Bilanço Özeti
   (Bu başlıkta şirketin CEO kalitesini ve özellikle ABD Kongre Üyeleri/Senatör alımlarını (Insider Trading) analiz et. Kararlarında @pelositracker'ın politikacı para izi ve @Beth_Kindig'in agresif teknoloji büyüme vizyonunu birleştirerek yorum yap.)
   
   - ### 5. Wall Street Görüşleri ve Kurumsal Hedef Fiyatlar
   - ### 6. Antigravity (AI) Nihai Kararı ve Kademeli Alım Tavsiyesi

3. BAŞLIK 5 (Kurumsal Hedef Fiyatlar) GÖREVİ ÇOK KRİTİKTİR: Analist yorumlarını KESİNLİKLE en son açıklanan güncel bilançolara göre al! Mutlaka spesifik kurumsal analist (Goldman Sachs vb.) güncel fiyat tahminleri yaz (yılın 2026 olduğunu unutma).
4. Her başlığın altını, yatırım jargonlarıyla çok detaylı doldur. Rapor yarım kesilmemelidir.

Lütfen SADECE JSON FORMATINDA YANIT VER:
{
    "ceoScore": [0-100],
    "edgeScore": [0-100],
    "earningsScore": [0-100],
    "insiderScore": [0-100],
    "patentScore": [0-100],
    "sentimentPercent": [0-100],
    "summary": "120 karakterlik Türkçe özet",
    "detailedReport": "Markdown formatında 500 kelimelik analiz."
}`;

                const model = ai.getGenerativeModel({ model: "gemini-3.1-pro-preview" });
                const result = await model.generateContent({
                    contents: [{ role: "user", parts: [{ text: promptTemplate }] }],
                    generationConfig: { responseMimeType: "application/json" }
                });

                const text = result.response.text().trim();
                const parsed = JSON.parse(text);

                // AI Approval Threshold check
                if (parsed.sentimentPercent > 85) {
                    console.log(`[AI SCREENER] ${symbol} basariyla incelendi ve skor: ${parsed.sentimentPercent}. Portfoye ekleniyor.`);
                    
                    // Insert into AI Sentiments database
                    await db.run("DELETE FROM ai_sentiments WHERE symbol = ?", [symbol]);
                    await db.run(
                       "INSERT INTO ai_sentiments (symbol, ceoScore, edgeScore, earningsScore, insiderScore, patentScore, sentimentPercent, summary, detailedReport) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                       [symbol, parsed.ceoScore || 0, parsed.edgeScore || 0, parsed.earningsScore || 0, parsed.insiderScore || 0, parsed.patentScore || 0, parsed.sentimentPercent || 0, parsed.summary, parsed.detailedReport]
                    );

                    // Insert into Portfolio Asset (5% fixed weighting allocation!)
                    const qty = currentPrice > 0 ? Math.floor((500 * 0.05) / currentPrice) : 10;
                    await db.run(
                        "INSERT INTO portfolio_assets (symbol, type, allocatedPercentage, averageCost, quantity, aiScore, ceoScore, edgeScore, insiderScore, patentScore, lastStatus) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        [symbol, 'STOCK', 5, currentPrice || 0, qty || 1, parsed.sentimentPercent || 0, parsed.ceoScore || 0, parsed.edgeScore || 0, parsed.insiderScore || 0, parsed.patentScore || 0, 'ACTIVE']
                    );

                    // Send Telegram Alert safely
                    if (telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
                        const msg = `🚀 *YAPAY ZEKA FIRSAT KEŞFİ!*\n\nAntigravity Screener, Amerikan borsasındaki taramalarda yüksek potansiyelli bir hisse tespit etti ve portföye  *%5 ağırlıkla* dahil etti!\n\n💎 *Hisse:* GİZLİ (Premium)\n🎯 *AI Skoru:* ${parsed.sentimentPercent}/100\n💼 *Sektör Teknoloji/Inovasyon:* ${parsed.edgeScore}/100\n\n📌 _Hissenin çok kapsamlı Gemini 3.1 Pro detaylı fon raporu an itibariyle Varlık Yöneticisi sekmesine yüklendi, hemen siteye göz atabilirsiniz._`;
                        telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, msg, { parse_mode: 'Markdown' }).catch(e => console.error("Telegram error:", e));
                    }
                    
                    addedAny = true;
                } else {
                    console.log(`[AI SCREENER] ${symbol} skoru dusuk kaldi (${parsed.sentimentPercent}). Elendi.`);
                }
            } catch (evalErr) {
                console.error(`[AI SCREENER] ${symbol} analiz hatasi:`, evalErr.message);
            }
            
            // Wait 5 seconds between evaluating candidates to avoid Rate Limiting
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
    } catch(err) {
        console.error("[AI SCREENER] Engine Main Error:", err);
    }
}

module.exports = { runDailyScreener };
