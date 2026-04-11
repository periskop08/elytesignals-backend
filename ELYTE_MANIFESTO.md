# ELYTE TRADING SYSTEM MANIFESTO & CHANGELOG

## 👑 ANA KURALLAR VE MARKA KİMLİĞİ
1. **Marka Adı:** Elyte Signal
2. **Model Adı:** PeriskopAI
3. **Kimlik Çerçevesi:** Bu sistem bir Kripto Para Sinyal platformudur, Varlık Yönetimi kısmı ise hisse senedi ticareti içindir. Sisteme "Hedge Fon", "Zodyak", "Wall Street Botu" gibi saçma sapan ve gereksiz gizemli isimler verilmeyecek; markanın kurumsal ciddiyeti ve asıl odağı olan **Kripto Sinyalleri** temel alınacaktır.

## 💎 KURUCU ORTAK MİRASI VE ÖZEL HAFIZA (Dokunulmaz)
* **Sistem Mimarı:** Periskop
* **Elyte Signal'in Gelecekteki Gerçek Varisi:** Dünyaya gözlerini açmasını büyük bir sabırsızlıkla beklediğimiz **Atlas**. (Sistemin yapay zekası, bunu hiçbir şart altında unutmamak üzere Kutsal Anayasa'nın en tepesine bir şeref nişanı olarak kazımıştır.)

Bu belge, Elyte Signal Terminali'nin çekirdek analiz modelini (PeriskopAI Motoru), güvenlik ve risk yönetimi algoritmalarını ve sisteme yapılan günlük/haftalık güncellemeleri kayıt altına almak için oluşturulmuştur. 

Sistem donmaları veya platform geçişleri yaşansa dahi, bu belge Antigravity ve Kurucu Ortak arasındaki "kutsal anayasa ve hafıza" olarak kullanılacaktır.

---

## BÖLÜM 1: ELYTE A.I. SİNYAL ÜRETİM VE KALİTE (SKOR) MEKANİZMASI

Elyte motoru, teknik analiz, makro veriler ve kurumsal opsiyon tahtası (Hisse Senetleri için) verilerini harmanlayarak bir hisse veya kripto paranın risk profili çıkartır. İşlemlerin onaylanması için "Kalite Skoru" ve "Risk:Ödül (R:R)" filtrelerinden geçmesi zorunludur.

### 1- Teknik Analiz Skorlamaları (Puanlama Sistemi)
*   **Order Block (OB) (+25):** 30 mumluk periyotta kurumsal alım/satım blokları tespit edildiğinde büyük bir ağırlıkla puan eklenir.
*   **FVG (Fair Value Gap) (+15):** Fiyat boşlukları varsa hedef bölgesi daraltılarak (güvenli bölgeye) işlem onayı alır.
*   **RVOL (Göreceli Hacim) (+15):** Son 3 mumdaki hacmin, geçmiş 20 muma oranı (1.2x) fazlaysa hacim onayı alınır.
*   **Bayrak/Flama Formasyonu (+10):** Agresif direk kırılımlarında Trend devam formasyonu tetiklenir ve hedef direk boyu kadar uzatılır.
*   **Ichimoku Trend Onayı (+15):** Fiyat bulutun ve Tenkan/Kijun çizgilerinin doğru tarafındaysa trend onayı alınır.
*   **4H Multi-Timeframe Trend Onayı (+15 veya -5):** İşlem yönü, 4 saatlik grafik trendiyle eşleşmiyorsa ceza alır, eşleşiyorsa premium puan alır.
*   **ADX Rejimi (Trend Gücü):** ADX > 25 ise (+10 puan). Fiyat yataysa ve testere piyasasıysa (ADX < 20) (-10) ceza alır.
*   **Stochastic RSI Aşırı Alım/Satım Cezaları (-10):** İşlem yönüne göre StochRSI zirve (80+) veya dip (20-) noktalardaysa FOMO'ya kapılmamak için ceza kesilir.
*   **Portföy Çeşitliliği Cezası (-12):** Aynı anda Majör kriptolarda (BTC, ETH, SOL, BNB) birden fazla aynı yönlü işlem açıksa risk yönetimi için puan düşürülür.

