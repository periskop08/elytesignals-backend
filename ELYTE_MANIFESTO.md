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

*Buraya yaptığımız tüm altyapı güncellemelerini, versiyon notlarını ve kararları tarih bazlı ekleyeceğiz.*

### Tarih: 8 Nisan 2026 - Elyte Dashboard UI Overhaul & Risk Control Fixes 
**(Sürüm: v2.8.5)**
*   **(Frontend) Arayüz Modernizasyonu:** Dashboard yapısındaki sinyal kartları dikey yapıdan 6 sütunlu (`1fr 1.5fr 1fr 1.1fr 1.1fr 0.8fr`) veri bankası/tablo (Nasdaq Barometer tarzı) formuna dönüştürüldü.
*   **(Frontend) Anlık Fiyat Sütunu:** Sinyal paneline Varlık Yönü, Fiyat Tablosu, Sinyal Durumu arasına "Anlık Fiyat" sutünu eklendi. Mobil (Stacked) görünümde responsive destegi sağlandı.
*   **(Frontend) Yüzdelik Kâr/Zarar Bilgileri:** TP ve SL kısımlarının hemen altına gerçekleşmesi gereken (-%X.XX) hedefler taşındı.
*   **(Backend) AWS Deployment & PM2:** GitHub `main` aracılığıyla frontend Vercel ortamına aktarıldı, Backend sistemleri `rsync` ile AWS (13.60.44.209) üzerine itildi.
*   **(Core Logic) Periskop Risk Matrix Onarımı:** Çekirdek algoritmadaki R:R kontrollerinin (1:1.5 sınırı, Max %3.5 SL reddi, Premium aralıklar) backend'de eksik olan `CONFIG` değişkenlerini güncelleyerek yeniden sisteme dahil edilmesi sağlandı. 
*   **(Veritabanı Hata Giderme):** Geçmiş yanlış CONFIG ayarı ile içeri sızan 1:1 risk-ödüllü tüm son sinyaller AWS EC2'den direkt db müdahalesi `sqlite3` komutlarıyla `signals`, `user_trades` ve `favorites` tablolarından kazındı. Gece 03:00'te verilecek Win/Rate analizi temizlendi.
*   **(Frontend Veri API Çiftlemesi (Dual-Node)):** Sadece Binance veya sadece Bybit kullanarak yaşanacak liste dışı (delist/rebrand) token veri kayıplarını önlemek adına hibrit ağ kuruldu. Frontend artık **Bybit API** ve **Binance Spot API** noktalarının ikisinden de fiyatları çekip harmanlıyor (merge). Böylece Bybit'te olmayan FET verisi Binance'den tamamlanıyor. PnL kayıplarının önü sonsuza dek kesildi.
*   **(Backend Proxy ile Kurumsal Varlık Fiyatları):** XAGUSD (Gümüş), XAUUSD (Altın), NASDAQ gibi geleneksel (TradFi) varlıklar ne Binance ne Bybit spot API'sinden gelmeyeceği için; Node.js sunucusunda (`/api/prices/assets`) **Özel Bir Proxy Endpoint** yazıldı. Bu endpoint, BingX emtia vadeli tahtalarındaki şifreli isimleri (`NCCOXAG2USD-USDT`) okuyup, Frontend'in anlayacağı temiz isimlere (`XAGUSD`) çevirerek CORS engeline takılmadan ekrana canlı yansıtıyor. Bütün piyasalar artık tek cephede birleşti.
