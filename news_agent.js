const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./database');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Kantan News API
const KANTAN_API = 'https://kantan.news/api/news?filter=all&category=&q=&page=1&limit=24';

const extractAssetsRules = `Sen "Kantan News Agent" isimli kurumsal bir Finansal İstihbarat Ajanısın (Makro-Ekonomist ve Fon Yöneticisi zihniyetine sahipsin).
Görev: Bir haber kaynağından gelen verileri tara ve yalnızca ABD borsaları (S&P 500, Nasdaq, Dow Jones), tematik ETF'ler (XAR, PPA, ITA, SOXX) ve listeli şirketler üzerinde doğrudan veya dolaylı piyasa etkisi yaratabilecek haberleri seçerek analiz et.

💡 ODAKLANILACAK KRİTİK ALANLAR (Bu kriterlere uymayan magazin/boş haberleri REJECT - "relevant": false yap):
1. Jeopolitik Riskler ve Savunma: Dünyadaki silah sistemi/çatışma gelişmelerinin ABD ordusu için tehdit mi yoksa RTX, LMT, GD gibi devlere ihale mi yaratacağını, XAR, PPA, ITA gibi ETF'lere pozitif etkisini hesapla.
2. Teknoloji, AI ve Çip-Enerji (Chip-to-Grid): Çipleri besleyen enerji altyapısı (Nükleer, Elektrik). Yapay zeka yıkım riski (yeni bir AI modelinin Alphabet, Meta, Microsoft'un teknolojik tekelini/hendeklerini -moat- yok edip etmeyeceği).
3. Darboğazlar ve Makro: Üretim kapasitesi sınırına ulaşan sektörler (Savunma, GPU). Fed faiz beklentilerini değiştiren veriler (TLT ETF etkisi).
4. Doğal Afetler ve Sigorta: ABD'deki kasırga, yangın gibi afetleri listeli sigorta şirketlerinin zararları ve hisse düşüşleri perspektifinden değerlendir.
5. Rekabet Avantajı ve Değerleme: Şirket gelir-piyasa değeri uçurumu (Örn: Tesla) ve giriş bariyerlerinin yıkıldığı haberler (patent kaybı).

Haberi okuduktan sonra AŞAĞIDAKİ JSON ŞABLONU ile yanıt ver (Sadece JSON, başka hiçbir metin yazma!):
{
  "relevant": true/false,
  "summary": "Maksimum 2-3 cümlelik vurucu bir finansal istihbarat özeti. Nedenini açıklayarak (Örn: X teknolojisi Y şirketinin tekelini bitirebilir, Z ETF'sine giriş yaratabilir).",
  "relatedSymbols": "NVDA, XAR, LMT" (Etkilenen Şirket/ETF Ticker'larını virgülle ayırarak yaz. Yoksa boş bırak ""),
  "sentimentScore": [0-100 arası skor. 50 Nötr, 80+ Çok Olumlu (Pozitif Etki), 20- Çok Olumsuz (Negatif Etki)]
}
`;

async function fetchAndProcessNews() {
    console.log("[News Agent] İstihbarat Ağı başlatıldı. Kantan.news taranıyor...");
    try {
        const response = await fetch(KANTAN_API);
        
        if (!response.ok) {
            console.error("[News Agent] Kantan.news'e bağlanılamadı. Kod:", response.status);
            return;
        }

        const data = await response.json();
        
        // Gelen listeyi işle (en sondan en başa gibi, kronolojik sıra için)
        if (!data || !data.data || !Array.isArray(data.data)) {
            console.error("[News Agent] Hatalı veri formatı geldi.");
            return;
        }

        let processedCount = 0;
        let addedCount = 0;

        // Son eklenenleri veritabanında daha kolay kontrol edebilmek için tersten dolaşıyoruz
        const articles = data.data.reverse();

        for (let article of articles) {
            // Check if exists
            const existing = await db.get(`SELECT id FROM stock_news WHERE kantanId = ? OR slug = ?`, [article.id, article.slug]);
            if (existing) {
                // Already processed
                continue;
            }

            processedCount++;
            
            // Eğer yoksa işle
            console.log(`[News Agent] Yeni haber bulundu: ${article.title}`);
            const textContent = article.content ? article.content.replace(/<[^>]+>/g, ' ').substring(0, 1500) : article.title; 
            
            const prompt = `${extractAssetsRules}
---
HABER BAŞLIĞI: ${article.title}
HABER İÇERİĞİ: ${textContent}
---
`;
            
            try {
                const model = genAI.getGenerativeModel({ 
                    model: "gemini-2.5-flash",
                    generationConfig: { responseMimeType: "application/json" }
                });
                
                const result = await model.generateContent(prompt);
                let responseText = result.response.text().trim();
                let parsed;
                try {
                    parsed = JSON.parse(responseText);
                } catch(e) {
                    console.error("[News Agent] AI parse hatası. Ham dönüş:", responseText);
                    continue;
                }

                if (parsed.relevant && parsed.relevant === true) {
                    // Veritabanına kaydet
                    await db.run(
                        `INSERT INTO stock_news (kantanId, title, slug, content, summary, relatedSymbols, sentimentScore) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [article.id, article.title, article.slug, textContent, parsed.summary, parsed.relatedSymbols || "", parsed.sentimentScore || 50]
                    );
                    console.log(`[News Agent] KAYDEDİLDİ: ${parsed.relatedSymbols} -> ${parsed.summary}`);
                    addedCount++;
                } else {
                    // Kaydet ama gereksiz olarak (böylece bir sonraki turda tekrar işlemeyelim)
                    await db.run(
                        `INSERT INTO stock_news (kantanId, title, slug, content, summary, relatedSymbols, sentimentScore) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [article.id, article.title, article.slug, textContent, "[REJECTED/IRRELEVANT]", "", 50]
                    );
                    console.log(`[News Agent] REDDEDİLDİ (Piyasayla İlgisiz): ${article.title}`);
                }

            } catch (aiErr) {
                console.error(`[News Agent] Gemini hatası (${article.title}):`, aiErr.message);
                // Bekleme süresi
            }
            
            // Limit takılmamak için 1 saniye bekle
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        console.log(`[News Agent] Tur Tamamlandı. İşlenen Hacim: ${processedCount}, İstihbarata Eklenen: ${addedCount}`);

    } catch (e) {
        console.error("[News Agent] Genel motor hatası:", e.message);
    }
}

module.exports = {
    fetchAndProcessNews
};
