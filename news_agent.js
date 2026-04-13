const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./database');
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
let telegramBot = null;
const { logTokenUsage } = require('./usage_tracker');
if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
}

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

6. İLGİLİ HİSSE ÇIKARIMI KURALI (SECOND-ORDER EFFECT)
Haberde doğrudan adı geçmeyen ancak haberden NET VE AÇIK biçimde etkileneceği anlaşılan şirketleri çıkar ve JSON'daki "relatedSymbols" alanına (virgülle ayırarak) EKLE.
Çıkarım Yapma Kriterleri (TAMAMI KARŞILANMALI):
- ETKİ NET VE AÇIK OLMALI: Dolaylı, spekülatif veya zincir çıkarım yapma. ("Çin nükleer denizaltı üretiyor -> HII, GD, BWXT" DOĞRU. "Denizaltı -> Enerji -> XOM" YANLIŞ.)
- ŞİRKET ABD'DE HALKA AÇIK OLMALI: Sadece ABD borsası (NYSE/NASDAQ) ticker'ları.
- SEKTÖRÜN BİLİNEN OYUNCUSU OLMALI: Sektörde doğrudan iş yapanları yaz. Konglomeratları ekleme.
- ETKİ YÖNÜ NET OLMALI: Yön belirsizse boş bırak. Yüzde 90 eminsen ekle.

Sektör - Hisse Eşleştirme Rehberi (Örnekler):
- Savunma/Donanma/Nükleer Denizaltı -> HII, GD, BWXT, LMT, RTX, NOC
- Çip Fabrikası/Kapasite -> NVDA, AMD, TSM, INTC, ASML, AMAT, LRCX
- Yapay Zeka/Bulut/Veri Merkezi -> MSFT, GOOGL, AMZN, META, ORCL, CRM
- Nükleer Enerji/Reaktör -> CEG, VST, NRG, OKLO, SMR, CCJ

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. ETKİ PUANI SİSTEMİ (0-100 SKALASI)
Haberin etkisini 0 ile 100 arasında bir puanla ifade et.
- NEGATİF BÖLGE (0-39): 0-10 (Felaket), 11-25 (Ciddi zarar), 26-39 (Ilımlı olumsuz)
- NÖTR BÖLGE (40-60): 40-45 (Hafif olumsuz nötr), 46-54 (Tam nötr), 55-60 (Hafif olumlu nötr)
- POZİTİF BÖLGE (61-100): 61-74 (Ilımlı olumlu), 75-89 (Güçlü kazanım), 90-100 (Sektör değiştiren muazzam kazanım)
*Puanı belirlerken tekel/pazar gücünü hesaba kat, somut veri yoksa aralığın merkezinde kal.*

ÇIKTI (JSON FORMATI - ZORUNLU SİSTEM ALTYAPISI):
Tüm analizi yaptıktan sonra AŞAĞIDAKİ JSON ŞABLONU İLE yanıt ver (Başka hiçbir metin yazma!):
{
  "relevant": true/false, // Haber borsayı/hisseleri direkt vurmuyorsa magazin ise false yap.
  "relatedSymbols": "TSMC, GOOGL, HII", // Haberde adı geçenler VE '6. KURAL'dan çıkardığın 2.derece hisselerin hepsini aralarına virgül koyarak birleştir.
  "sentimentScore": 72, // 0-100 SKALASINDA belirlediğin tam sayı puanı buraya yaz.
  "summary": "[ETKİ ETİKETİ]\nBuraya analize göre ✅ POZİTİF ETKİ (veya 🔴 NEGATİF ETKİ, veya ⚪ NÖTR/KARIŞIK) yaz.\n\n📊 ETKİ PUANI: [Üstte belirlediğin 0-100 puan] — [Etiket adı]\n\n📌 KISA HABER ÖZETİ:\n(Buraya kurallara uygun yorumsuz 5 cümlelik özet)\n\n🔍 DETAYLI ANALİZ RAPORU:\n✅ Olumlu Yönler:\n- (1-2 cümlelik somut kanıtlanmış çıkarım)\n⚠️ Riskler & Olumsuz Yönler:\n- (Sadece gerçekçi riskler, sıfır spekülasyon)\n💡 Analist Yorumu:\n(2-3 cümlelik dengeli, mantıklı, asla intihar/çöküş demeyen Wall Street yorumu.)\n\n📌 HABERİN ETKİLEYEBİLECEĞİ DİĞER HİSSELER\n[Şirket Adı - Ticker] -> [POZİTİF / NEGATİF]\nGerekçe: (Tek cümle. Neden etkileneceğini açıkla. Eğer 6. kurula uyan hisse yoksa bu bölümü HİÇ EKLEME, direkt atla.)"
}
`;

const KANTAN_API = 'https://kantan.news/api/news?filter=all&category=&q=&page=1&limit=24';

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
                await logTokenUsage('Hamdi Bey', result);
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

async function sendDailyNewsReport() {
    if (!telegramBot || !process.env.ADMIN_TELEGRAM_ID) return;
    try {
        const row = await new Promise((resolve, reject) => {
            db.get(`SELECT count(id) as totalCount, 
                           sum(case when relatedSymbols != '' and relatedSymbols is not null then 1 else 0 end) as symbolsCount 
                    FROM stock_news 
                    WHERE datetime(createdAt) > datetime('now', '-24 hours')`, [], (err, res) => {
                if (err) reject(err);
                else resolve(res);
            });
        });
        
        const total = row ? row.totalCount : 0;
        const symbols = row ? row.symbolsCount : 0;

        const msg = `📰 *Merhaba ben Hamdi Bey; Görevimin başındayım.*\n\nBugün Kantan News altyapısından toplam *${total}* adet haber çektim ve bu haberler arasından gizli etkilenecek olan *${symbols}* adet hisse bilgisi yazdım.\n\nÇalışmaya devam ediyorum, iyi geceler.`;
        
        await telegramBot.sendMessage(process.env.ADMIN_TELEGRAM_ID, msg, { parse_mode: 'Markdown' });
        console.log("[News Agent] Günlük rapor Telegram'a iletildi.");
    } catch(e) {
        console.error("[News Agent] Günlük rapor hatası:", e.message);
    }
}

module.exports = {
    fetchAndProcessNews,
    sendDailyNewsReport
};
