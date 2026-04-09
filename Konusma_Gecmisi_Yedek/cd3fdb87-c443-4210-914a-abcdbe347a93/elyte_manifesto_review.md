# ELYTE TRADING SYSTEM MANIFESTO & CHANGELOG

Bu belge, Elyte Kurumsal Yatırım Fonu Terminali'nin çekirdek analiz modelini (Periskop AI Motoru), güvenlik ve risk yönetimi algoritmalarını ve sisteme yapılan günlük/haftalık güncellemeleri kayıt altına almak için oluşturulmuştur. 

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

---

## BÖLÜM 3: GÜNLÜK (CHANGELOG) VE SİSTEM MÜDAHALELERİ

*Buraya yaptığımız tüm altyapı güncellemelerini, versiyonிகளும் (Core Logic, AWS deployments vb.) saniye saniye kaydedildi.*

### Tarih: 8 Nisan 2026 - Elyte Dashboard UI Overhaul & Risk Control Fixes 
**(Sürüm: v2.8.5)**
*   **(Frontend) Arayüz Modernizasyonu:** Dashboard yapısındaki sinyal kartları dikey yapıdan 6 sütunlu veri bankası/tablo (Nasdaq Barometer tarzı) formuna dönüştürüldü.
*   **(Backend) AWS Deployment:** GitHub `main` üzerinden arka uç sistemleri `rsync` ile AWS sunucusuna itildi ve DB kalkanları güvenceye alındı.
*   **(Core Logic) Periskop Risk Matrix Onarımı:** 1:1.5 sınırı, Max %3.5 SL reddi, Trailer onarıldı. Sızan hatalı işlemler veritabanından başarıyla temizlendi (SQL müdahalesi).
*   **(Data Engineering) Hybrid-API Nodes:** Bybit ve Binance Spot API'si beraber kullanılarak delist (XMR) vb. durumlarda yaşanan fiyat hatalarının tamamı yamandı.
*   **(Risk Yönetimi) Otopilot Backfill İptali:** Sadece dolsun diye boş emirlerin girmesi engellendi. Eski işlemleri sadece kullanıcı manuel onay verirse başlatır hale getirildi.

### Tarih: 9 Nisan 2026 - Kurumsal Hafıza Ajanı ve Geleneksel Market Kuralları (Sürüm: v2.8.6)
*   **(AI Core) Hedge Fund (KTOS) Kuralları Entegrasyonu:** Hisse senetleri (Assets) için fiyatlarda mantıksız %80'lik çöküş beklentileriyle Alım (Entry) yasağı geldi. Fiyatlarda %15-30 arası gerçekçi düzeltme şartı.
*   **(Terminal Güvenliği) Veritabanı Sızdırmazlığı:** `deploy.sh` kilidine bağlandı, `*.db` dosyaları korundu.
*   **(Otopilot Güvenliği) Gün İçi Sinyal Tekrarı (Duplicate) Engeli:** Aynı paritede alınan Stop-Loss'lar sonrası bakiyeyi eritmemek için gün içinde 2. veya 3. kez gelen sinyaller otopilot tarafından reddedilir.
*   **(Manuel Kontrol) Favori Eşleşmesi:** Yıldız butonuna basılarak manuel işleme alınan sinyaller sistemin "Kâr Al" (TP) otopilotuna dahil oldu.
*   **(TradFi Filtresi) Akıllı Mesai (Institutional Hours):** Geleneksel Varlık (TradFi - S&P500, NASDAQ, Emtia) taramaları, Asya/Gece manipülasyonlarından korunmak amaçlı **Hafta İçi, Türkiye Saatiyle 15:30 - 23:00** arasında üretilmesi kurala bağlandı. Kriptolar 7/24 otonom çalışır.
