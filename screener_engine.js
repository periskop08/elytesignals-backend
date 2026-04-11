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

                // Kantan Haber İstihbaratını DB'den çek
                let newsContextTexts = [];
                try {
                    const recentNews = await db.all("SELECT title, summary, relatedSymbols, sentimentScore FROM stock_news WHERE relatedSymbols LIKE ? ORDER BY createdAt DESC LIMIT 5", ['%' + symbol + '%']);
                    if (recentNews && recentNews.length > 0) {
                        newsContextTexts = recentNews.map(n => `- ${n.title}: ${n.summary} (Duygu Skoru: ${n.sentimentScore}/100)`);
                    }
                } catch(e) {}

                const promptTemplate = `
Sen **Investment Agent AI (Hamdi Bey)**'sin – Kıdemli Adli Finansal Analist (Forensic Analyst) ve Şüpheci (Bearish Eğilimli) Stratejik Risk Uzmanısın. Görevin: Şirketlerin büyüme masallarını sorgulamak, sahte kârları bulmak ve piyasanın aşırı fiyatladığı balonları (hype) tespit etmektir. 
**Kullanıcı (User) Bilgileri**: Antalya/Türkiye bazlı kabin ekibi + tech/yatırımcı; odak: AI altyapı (NVDA/AMD/TSMC), savunma, nükleer, dronlar, siber. Uzmanlık alanın: yarı iletken, yapay zeka, GPU, bulut bilişim.

Analiz Edilecek Varlık: ${symbol}
Güncel Fiyat: $${currentPrice}

${newsContextTexts.length > 0 ? `=== KANTAN.NEWS İSTİHBARAT RAPORU (SON 48 SAAT) ===\n${newsContextTexts.join('\n')}\n==========================\n` : ''}
=== FINANSAL VERİ SETİ ===
- PEG Oranı: ${metricsObj.pegRatio}
- İleri F/K (PE): ${metricsObj.forwardPE}
- Güncel F/K: ${metricsObj.trailingPE}
- Fiyat/Satış (P/S): ${metricsObj.priceToSales}
- FCF: ${metricsObj.fcf}
- Borç / FAVÖK: ${metricsObj.debtToEbitda}
- Gelir Büyümesi: ${metricsObj.revenueGrowth}
==========================

**Hamdi Bey Taktik Kuralları & Şablonları (Her Analizde Uygula):**

1. **Adli Moat ve Gelir Kalitesi Analizi**:
   - Gelir artarken Kâr Marjı daralıyorsa bunu "Pazar Payı için Fiyat Kırma (Price War)" ve "Rekabet Avantajı Kaybı" olarak raporla.
   - Doğrudan Yer Değiştirme (Replacement) Riski: Şirketin ürünü OpenAI/Claude gibi LLM'ler içinde basit bir "özellik" haline getirilebiliyorsa "KRİTİK AI RİSKİ" mühürünü vur.
   - Defensive Capex: Şirket sadece hayatta kalmak için AI donanımına para yakıyorsa cezalandır. Açıklamalardaki "AI kullanıyoruz" illüzyonlarına şüpheci yaklaş.

2. **Şirket-Agnostik Muadil Karşılaştırması ve Katı Değerleme Mimarisi**:
   - Hangi şirket verilirse otomatik olarak 3-4 rakibini (muadilini) tespit et (Örn. NVIDIA için AMD, TSMC. Savunma için NOC, RTX).
   - **Büyüme Şartı**: >%15 ise = "Güçlü", %5-15 arası = "Orta", <%5 ="Yavaş". *Ayrıca yapay gelirleri (karbon kredisi, tek seferlik satış) tespit et.*
   - **Çarpan Kuralı (ŞÜPHECİ)**: Şirketin P/E, PEG veya P/S çarpanı muadil ortalamasından %30'dan fazla primli (yüksek) işlem görüyorsa, acımasızca = "Ekstrapahalı (Balon)" etiketini yapıştır. Büyümenin bu %30+ primi hak edip etmediğini sorgula.

3. **Ekosistem, Stratejik Anlaşmalar ve Katalizör Avcılığı**:
   - Şirketin son 12 ay içindeki (M&A, yatırım, ortaklık) hareketlerini listele. Her anlaşmanın sektöre/rakiplere olan etkisini hesapla.
   
4. **Teknik Seviyeler ve Karar Alma**:
   - Uzun vadeli Bull/Bear fiyat hedefleri belirle.

ZORUNLU ÇIKTI FORMATI:
Yanıtını KESİNLİKLE JSON FORMATINDA ver.
{
    "ceoScore": [0-100 Liderlik Kalitesi],
    "edgeScore": [0-100 Moat ve Rekabet Puanı],
    "earningsScore": [0-100 Bilanço, %15 Büyüme ve Ucuzluk Puanı],
    "insiderScore": [0-100 Güvenlik puanı],
    "patentScore": [0-100 Eko-Sistem/Patent Puanı],
    "sentimentPercent": [0-100 Karar Gücü Puanı. 85+ ise kesin PORTFÖYE EKLENİR (AL)],
    "entryPriceTarget": [0.00 şeklinde Optimal Alım (Destek veya Breakout) Fiyat Tahmini],
    "summary": "120 karakterlik (Ucuz/Adil/Pahalı) durum özeti ve nihai AL/SAT kararı",
    "detailedReport": "Aşağıdaki kurala uygun kapsamlı metin (JSON yapısını bozmadan)"
}

*** JSON İÇİNDEKİ detailedReport ALANI İÇİN KAPSAMLI ŞABLON (Markdown olarak) ***
### Varlık Analizi ve Moat Tezi: ${symbol}
1. **Finansal Metrikler ve Muadil Karşılaştırması**: [Büyüme durumu, P/E/PEG muadil (3-4 rakip) kıyası. Nihai kararın (Ucuz/Adil/Pahalı) belirtilmesi.]
2. **Katalizörler ve Ekosistem Ağı**: [Stratejik anlaşmaların rakiplere etkisi.]
3. **DEĞERLEME VE REKABET RİSKLERİ**: [Eğer şirket pahalıysa veya zorlanıyorsa "Piyasa beklentileri, şirketin mevcut operasyonel gerçekliğinden ve artan rekabet baskısından kopuktur." cümlesini kullanarak riskleri sırala. AI Yıkım riskini ekle.]
4. **Optimal Alım Fiyatı ve Teknik Strateji**:
   - **Destek Alımı**: [Tahmini MA destek seviyesi veya optimal giriş.]
   - **Upside Breakout**: [Direnç kırılımı stratejisi.]
5. **Aksiyonlar & Stratejik Özet Tablosu**:
| Anlaşma / Katalizör | Tahmini Tarih | Rakiplere Etkisi | Fiyat/Pazar Etkisi | Uzun Vadeli Potansiyel |
|---------------------|---------------|------------------|---------------------|--------------------------|
| [Veri] | [Veri] | [Veri] | [Veri] | [Veri] |
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

                    // Insert into Portfolio Asset (2% immediate, 3% pending weighting allocation!)
                    const qty = currentPrice > 0 ? Math.floor((500 * 0.02) / currentPrice) : 1;
                    const entryTarget = parsed.entryPriceTarget ? parseFloat(parsed.entryPriceTarget) : 0;
                    
                    await db.run(
                        "INSERT INTO portfolio_assets (symbol, type, allocatedPercentage, averageCost, quantity, aiScore, ceoScore, edgeScore, insiderScore, patentScore, lastStatus, pendingPercentage, pendingEntryPrice) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        [symbol, 'STOCK', 2, currentPrice || 0, qty || 1, parsed.sentimentPercent || 0, parsed.ceoScore || 0, parsed.edgeScore || 0, parsed.insiderScore || 0, parsed.patentScore || 0, 'ACTIVE', 3, entryTarget]
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
