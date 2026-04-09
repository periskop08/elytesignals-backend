# 🤖 LLM Interaktif Hisse Analiz Radarı

Mevcut sistemde Yapay Zeka (LLM) radarı sadece arka planda otomatik olarak taranan NVDA, MSFT gibi örnek hisseleri periyotlarla çekiyordu. Artık **dinamik ve interaktif** bir "Yapay Zeka Yatırım Asistanı" özelliğini platforma ekliyoruz. Kullanıcı, dilediği hissenin Wall Street tarzı "Investment Thesis" (Yatırım Tezi) raporunu talep edebilecek.

## User Review Required
Bu özellik direkt olarak OpenAI altyapısına bağlanacağı ve UI (Arayüz) değiştireceği için aşağıdaki adımları onaylamanı rica ediyorum.

## Proposed Changes

### [MODIFY] [PortfolioManager.jsx](file:///Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/web/src/components/PortfolioManager.jsx)
(Frontend / Arayüz)

1. **Sohbet Kutusu:** "Toplam Portföy" kartının hemen alt paneline şık, glassmorphism (cam tasarım) tarzında bir input kutusu eklenecek. 
2. **Kullanım:** Kullanıcı kutuya örn. `PLTR` yazıp tıkladığında, "Analiz Ediliyor..." durumuna geçecek. Ekranda yükleme (loading) animasyonu belirecek.
3. **Modal Entegrasyonu:** Rapor oluştuğunda sistem hisseyi direkt olarak sağ taraftaki radar listesine atacak ve istersen anında tıklandığında popup (modal) penceresinde TradingView grafiği ile birlikte açılacak.

### [MODIFY] [index.js](file:///Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/index.js)
(Backend / Sunucu)

1. **Yeni Endpoint (`POST /api/llm/analyze`):** Yeni bir API uç noktası oluşturulacak.
2. **OpenAI Entegrasyonu:** `.env` dosyasındaki `OPENAI_API_KEY` kullanılarak GPT-4/GPT-4o modeline bağlanılacak. Model, "Sen bir Hedge Fund Quants Yöneticisisin" kimliğiyle yönlendirilip:
   - CEO Puanı
   - Edge Puanı (Teknolojik Üstünlük)
   - Patent ve Insider alışları
   - Detaylı Makro Rapor
   Hesaplayarak JSON formatında sunucuya iletecek.
3. **Veritabanı Kaydı (`ai_sentiments`):** GPT'den alınan bu zeka puanları SQLite tablomuza yazılacak ve arayüze otomatik yansıyacak.

## Soru (Onay Formu)
Senin LLM (OpenAI) anahtarın sistemde aktif. Bu sohbet aracının doğrudan GPT'yi tetikleyip raporları üretmesini (`POST /api/llm/analyze` servisi üzerinden) uygun buluyor musun? İzin verirsen kodu ateşliyorum! 🔥
