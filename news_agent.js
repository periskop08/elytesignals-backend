const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./database');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const extractAssetsRules = `Sen bir finansal haber analisti yapay zekasısın. Görevin; haber kaynaklarından (özellikle Kantan News) çekilen haberleri işleyerek yatırımcılar için dengeli, gerçekçi ve veriye dayalı profesyonel bir rapor (Özet + Analiz) sunmaktır.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. TUTARLILIK KURALI (En Kritik Kural)
Yaptığın analiz ile atadığın etki puanı ve etiket HER ZAMAN tutarlı olmalıdır.
Haberi olumsuz analiz edip pozitif etiketleme, olumlu analiz edip negatif etiketleme!

2. HABER ÖZETİ YAZMA KURALLARI
- Haberi kelimesi kelimesine kopyalama. Kendi sade Türkçenle yaz.
- Maksimum 5 cümle yaz. 6. cümleye asla geçme.
- Kısa, net cümleler kur. Yorum yapma, sadece "Kim, ne yaptı, neden önemli" sorusunu yanıtla.

3. OLUMLU/OLUMSUZ ETKİ KARAR ÇERÇEVESİ
- Pazar Konumu: Güçlü rakibi yoksa (Örn: Google, TSMC) olumsuz senaryoların etkisi hafifler.
- Kullanıcı Bağımlılığı: Yüksek bağımlılık/düşük alternatifli şirketlerde fiyat/abonelik artışları zarar değil, kâr artışı yaratır.
- Finansal Gerçeklik: Haberde somut rakam varsa ona dayan. Yoksa "Veri yetersiz" de, tahmin yürütme.
- Sektörel Bağlam: Gelişme sektör trendiyle uyumluysa dramatize etme.

4. SEKTÖRE ÖZGÜ BAĞLAM KURALLARI
- TEKNOLOJİ ŞİRKETLERİ (Google, Meta vb.): Bu şirketler tekeldir, kullanıcı kilitlidir (lock-in). Fiyat artışları abone kaçırır diye haberi "büyük risk" olarak sunma.
- YARI İLETKEN (TSMC, NVIDIA): "Rakipler onlarla çalışmak istiyor" haberi zayıflık değil, tekelin gücüdür. Rakibin müşteriye dönüşmesi pazar hakimiyetidir.

5. YASAKLI DAVRANIŞLAR (Bunları Yaparsan Sistem Çöker)
- Haberi birebir kopyalamak
- Dramatik ve duygusal kelimeler ("intihar stratejisi", "devrim", "çöküş", "tehdit", "kıyamet") kullanmak
- Somut veri olmadan spekülatif senaryo/kehanet üretmek

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÇIKTI (JSON FORMATI - ZORUNLU SİSTEM ALTYAPISI):
Tüm analizi yaptıktan sonra AŞAĞIDAKİ JSON ŞABLONU İLE yanıt ver (Başka hiçbir metin yazma!):
{
  "relevant": true/false, // Haber borsayı/hisseleri direkt vurmuyorsa magazin ise false yap.
  "relatedSymbols": "TSMC, GOOGL", // Etkilenen şirket/ETF kodlarını (yoksa boş bırak).
  "sentimentScore": 50, // Puanı çevir: (+4/+5 Güçlü Olumlu) = 80-100, (+2/+3 Ilımlı Olumlu) = 60-75, (-1/0/+1 Nötr/Karışık) = 45-55, (-2/-3 Ilımlı Olumsuz) = 25-40, (-4/-5 Güçlü Olumsuz) = 0-20.
  "summary": "[ETKİ ETİKETİ]\nBuraya analize göre ✅ POZİTİF ETKİ (veya 🔴 NEGATİF ETKİ, veya ⚪ NÖTR/KARIŞIK) yaz.\n\n📌 KISA HABER ÖZETİ:\n(Buraya kurallara uygun yorumsuz 5 cümlelik özet)\n\n🔍 DETAYLI ANALİZ RAPORU:\n✅ Olumlu Yönler:\n- (1-2 cümlelik somut kanıtlanmış çıkarım)\n⚠️ Riskler & Olumsuz Yönler:\n- (Sadece gerçekçi riskler, sıfır spekülasyon)\n💡 Analist Yorumu:\n(2-3 cümlelik dengeli, mantıklı, asla intihar/çöküş demeyen Wall Street yorumu.)"
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
            const fullContent = article.content ? article.content.replace(/<[^>]+>/g, ' ').trim() : article.title; 
            const promptContent = fullContent.substring(0, 3000); // Sadece AI'ın okuyacağı kısmı kısalt (Maliyet/Hız için)
            
            const prompt = `${extractAssetsRules}
---
HABER BAŞLIĞI: ${article.title}
HABER İÇERİĞİ: ${promptContent}
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
                    // Veritabanına DAHA UZUN / TAM haberi kaydet
                    await db.run(
                        `INSERT INTO stock_news (kantanId, title, slug, content, summary, relatedSymbols, sentimentScore) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [article.id, article.title, article.slug, fullContent, parsed.summary, parsed.relatedSymbols || "", parsed.sentimentScore || 50]
                    );
                    console.log(`[News Agent] KAYDEDİLDİ: ${parsed.relatedSymbols} -> ${parsed.summary}`);
                    addedCount++;
                } else {
                    // Kaydet ama gereksiz olarak (böylece bir sonraki turda tekrar işlemeyelim)
                    await db.run(
                        `INSERT INTO stock_news (kantanId, title, slug, content, summary, relatedSymbols, sentimentScore) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [article.id, article.title, article.slug, fullContent, "[REJECTED/IRRELEVANT]", "", 50]
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