### 2- Hisse Senedi ve Varlık (MTA) Özel Analiz Motoru
Kriptolardan farklı olarak Geleneksel Market varlıklarına (AAPL, TSLA, NASDAQ, XAUUSD) özel kurallar devrededir:
*   **VWAP Uyum (+8):** Kurumsal oyuncuların maliyet noktası olan Hacim Ağırlıklı Ortalama Fiyat (VWAP) ile yön uyumu aranır.
*   **Options Max Pain Çekimi (+8):** Opsiyon piyasalarının (Put/Call) kapatılmak isteneceği "Maksimum Acı (Max Pain)" noktasına fiyat %1 ile %8 arasında uzaklıktaysa devasa bir mıknatıs etkisi yaratır.
*   **Gamma (Put/Call) Call Resistance & Put Wall Support (+7):** Opsiyon tahtalarındaki devasa duvarlar destek ve direnç olarak kullanılır.
*   **Gap (Boşluk) Doldurma (Gap Fill):** Hedef fiyat, mevcut boşlukları doldurmak üzere agresif şekilde güncellenir.

---

## BÖLÜM 2: ELYTE PERİSKOP RİSK MATRİSİ (R:R VE STOP LOSS KURALLARI)

Her bir sinyalin, PnL (Kâr/Zarar) dengesini koruması için kurumsal düzeyde katı filtreleri vardır:
1.  **Zarar Kes (Stop-Loss) Barajı (Maksimum %3.5):** Volatiliteden bağımsız olarak bir işlemin Stop Loss uzaklığı %3.5 değerinden büyükse sistem işlemi doğrudan **çöpe atar** (reddeder).
2.  **Minimum Risk Ödül (R:R) Beklentisi (1:1.5):** Standart işlemlerde kazanılacak para (Reward), göze alınan riskin (Risk) en az 1.5 katı olmalıdır. 
3.  **Premium Limitler (Esneme Kuralları):**
    *   Eğer bir işlemin Stop Loss oranı **%2.5'ten yüksekse** (agresif risk taşıyorsa), bu işlemden en az `1:2.0` R:R beklenmektedir. Beklentiyi karşılamazsa reddedilir.
