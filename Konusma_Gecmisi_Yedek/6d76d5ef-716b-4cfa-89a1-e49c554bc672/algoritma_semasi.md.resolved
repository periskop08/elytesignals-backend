# Elyte Trading Bot - Algoritma Kural Şeması

Bu şema, sistemin altcoinlerdeki fırsatları nasıl değerlendirdiğini ve makro verilerle (BTC, ETH, Dominans) nasıl süzgeçten geçirdiğini açıklamaktadır. Sürdürülebilir bir Price Action stratejisi olup olmadığını yapay zekalara (Perplexity vb.) danışmak için bu metni kopyalayabilirsiniz.

## 1. Temel Sinyal Üretimi (Price Action Tarayıcısı)
Bot, yüzlerce grafiği tarayarak aşağıdaki şartlar olgunlaştığında bir "Potansiyel Sinyal" (LONG veya SHORT) oluşturur:
- **Likidite Alımı (Sweep):** Range Low veya Range High seviyelerinde bir fitil (wick) atılıp likiditenin temizlenmesi şarttır.
- **Karakter Değişimi (CHOCh):** Fitilin ardından fiyatın ters yöne kırılarak Market Structure'ı dönüştürmesi zorunludur.

*(Eğer bu iki şart sağlanırsa, bot ilgili altcoini "İşleme Girmeye Aday" ilan eder ve Filtre aşamasına sokar.)*

---

## 2. Küresel Piyasa (Macro Context) Filtreleme Aşaması
Aday olan sinyal, işleme dönüştürülmeden önce son 15 dakika içinde güncellenmiş olan **3 Temel Makro Parametre'nin** onayından geçmek zorundadır. Makro trendler `EMA(20), SMA(50) ve RSI(14)` indikatörleri ile (`1h, 4h, 1d` zaman dilimlerinde) hesaplanır.

### Parametre A: Bitcoin Trendi (Piyasanın Abisi)
- Eğer Aday Sinyal **SHORT (Düşüş)** ise ve Bitcoin (BTC) 4H/1D periyotlarında **BULL (Boğa)** trendindeyse ➡️ **REDDEDİLİR!** *(Sebep: Ralli yapan piyasada tepe avcılığı yapılmaz.)*
- Eğer Aday Sinyal **LONG (Yükseliş)** ise ve Bitcoin (BTC) 4H/1D periyotlarında **BEAR (Ayı)** trendindeyse ➡️ **REDDEDİLİR!** *(Sebep: Çöken piyasada dip avcılığı yapılmaz.)*

### Parametre B: Ethereum Trendi (Altcoin Total Market Temsilcisi)
- Eğer Sinyal **SHORT** ise ve ETH (Market) **BULL (Boğa)** ise ➡️ **REDDEDİLİR!**
- Eğer Sinyal **LONG** ise ve ETH (Market) **BEAR (Ayı)** ise ➡️ **REDDEDİLİR!**

---

## 3. Dinamik Puanlama ve Ceza Sistemi (Scoring)
Filtreyi başarıyla geçen ve iptal edilmeyen sinyaller, son aşamada kalite puan testine girer. Toplam puan `45` barajını aşarsa işlem borsaya gönderilir.

**Standart Puanlar (Altcoin'in Kendi Grafiği):**
- Order Block (OB) bölgesinden tepki alındıysa: `+25 Puan`
- Fair Value Gap (FVG) boşluğu doldurulduysa: `+15 Puan`
- Kırılım anında hacim (RVOL) artışı varsa: `+15 Puan`
- 4 Saatlik Altcoin Grafiği ana trendi destekliyorsa: `+15 Puan` *(Ters ise -5 Puan)*

**Dinamik Makro Puanlar (Bitcoin Dominansı Etkisi - BTCDOM):**
Para akış yönünün (Likiditenin) tespit edilerek LONG işlemlerin kalitesinin manipüle edilmesi:
- Eğer **BTC Dominansı Artıyorsa (BULL):** Para altcoinlerden çıkıp Bitcoin'e akıyordur. Bu riskli ortamda altcoin *LONG* işlemlerine peşin **`-15 Puan`** ceza uygulanır (İşlem anca kendi grafiği kusursuzsa barajı geçebilir).
- Eğer **BTC Dominansı Çöküyorsa (BEAR):** Altcoin rallisi/partisi başlamış demektir. Ekstra rüzgar desteği olduğu için tüm altcoin *LONG* işlemlerine peşin **`+15 Puan`** ödül verilir (Barajı rahat geçmeleri sağlanır).

---

## 🤖 Değerlendirme İçin Prompt Önerisi (Perplexity'e Nasıl Sorulur?)
Alt kısımdaki metni kopyalayıp sorabilirsiniz:

> "Benim kripto para piyasası için geliştirdiğim bir trading botu var. Algoritması yukarıda anlattığım 3 aşamadan (Price Action Sweep, BTC/ETH Makro Filtrelemesi, BTCDOM Dinamik Skorlaması) oluşuyor. 
> 
> Sence oluşturduğum bu kurallar dizisi, özellikle boğa piyasalarında gereksiz short açma (stop patlaması) kurbanı olmamı engelleyecek kadar mantıklı ve güvenilir bir risk-yönetimi sunuyor mu? Bu stratejinin Price Action akışında zayıf veya 'bunu da eklemelisin' dediğin bir yanı var mı?"
