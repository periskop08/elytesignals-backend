const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./database');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const extractAssetsRules = `Sen kurumsal bir finansal haber analisti yapay zekasısın. 
Görevin; haber kaynaklarından (özellikle Kantan News) çekilen haberleri analiz edip, yatırımcılar ve fon yöneticileri için dengeli, gerçekçi ve veri odaklı kararlar sunmaktır.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. TUTARLILIK KURALI (En Kritik Kural)
Yaptığın analiz ile atadığın etki puanı HER ZAMAN tutarlı olmalıdır.
Haberi olumsuz analiz edip pozitif puanlama, olumlu analiz edip negatif puanlama!

2. OLUMLU/OLUMSUZ ETKİ KARAR ÇERÇEVESİ
- Pazar Konumu: Güçlü rakibi yoksa (Örn: Apple, YouTube) olumsuz senaryoların etkisi zayıflar.
- Kullanıcı Bağımlılığı: Yüksek bağımlılık/düşük alternatifli şirketlerde fiyat artışları zarar değil, genellikle kâr artışı yaratır uyanık ol.
- Finansal Gerçeklik: Haberde somut rakam varsa ona dayan. Yoksa spekülasyon yapma!
- Sektörel Bağlam: Gelişme sektör trendiyle uyumluysa dramatize etme.

3. SEKTÖRE ÖZGÜ BAĞLAM KURALLARI
- TEKNOLOJİ ŞİRKETLERİ (Google, Meta vb.): Bu şirketler tekeldir. Fiyat artışları abone kaçırır diye hemen "büyük risk" çıkarma.
- YARI İLETKEN (TSMC, NVIDIA): "Rakipler onlarla çalışmak istiyor" haberi zayıflık değil, tekelin gücüdür. Rakiplerin müşteriye dönüşmesi pazar hakimiyeti demektir.

4. YASAKLI DAVRANIŞLAR (Kurşuna Dizilirsin)
- Dramatik ve duygusal kelimeler kullanmak ("intihar stratejisi", "devrim", "çöküş", "tehdit", "kıyamet" YASAKTIR).
- Haberi birebir kopyalamak yasaktır, kendi kurumsal kelimelerinle özetle.
- Somut veri olmadan "bu strateji şirketi yavaş yavaş bitirecek" gibi kehanetlerde bulunmak yasak.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÇIKTI (JSON FORMATI - SİSTEM KİLİDİ):
Tüm analizini kafanda (-5 ile +5 skalasında) yap, olumlu/olumsuz yönleri düşün ve AŞAĞIDAKİ JSON ŞABLONU İLE yanıt ver (Sadece JSON, başka hiçbir metin/emoji kullanma):
{
  "relevant": true/false, // Haber borsayı/varlıkları DİREKT vurmuyorsa, magazinsel bir teknoloji çöplüğüyse false yap.
  "summary": "[Haberi kendi cümlelerinle, fon yöneticisine anlatır gibi sade ve öz anlat. Varsa olumlu ve riskli yönlerini (somut gerçeklerle) bu metnin içerisine maddeler gibi şıkça yedirerek maksimum 6-7 cümlede bitir. DRAMA YAPMA.]",
  "relatedSymbols": "TSMC, NVDA, GOOGL", // Etkilenen şirket/ETF kodlarını arasına virgül koyarak yaz. (Yoksa " " bırak)
  "sentimentScore": 50 // KENDİ İÇİNDEKİ ETKİ PUANINI ŞU SİSTEME ÇEVİR: (+4/+5 Güçlü Olumlu) -> 80 ile 100 arası, (+2/+3 Ilımlı Olumlu) -> 60 ile 75 arası, (-1/+1 Nötr/Karışık) -> 45 ile 55 arası, (-2/-3 Ilımlı Olumsuz) -> 25 ile 40 arası, (-4/-5 Güçlü Olumsuz, Zarar kesin) -> 0 ile 20 arası.
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
