# Dün Geceki Stop-Loss (SL) Patlamasının Analizi

Gece 03:00'ten itibaren oluşan sinyallerin neden yüksek oranda zarar kes (SL) seviyesine ulaştığını netleştirmek için AWS sunucusundaki `signals.db` veritabanında detaylı bir verisel sorgu çalıştırdım.

Elde ettiğim bulgular sorunun kaynağını çok net bir şekilde ortaya koyuyor:

### 1. Eğilim Yanılgısı (Trend Bias)
Gece boyunca sisteme düşen **77 sinyalin** yön dağılımı şu şekildedir:
- **SHORT (Düşüş) Sinyalleri:** 70 Adet
- **LONG (Yükseliş) Sinyalleri:** Sadece 7 Adet

**Ne oldu?**
Yapay zeka periskop motorumuz, gece boyunca RSI şişkinliklerine veya küçük zaman dilimlerindeki (15m, 1h) direnç alanlarına bakarak piyasanın **düşeceğine (SHORT)** aşırı bir şekilde ikna olmuş. Oysa o saatlerde Bitcoin başta olmak üzere piyasa genelinde **sert ve istikrarlı bir yükseliş** dalgası hakimdi. Piyasa yukarı gittikçe, bot inatla açığa satış (Short) kovalamış ve trendin tersinde girdiği bu **70 işlemin en az 37'si** stop-loss yiyerek kapanmıştır. 

*İlginç bir detay: Gece açılan o azınlıktaki 7 adet LONG işlemin 3 tanesi TP hedefine başarıyla ulaşmış. Bu da botun yükseliş yönündeki sinyallerinin harika çalıştığını, ama sadece sayısının çok az olduğunu gösteriyor.*

### 2. Stop-Loss Mesafeleri Yeterli miydi?
Kısa (SHORT) işlemlerde ortalama stop-loss mesafesinin ne kadar sıkı olduğunu hesapladım:
- **Ortalama SL Mesafesi:** %1.58

*Değerlendirme:* 10x kaldıraç kullandığımız senaryoda %1.58 spot fiyat değişimi makul bir kilit noktasıdır. Yani SL hedeflerimiz çok dar ya da hatalı hesaplanmamış. Sadece yön tahmini piyasa gerçekliği ile zıt düşmüş.

### Çözüm Önerisi (Nasıl Önlem Alırız?)
Bot'un Periskop analiz motoru (`scanner.js`), piyasa gücünü (Market Trend) dikkate almak yerine sadece altcoinlerin kendi başına yaptığı lokal tepe/dipleri dikkate alıyor gibi görünüyor. 

- Gerekirse Bitcoin'in (BTCUSDT) veya toplam piyasa değerinin (TOTAL) yönünü belirten bir filtre yazarak; eğer BTC son 4 saatte kesintisiz yukarı gidiyorsa botun "SHORT" işlem sıklığını dramatik şekilde kısıtlayan ya da kalite puanlarını makaslayan bir sistem eklenmesi bu tür toplu Stop-Loss (SL) katliamlarını tamamen önleyecektir.