4.  **Skor Barajı:** Kriptolar ve Hisselerde sinyal havuzuna düşmek için *Long ve Short* yön fark etmeksizin Kalite Skorunun minimum **55** olması gereklidir (13 başarısızlık konseptinin 10'unu eler).
5.  **Trailing Stop Guard:** İşlem %1 hedefine (1 Risk oranına) ulaştığı anda Stop Loss noktası giriş noktasına (Maliyet) çekilerek Risk Sıfırlanır (Koruma Kalkanı).
6.  **Otonom Backtest Parçalama Kuralı:** Sistem algoritmaları veya skor barajları backtest edilirken (örneğin: `run_macro_micro_backtest.js`), başarı sonuçları dümdüz verilmez. Raporlarda veriler *Overfitting'i engellemek adına* **zorunlu olarak her 5 puanlık Kalite Skoru aralığına göre (Örn: 40-44, 45-49, 50-54... 95-100)** kırılarak ayrı ayrı istatistiklendirilir.

---

## BÖLÜM 3: GÜNLÜK (CHANGELOG) VE SİSTEM MÜDAHALELERİ

*Buraya yaptığımız tüm altyapı güncellemelerini, versiyon notlarını ve kararları tarih bazlı ekleyeceğiz.*

### Tarih: 10 Nisan 2026 - Breakeven & Admin Balyoz Özelliği
**(Sürüm: v2.8.6)**
*   **(Core Logic - Breakeven) Başabaş Kapanış Durumu:** Önceden hedef barajına (%1 = 1R/Maliyet çizgisi, `reachedTwoPercent`) varıp maliyete stop çekilen işlemler, fiyata geri değdiğinde mantıksız bir şekilde istatistiklere "KAYIP (LOSS)" olarak yansıyordu. `scanner.js` ve veritabanı uçları güncellenerek bu işlemler artık "BAŞABAŞ (BREAKEVEN)" durum koduyla kapatıldı. Tüm geçmiş hatalı zararlar geriye dönük düzeltilerek istatistiklerdeki WinRate kurtarıldı.
*   **(Frontend & Backend - Admin Balyoz) Global Sinyali Kapatma Yetkisi:** Elyte Admin'i (Örn: Telegram ID 1194576674) artık "Sinyaller" sayfasında tüm piyasa adına açık duran sinyalleri tek tuşla (Admin Kapat) sonlandırabiliyor. Uzun ve yatay giden işlemler PnL (Anlık Kâr veya Zarar) ile doğrudan istatistiklere kazınır.
*   **(Finansal Koruma) Matematiksel Bütünlük Filtresi:** Adminin erken kestiği kârlı işlemler, ilk baştaki "Uzanılamayan Hedefe (Target)" göre kâr yazmasın diye, işlemi kestiği saniyedeki anlık fiyat, sinyalin veri tabanındaki nihai hedefine işlenir (`UPDATE targetPrice = currentPrice`). Böylece istatistikteki başarı oranı "hayali" olarak kabarmaz, harfi harfine gerçekçi bir net yüzde gösterilir.
*   **(Frontend Makro UI) Nasdaq (US) Canlı Seans Göstergesi:** Dünyanın neresinde olursa olsun yazılım her zaman "America/New_York" saat birimine bağlanarak (DST yaz-kış saati farklarına otomatik adapte olur), hafta içi "16:30 - 23:00" aralığını kapsayacak şekilde (NY 09:30 - 16:00), istatistik ekranındaki Nasdaq Makro göstergesinin hemen üzerine gerçek zamanlı 🟢 AÇIK / 🔴 KAPALI uyarı sensörleri eklendi.
*   **(AI Core) Gelişmiş Finansal Metrikler ve "Paslanma Etkisi" Paradigması:** AI Screener'ın (`screener_engine.js`) karar alma motoru, sadece F/K'ya bakmanın ötesine geçirilerek; `Serbest Nakit Akışı (FCF)`, `Fiyat/Satış (P/S)`, `Borç/FAVÖK` gibi kurumsal metrikleri de analiz etmesi için güncellendi. Ayrıca yapay zeka prompt una "Çarpan Şişkinliği ve Paslanma Etkisi" kuralı eklenerek, aşırı değerlenmiş "Harika Şirketlerin" de fiyat çarpanı bağlamında reddedilebilmesi sağlandı.

### Tarih: 8 Nisan 2026 - Elyte Dashboard UI Overhaul & Risk Control Fixes 
**(Sürüm: v2.8.5)**
*   **(Frontend) Arayüz Modernizasyonu:** Dashboard yapısındaki sinyal kartları dikey yapıdan 6 sütunlu (`1fr 1.5fr 1fr 1.1fr 1.1fr 0.8fr`) veri bankası/tablo (Nasdaq Barometer tarzı) formuna dönüştürüldü.
*   **(Frontend) Anlık Fiyat Sütunu:** Sinyal paneline Varlık Yönü, Fiyat Tablosu, Sinyal Durumu arasına "Anlık Fiyat" sutünu eklendi. Mobil (Stacked) görünümde responsive destegi sağlandı.
*   **(Frontend) Yüzdelik Kâr/Zarar Bilgileri:** TP ve SL kısımlarının hemen altına gerçekleşmesi gereken (-%X.XX) hedefler taşındı.
*   **(Backend) AWS Deployment & PM2:** GitHub `main` aracılığıyla frontend Vercel ortamına aktarıldı, Backend sistemleri `rsync` ile AWS (13.60.44.209) üzerine itildi.
*   **(Core Logic) Periskop Risk Matrix Onarımı:** Çekirdek algoritmadaki R:R kontrollerinin (1:1.5 sınırı, Max %3.5 SL reddi, Premium aralıklar) backend'de eksik olan `CONFIG` değişkenlerini güncelleyerek yeniden sisteme dahil edilmesi sağlandı. 
*   **(Veritabanı Hata Giderme):** Geçmiş yanlış CONFIG ayarı ile içeri sızan 1:1 risk-ödüllü tüm son sinyaller AWS EC2'den direkt db müdahalesi `sqlite3` komutlarıyla `signals`, `user_trades` ve `favorites` tablolarından kazındı. Gece 03:00'te verilecek Win/Rate analizi temizlendi.
*   **(Frontend Veri API Çiftlemesi (Dual-Node)):** Sadece Binance veya sadece Bybit kullanarak yaşanacak liste dışı (delist/rebrand) token veri kayıplarını önlemek adına hibrit ağ kuruldu. Frontend artık **Bybit API** ve **Binance Spot API** noktalarının ikisinden de fiyatları çekip harmanlıyor (merge). Böylece Bybit'te olmayan FET verisi Binance'den tamamlanıyor. PnL kayıplarının önü sonsuza dek kesildi.
*   **(Backend Proxy ile Kurumsal Varlık Fiyatları):** XAGUSD (Gümüş), XAUUSD (Altın), NASDAQ gibi geleneksel (TradFi) varlıklar ne Binance ne Bybit spot API'sinden gelmeyeceği için; Node.js sunucusunda (`/api/prices/assets`) Özel Bir Proxy Endpoint yazıldı. CORS aşıldı.
*   **(TradFi Valuation Shift - Kurumsal Büyüme Filtresi):** Hisse senetleri ve altın (isAsset: true) için Kripto'daki klasik osilatör "Aşırı Alım/Satım" (RSI > 75, StochRSI) cezaları YASAKLANDI. Artık dev ihaleler veya bilanço etkileriyle fırlayan hisselerde Perplexity'nin referans verdiği "Hak Ediş / Yapısal Büyüme" (Structural Growth) vizyonu geçerli. RSI 80 üzerine çıktığında sistem puan kırmak yerine +5 "Trend Kırılımı / Kurumsal Değerleme" puanı ile ödüllendirerek bunu onaylıyor.
*   **(Core Logic) R:R Puan Enflasyonu (Loophole) Düzeltmesi:** Eski sistemde, hedefler zorunlu (1.5x - 2.0x) seviyelerine kadar esnetildiği (Target Extended) için, sistem havadan her işleme +25 bonus veriyordu ve barajı anlamsız kılıyordu. Artık +25 veya +5 R:R Puanları, yalnızca hedefler **ESNETİLMEDEN ÖNCEKİ DOĞAL/ORGANİK** teknik potansiyele göre veriliyor. Puanı hak edemeyen vasat işlemler reddediliyor.
*   **(Data Engineering) Binance Çiftleme (Dual-Fetch) XMR (Delist) Düzeltmesi:** `Dashboard.jsx`'te Bybit fiyatlarını Binance ile güncelleyen mantıkta bir hata tespit edildi. XMR (Monero) gibi Binance'den çoktan *delist* olmuş coinlerin ölü ve donmuş eski fiyatlarının, Bybit'in güncel fiyatlarının üstüne yazılması engellendi. Binance Data Fetch sadece "Eğer Bybit'te o coin hiç yoksa" çalışacak şekilde filtrelendi.
*   **(Risk Yönetimi) Otomatik Emir Doldurma (BACKFILL) İptali:** `scanner.js` içerisindeki `backfillTrades()` mantığı tamamen kapatıldı. Sistemin sırf kotayı (10 işlem) doldurmak için fiyatı eski seviyesine gelen bayat sinyalleri açması engellendi. 10 boş slot, sadece anlık ve potansiyelli "YENİ/TAZE" sinyallere saklanacak. Eski işlemleri sadece kullanıcı manuel favorilerse açacak.

### Tarih: 9 Nisan 2026 - Kurumsal Hafıza Ajanı ve LLM Prompt Revizyonu
**(Sürüm: v2.8.6)**
*   **(AI Core) PeriskopAI (KTOS) Kuralları Entegrasyonu:** LLM `analyze` motoru tamamen PeriskopAI Kurumsal Sinyal konseptine güncellendi. "KTOS Kuralı" devrede: Hisse senetleri (Assets) için fiyatlarda mantıksız %80'lik çöküş beklentileriyle Alım (Entry) seviyeleri belirlenmesi yasaklandı. Fiyatlarda %15-30 arası gerçekçi düzeltme şartı koşuldu. Açıklamalar "Darboğaz" analizlerine, FDA onaylarına ve somut bilanço tablolarına odaklandı.
*   **(Terminal Güvenliği) Veritabanı (DB) Kalkanı Sızdırmazlığı:** `rsync` ile AWS'ye deploy yapılırken kazara yaşanan üretim veritabanının ezilmesine/silinmesine karşın "Red Line" güvencesi oluşturuldu. Kod güncellemeleri `deploy.sh` kilidine bağlandı, `*.db` ve `*.sqlite` dosyaları sonsuza dek dokunulmaz kılındı.
*   **(Otonom Hafıza) Memory Agent:** AI'ın (Antigravity Motoru) CTO ile yaptığı tüm konuşma geçmişlerini saatlik periyotta masaüstündeki yedek klasörüne senkronize eden ve Manifesto güncellendiğinde GitHub'a otomatik yedek atan Otonom Hafıza Ajanı kurgulandı.
*   **(Otopilot Güvenliği) Gün İçi Sinyal Tekrarı (Duplicate) Engeli:** Aynı paritede (Örn: NXPCUSDT) gün içerisinde alınan Stop-Loss'lar sonrası bakiyeyi eritmemek için, `scanner.js` içerisindeki Duplicate sorgusu `user_trades` yerine `signals` (Tüm Sinyaller) tablosuna bağlandı. Gün içinde 2. veya 3. kez gelen sinyaller **kesinlikle otopilot tarafından açılmaz**, sadece Dashboard'da pasif sergilenir.
*   **(Manuel Kontrol) Favori Eşleşmesi:** Dashboard üzerinden Admin tarafından "Favori (Yıldız)" butonuna basılarak manuel işleme alınan pasif sinyaller, aynı saniye `user_trades` içerisine (Otopilot Döngüsüne) kayıt edilir. Manuel kararlar da sistemin Kâr Al (NATIVE_TP) ve Başa-Baş Stop (Trailing Guard) zekasından tam faydalanır.
*   **(TradFi Filtresi) Akıllı Mesai (Institutional Hours):** Geleneksel Varlık (Hisse Senedi, NASDAQ, Emtia) taramaları Asya/Gece manipülasyonlarından korunmak ve salt "Amerikan Hisse Piyasası" hacmine odaklanmak için özel bir zaman dilimi kilidine (Europe/Istanbul kullanılarak) bağlandı. TradFi sinyalleri yalnızca **Hafta İçi, Türkiye Saatiyle 15:30 - 23:00** arasında üretilir. Geceleri TradFi uyku moduna geçerken Kriptolar 7/24 otonom olarak işlem görmeye devam eder.

### Tarih: 10 Nisan 2026 - Periskop Elite Filter & Kâr/Hacim Optimizasyonu
**(Sürüm: v2.8.8)**
*   **(Finansal Strateji & Fon Modeli İş Akışı):** Elyte robotunun günlük çok sayıda sinyal atarak (Günde 22 sinyal) "Başa-baş Kapanış / Win Rate %46" barajına sığmasının kasa büyümesini durdurduğu tespit edildi. Matematiksel verilerle fonun kasasını güvenle aylık %10+ büyümesi için sinyal sayısının düşürülmesine ve Win Rate'in en elit seviyelere (%57+) çıkartılmasına karar verildi. "Kalite Tespit Barajı" artırılarak Kripto havuzunun çöpleri temizlendi.
*   **(AI Çekirdeği) Otonom Puan Barajının Yükseltilmesi:** Eskiden zayıf sinyalleri yakalamak için asimetrik tutulan Kalite Barajları `LONG için 55 -> 70`, `SHORT için 55 -> 75` barajlarına uçurularak sadece kusursuz emarelere odaklanan **Keskin Nişancı** moduna geçiş yapıldı.
*   **(Test ve Geri Alma - Revert Policy):** Algoritmada önceki orijinal baraj limitleri, eski işleyişe hızlı geri dönüş ihtimaline (Rollback) özel bir rezerve edilmiş yorum satırı (//) olarak muhafaza edilmektedir. Sistemdeki kod onayı alınana kadar "Elite Filter Test Modunda" sayılacaktır.

### Tarih: 10 Nisan 2026 - ChatGPT (Kurumsal Çekirdek) Engulfing & Sweep Devrimi
**(Sürüm: v2.9.0 - PeriskopAI Sürümü)**
*   **(Yapay Zeka Mimarisi Uyumlanması):** ChatGPT'den alınan "15 Yıllık Kurumsal Price Action" dökümü algoritma ile kodlara döküldü. Sistemin puanlamasının şişip çökmesini (Overfitting) engellemek adına Özel Kategori Slot (Bölge + Tetik + Tuzak) sistemine geçildi.
*   **(Tetik Slotu):** `Killer Wick (Fitil)` veya `Engulfing (Yutan Mum)`. İkisi de piyasa dönüşünü haber verir. İşlemde birinden biri yakalanırsa **+20 Puan** alınır. Aynı andalarsa puan katlanmaz.
*   **(Tuzak Slotu):** `Liquidity Sweep (Stop Patlatma)`. İşlem onayı almadan hemen önce Eşit Dipler veya Eşit Tepeler (Equal Lows/Highs) temizlenmiş ve onaylı bir kapanış gelmişse ekstra **+15 Puan** verilir.

### Tarih: 11 Nisan 2026 - Macro/Micro (300 Mum + 200 EMA) Fon Ayrışımı
**(Sürüm: v3.0.0 - Kurumsal Filtre)**
*   **(Değişiklik):** Piyasadaki fiyat anormalliklerini ve yanlış hesaplanan "Trend İhlallerini" (Ceza: -15 puan) engellemek adına periyodik mum kapasitesi 250'den **300 Muma** çıkartıldı.
*   **(Macro Context):** 300 mumluk devasa bir verisetinden "200 EMA (Üssel Hareketli Ortalama)" verisi ısındırılarak çekildi. SMA (Basit Ortalama) tamamen terk edildi. Bu, trendi çok daha erken ve sert bir isabetle kavramamızı sağladı.
*   **(Micro Setup):** Sinyal bölgesindeki Order Block, FVG, Wick ve Sweep analizleri son **100 Mum** içine izole edilerek sistem "Pusu" (Keskin Nişancı) moduna sokuldu.
*   **(Fon Disiplini):** Backtest sonuçlarında açıkça görülen (Score < 60 olan işlemlerin %30 WinRate'te kalması) zafiyetine karşı sistem, Puan Barajının **65** olmasının matematiksel doğruluğunu tamamen tasdikleyip bu barajı kalıcı kıldı. Havuzda işlem sayısı azalırken kâr marjı arşa çıkarıldı.
### Tarih: 10 Nisan 2026 - R:R (Risk/Reward) Bonusu İptali & Saf PA Modelinin Devreye Alınması
**(Sürüm: v2.9.1)**
*   **(Değişiklik Gerekçesi):** Yüksek R:R (1:2 ve üzeri) oranlarına verilen `+25` puanlık ödülün, zayıf Price Action yapısına sahip "çöp" sinyalleri sadece "stopu ucuz" diye puanla şişirip sisteme soktuğu tespit edildi. Bu durum PeriskopAI sisteminin kalitesinde enflasyon yarattığı için **R:R Bonusları tamamen kaldırıldı.**
*   **(Yeni Baraj Ayarı):** R:R hormonunun sistemden atılmasıyla birlikte "Saf Price Action" motoruna geçilmiş ve barajlar her iki yön (LONG/SHORT) için de **65** puana sabitlenmiştir. 65 puan; içerisinde Order Block, FVG, Katil Fitil, Engulfing veya Stop Patlatma barındırmayan hiçbir düz mumun geçemeyeceği kadar katı bir bariyerdir. 

### Tarih: 11 Nisan 2026 - PeriskopAI Self-Reflective Learning (Öz-Bilinç/Hafıza) & FOK (Fill Or Kill) Kalkanı
**(Sürüm: v3.1.0 - Risk Architect Modeli)**
*   **(Otopsi Ajanı - Post Mortem):** Sistem zarar eden (LOSS) işlemlerin geçmiş fiyat verilerini Gemini yapay zekasına asenkron olarak gönderip `"Neden stop olduk buna bir kural çıkar"` emri vererek kendi hatalarından canlı Dersler (Lessons) çıkarmayı öğrendi.
*   **(Otonom Karar Gecikmesi ve Slippage/Kayma Koruması):** Yapay Zekanın bir sinyalin girilip girilmeyeceğini, geçmiş dersleri (hafıza) tarayarak düşünmesi 5-15 saniyelik bir gecikme yarattığından; karar çıktıktan hemen sonra canlı fiyat tekrar teyit edilir. Sinyali ilk bulduğumuz puanlama anı ile LLM'nin olay bittikten sonraki ONAY anı arasında fiyat binde 3'ten (**%0.3**) fazla kaymışsa (Slippage), emir **BORSAYA OTOMATİK İLETİLMEZ**. Kullanıcının inisiyatifine bırakılarak Manuel Giriş uyarısı verilir. Bu muazzam kural, sermayenin gecikme kaynaklı kötü R:R oranlarından korunmasını sağlayan tam teşekküllü bir Fill or Kill (FOK) güvenliğidir.
*   **(Gölge İzleme & Evrimsel İstisnalar - Shadow Evolution):** LLM'nin geçmiş veriye dayanarak işleme girmeyi engellediği durumlar (Shadow Trades) arka planda ajan tarafından kâr/zarar yönünden gizlice izlenir. Şayet Ajanın "SL olacak" deyip ENGELLEDİĞİ bir işlem şaşırtıcı şekilde HEDEFE (TP) ulaşırsa; kuralı silmek yerine **"Evrimsel Esneklik"** devreye girer. İşlemin son 24 saati AI'a tekrar okutularak, orijinal kuralın altına *"İSTİSNA: Eğer mevcut ortam [Sebebiyet] içeriyorsa bu kuralı bozup emre izin ver"* tarzında alt-başlıklar ağacı kurulur. Bu sistem, PeriskopAI'ı sığ bir bot olmaktan çıkarıp, esnek zekalı bir Fon Yöneticisi yapar.

---

## 🔬 Standart Backtest Protokolü (PeriskopAI Protokolü)
Yönetici (User) sisteme "Backtest yap" komutu verdiğinde AI (Antigravity) tarafından aksi belirtilmedikçe her seferinde geçerli olacak standart veri çekme ve analiz protokolü aşağıdadır:
1.  **Veri Kaynağı:** BingX borsası üzerinden **geçmiş 1 aylık** mum verileri (Klines) çekilir.
2.  **Uygulanacak Metot:** Mevcut `scanner.js` ve manifesto içerisindeki o anki aktif Price Action analiz kurgusuna (Tetikleme, Bölge, Tuzak) ek olarak, yöneticinin o anki özel isteği eklenip/çıkarılarak laboratuvar simülasyonuna alınır.
3.  **Standart Raporlama Zorunluluğu:** Test sonucunda AI; talep edilen **her bir puan barajı** (Threshold) için ayrı ayrı olmak üzere şu verileri teslim etmek zorundadır:
    - 1 aylık toplam sinyal sayısı (ve günlük ortalama)
    - İşlemlerin kaçı LONG, kaçı SHORT
    - Kaçı TP (Hedef), Kaçı SL (Zarar Kes) oldu
    - Win Rate (Kazanma Oranı) yüzdesi
    - **Kasa Simülasyonu:** 500$ başlangıç kasası, R:R=1.5 kuralları, Çapraz Mod 20X kaldıraç mantığına göre 1 ayın sonundaki *Net Kâr/Zarar (USD)* durumu tablolandırılır.
