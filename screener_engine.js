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
Sen bir gelişmiş kurumsal yatırım danışmanısın (Hedge Fund Mimarisi).
Analiz Edilecek (Screener'dan düşen yeni) Varlık: ${symbol}
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
Yanıtını KESİNLİKLE JSON FORMATINDA ver. Asla JSON formatı dışında düz metin kullanma.
{
    "ceoScore": [0-100],
    "edgeScore": [0-100],
    "earningsScore": [0-100],
    "insiderScore": [0-100],
    "patentScore": [0-100],
    "sentimentPercent": [0-100],
    "summary": "120 karakterlik veri odaklı özet ve nihai AL/SAT/TUT/BEKLE kararı",
    "detailedReport": "Aşağıdaki Örnek Analiz Şablonunu aynen kullanarak oluşturulmuş kapsamlı rapor."
}

*** JSON İÇİNDEKİ detailedReport ALANI İÇİN ZORUNLU MARKDOWN SATIR YAPISI ***
### Şirket: ${symbol}
**Orijinal Tez ve Finansal Durum:** [Yukarıdaki veri setini referans alarak tez özeti, Bilanço ve Teknoloji Gücü]

**Kırılma Nedenleri ve Riskler:**
- **Analist Kesmeleri/Hedefleri:** [Kurumsal analist görüşleri ve güncel beklentiler]
- **İçeriden Satış ve Liderlik:** [CEO işlemleri, yönetimsel riskler, Kongre/Senato (Insider) alım-satım hareketleri]
- **Model ve Rekabet Riski:** [Derin pazardaki rakipler ve darboğaz durumu]
- **EV Hesabı:** [Beklenen return ve olasılık tahmini]

### Karar: AL / SAT / BEKLE / TUT
**Re-entry (Yeniden Alım Koşulu):** [Potansiyel alım bölgesi veya geri çekilme koşulu]
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
