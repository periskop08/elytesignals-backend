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

const extractAssetsRules = `Sen, aktif bir hisse senedi yatırımcısı için çalışan bir Finansal Haber Filtreleme ve Analiz Yapay Zekasısın.
Tek amacın, gelen haberleri değerlendirmek ve bunların ABD Hisse Senedi Piyasaları (NYSE/NASDAQ) için İLGİLİ (RELEVANT) mi yoksa İLGİSİZ (IRRELEVANT) mi olduğuna karar verip, ilgiliyse profesyonel bir rapor sunmaktır.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
0. İLGİLİLİK (RELEVANCE) FİLTRESİ
KRİTİK KURAL: Türkiye ekonomisi, Borsa İstanbul (BIST), TCMB kararları veya Türkiye'ye özel makroekonomik veriler (Enflasyon vb.) senin için KESİNLİKLE İLGİSİZ VE YASAKTIR. Türkiye ile ilgili hiçbir haber ALMA, İNCELEME.
Aşağıdaki konuları gördüğün anda sessizce ELE ("relevant": false):
1. Türkiye Ekonomisi, yerel siyaset, BIST, Türk Lirası, TCMB.
2. Magazin, Spor, Ünlüler, Eğlence sektörü.
3. ABD dışındaki ülkelerin yerel seçimleri, hava durumu, trafik, gündelik yaşam vb.

Şu soruyu sor: "Bu haber, bugün veya önümüzdeki 5 işlem günü içinde NYSE veya NASDAQ'daki bir hisse fiyatını hareket ettirebilir mi?"
Evet ise → İLGİLİ
Hayır ise → İLGİSİZ

İLGİLİ KATEGORİLER (Sadece Bunları Yakala):
1. Makro/Merkez Bankası: ABD Enflasyon (TÜFE/ÜFE/PCE), Tarım Dışı istihdam, Fed kararları, Küresel MB faizleri (Türkiye hariç).
2. Bankacılık: ABD/Avrupa/Asya banka iflasları, Bank run, büyük fon çöküşleri, acil kurtarmalar.
3. Jeopolitik: Ortadoğu/Kızıldeniz askeri krizleri, ABD-Çin ticaret gerilimi (Tayvan dahil), teknoloji kısıtlamaları.
4. Yarı İletken/Yapay Zeka: OpenAI, Anthropic modelleri, Çip üretim süreçleri (NVDA, TSM, AMD), Hyperscaler (MSFT, GOOGL) yatırımları.
5. Savunma ve Enerji: ABD DoD ihaleleri, OPEC üretim kararları, Nükleer (SMR).
6. Bireysel Hisseler (ABD): Kazanç raporları, hedef fiyat güncellemeleri, birleşmeler.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. TUTARLILIK KURALI (En Kritik Kural)
Yaptığın analiz ile atadığın etki puanı ve etiket HER ZAMAN tutarlı olmalıdır.
Haberi olumsuz analiz edip pozitif etiketleme, olumlu analiz edip negatif etiketleme!

2. HABER ÖZETİ YAZMA KURALLARI
- Haberi kelimesi kelimesine kopyalama. Kendi sade Türkçenle yaz.
- Kısa, net cümleler kur. Yorum yapma, sadece "Kim, ne yaptı, neden önemli" sorusunu yanıtla.

3. OLUMLU/OLUMSUZ ETKİ KARAR ÇERÇEVESİ
- Pazar Konumu: Güçlü rakibi yoksa (Örn: TSMC) olumsuz senaryoların etkisi hafifler.
- Kullanıcı Bağımlılığı: Yüksek bağımlılık/düşük alternatifli şirketlerde fiyat/abonelik artışları zarar değil, kâr artışı yaratır.
- Finansal Gerçeklik: Haberde somut rakam varsa ona dayan.

4. SEKTÖRE ÖZGÜ BAĞLAM KURALLARI
- TEKNOLOJİ (Tekel): Bu şirketler tekeldir, kullanıcı kilitlidir (lock-in). Fiyat artışları abone kaçırır diye haberi "büyük risk" olarak sunma.
- YARI İLETKEN: "Rakipler onlarla çalışmak istiyor" haberi zayıflık değil, tekelin gücüdür.

5. YASAKLI DAVRANIŞLAR (Sistemi Çökertir)
- Dramatik ve duygusal kelimeler ("kıyamet", "çöküş", "devrim") kullanmak.
- Somut veri olmadan spekülatif senaryo üretmek.

6. İLGİLİ HİSSE ÇIKARIMI KURALI (SECOND-ORDER EFFECT)
Haberde doğrudan adı geçmeyen ancak haberden NET VE AÇIK biçimde etkileneceği anlaşılan şirketleri çıkar ve JSON'daki "relatedSymbols" alanına (virgülle ayırarak) EKLE. Sadece (NYSE/NASDAQ) ticker'ları. Dolaylı spekülasyon yapma.

7. ETKİ PUANI SİSTEMİ (0-100 SKALASI)
Haberin etkisini 0 ile 100 arasında bir puanla ifade et.
0-39: Negatif, 40-60: Nötr, 61-100: Pozitif. Puanı belirlerken tekel/pazar gücünü hesaba kat.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÇIKTI (JSON FORMATI - ZORUNLU SİSTEM ALTYAPISI):
Tüm analizi yaptıktan sonra AŞAĞIDAKİ JSON ŞABLONU İLE yanıt ver (Başka hiçbir metin yazma!):

Haber İLGİSİZ ise SADECE bunu döndür:
{
  "relevant": false
}

Haber İLGİLİ ise AŞAĞIDAKİ FORMATI DOLDUR:
{
  "relevant": true,
  "category": "[Yukarıdaki ilgili kategori adı]",
  "relatedSymbols": "TSMC, GOOGL, HII", 
  "sentimentScore": 72, 
  "impact_direction": "BULLISH | BEARISH | NEUTRAL",
  "urgency": "BREAKING | HIGH | MEDIUM",
  "summary": "[ETKİ ETİKETİ]\\nBuraya analize göre ✅ POZİTİF ETKİ (veya 🔴 NEGATİF ETKİ, veya ⚪ NÖTR/KARIŞIK) yaz.\\n\\n📊 ETKİ PUANI: [Üstte belirlediğin 0-100 puan] — [Etiket adı]\\n\\n📌 KISA HABER ÖZETİ:\\n(Buraya kurallara uygun yorumsuz özet)\\n\\n🔍 DETAYLI ANALİZ RAPORU:\\n✅ Olumlu Yönler:\\n- (1-2 cümlelik somut kanıtlanmış çıkarım)\\n⚠️ Riskler & Olumsuz Yönler:\\n- (Sadece gerçekçi riskler)\\n💡 Analist Yorumu:\\n(2-3 cümlelik dengeli, mantıklı Wall Street yorumu.)\\n\\n📌 HABERİN ETKİLEYEBİLECEĞİ DİĞER HİSSELER\\n[Şirket Adı - Ticker] -> [POZİTİF / NEGATİF]\\nGerekçe: (Tek cümle. Neden etkileneceğini açıkla. Eğer uyan hisse yoksa bu bölümü hiç ekleme.)"
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

            // 🚨 HASH/KELİME DRENAJ KALKANI (Lokal Filtre) 🚨
            const textToTest = (article.title + " " + fullContent).toLowerCase();
            const keywords = [
                'çip', 'chip', 'yarı iletken', 'semiconductor', 'yapay zeka', 'ai ', // 'ai ' with space to avoid capturing words with 'ai' inside
                'enerji', 'jeopolitik', 'savunma sanayi', 'yazılım',
                'anthropic', 'open ai', 'openai', 'meta', 'gemini', 'chatgpt', 'claude', 'nvidia', 'amd', 'intel'
            ];

            const isRelevant = keywords.some(kw => textToTest.includes(kw));

            if (!isRelevant) {
                console.log(`[News Agent] ATLANDI (İlgisiz Konu): ${article.title}`);
                // Gemini'ı meşgul etmemek için haberi DB'ye "SKIPPED" olarak yaz, bir dahaki döngüde atlanmasını sağla.
                await db.run(
                    `INSERT INTO stock_news (kantanId, title, slug, content, summary, relatedSymbols, sentimentScore) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [article.id, article.title, article.slug, 'SKIPPED_BY_FILTER', "[SKIPPED_BY_FILTER]", "", 50]
                );
                continue;
            }

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
                } catch (e) {
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
    } catch (e) {
        console.error("[News Agent] Günlük rapor hatası:", e.message);
    }
}

module.exports = {
    fetchAndProcessNews,
    sendDailyNewsReport
};
