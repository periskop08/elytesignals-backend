# Elyte TradFi (Hisse/Emtia) Veto ve Kurumsal Trend Revizyonu

Kripto tabanlı mevcut sistemimizde, teknik indikatörler (özellikle osilatörler) varlıklar arasında bir ayrım yapmadan "aşırı alım/satım" alanlarında agresif puan kırmaktaydı. Perplexity'nin işaret ettiği **Hisse Senedi Hak Edişi (Stock Merited Value)** modeli uyarılarınca; köklü hisse ve emtialar için teknik düzeltmeler yerine yapısal büyümenin (structural growth) tespitini sağlayacak bir algoritma katmanı eklenecektir.

## Proposed Changes

### `backend/scanner.js`

#### [MODIFY] scanner.js

Geleneksel varlıklar (`isAsset: true`) için algoritmik skor ve analiz motorunda temel değişiklikler yapılacaktır:

1.  **RSI Veto Mantığı (Valuation Shift):**
    *   Mevcut sistemde RSI 75 üzerine çıktığında LONG yönlü işlemler için kaliteden 10 puan silinmektedir (`RSI Overbought for LONG`).
    *   *Yeni Kurgu:* Eğer `symbolInfo.isAsset` doğruysa (Hisse veya Altın gibi), RSI 75 üstü ekstrem alımlar eksi puan yerine **Artı Puan (+5)** ile ödüllendirilecektir. Mesajı ise "Aşırı Alım Değil, Kurumsal Değerleme (RSI > 75) (+5)" şeklinde yazılacaktır. Sistem bunu bir "balon" değil, bir "kırılım" olarak yorumlayacaktır.
2.  **Stochastic RSI Veto Mantığı:**
    *   Benzer şekilde StochRSI aşırı alım bölgesindeyken hisselerde puan kırmak yerine, bunu bir momentum kırılımı (Breakout) kabul ederek puan kırmak yerine koruma altına alacağız.
3.  **Makro ve Global Konjonktür Filtresi:**
    *   Mevcut durumda Kripto'lar (BTC.D, USDT.D) üzerinden yapılan makro analiz hisseleri zaten teğet geçiyor. Fakat hisseler için ekstra **Dirençten Destek Çıkarma** stratejisi entegre edilebilir. Eğer hisse `isAsset` ise ve Trend güçlü boğaysa (ADX > 25), `isAsset` loglarında bunu *Konsolidasyon* beklentisi olarak yansıtıp, SHORT kırılımlarını zayıflatacağız.

## User Review Required

> [!WARNING]
> Kriptolar (BTCUSDT, ETHUSDT vb.) için mevcut katı ve acımasız filtreler (RSI aşırı alım puan düşüşleri, overbought cezaları) AYNEN DEVAM EDECEKTİR. Bu yepyeni "Ödüllendirme" mantığı sadece TSLA, AAPL, XAUUSD, NASDAQ gibi borsaların **Global Hisse ve Emtia** tahtalarında devreye alınacaktır.

Bu plan doğrultusunda Hisse Senetleri için *Aşırı Alım Puan Kesintisi Veto* mantığını direkt ana algoritmamız (scanner.js) içerisine entegre edip canlıya alarak yayına çıkabilir miyim? Onayınızla kodları değiştireceğim.
