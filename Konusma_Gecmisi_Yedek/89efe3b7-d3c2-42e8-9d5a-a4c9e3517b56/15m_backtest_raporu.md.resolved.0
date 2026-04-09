# ⏱️ 15 Dakikalık (15M) Grafik BingX Backtest Raporu

İstediğin test simülasyonunu anında yazdım ve Amazon sunucusundaki asıl verilerle 15 dakikalık (15M) mumları çekerek sistemi tarattım. Test yaklaşık **30 adet hacimli paritede** ve güncel **1.400 mum** (yaklaşık 14.5 günlük kesintisiz veri) üzerinde gerçekleştirildi. 

Sistemin filtreleme barajlarına (Puanlama Kriterleri) göre elde edilen detaylı kırılımlar şunlardır:

## 🔵 Agresif Kategori: Score >= 40 (Standart Baraj)

15 dakikalık periyotta robot oldukça gürültülü piyasada çok fazla tepkiye girdi. İşlem sayısı muazzam artmış olsa da başarı oranı diplere kadar çekildi.

- **Üretilen Toplam Sinyal:** 416 İşlem
- **Take Profit (TP / Win):** 129 İşlem 
- **Stop Loss (SL / Loss):** 287 İşlem
- **Başarı Oranı (Win Rate):** `%31.0`

> **Yorum:** Normalde 1 Saatlik (1H) testte bu puan sınıfında başarı oranımız `%37.3` seviyelerindeydi. 15 dakikalıkta ise aşırı gürültü sebebiyle Win Rate dramatik şekilde *%31'e* çöktü. 1:3 RR mantığında bu oran hala kasa batırmasa da stresi inanılmaz yüksek bir alandır.

## 🟢 Elite Sniper Kategorisi: Score >= 55 (Elit Baraj)

Kalitesi mükemmel olan, yani hem Order Block, hem FVG, hem de hacim onayını aynı anda barındırdığı için yüksek puan alan işlemlere baktığımızda, 15 dakikalık grafiğin içyüzü asıl burada ortaya çıktı. Geleneksel olarak bu kırılım bizim kasa büyüme kalemimizdir, fakat 15M'de işler sarpa sardı.

- **Üretilen Toplam Sinyal:** 58 İşlem
- **Take Profit (TP / Win):** 13 İşlem 
- **Stop Loss (SL / Loss):** 45 İşlem
- **Başarı Oranı (Win Rate):** `%22.4`

> [!WARNING]
> **KRİTİK UYARI / İFLAS TEHLİKESİ**
> 1 Saatlik ayarlarda Elite Puanlarda (55+) BingX üzerinde %44.8 gibi efsanevi bir değere ulaşmıştık. Fakat aynısını 15 dakikalığa çektiğimizde Win Rate'in yükselmesi gerekirken tam aksine **%22.4** seviyesine çökerek adeta iflas moduna girdiğini görüyoruz!

---

### 🧠 Neden Böyle Oldu? (Teknik Gözlem)

15 dakikalık zaman dilimindeki kısa vadedeki iniş çıkışlar, "Price Action (Fiyat Hareketi)" mantığında gerçek bir Likidite Temizliği değil, sadece Market Maker'ların ani "Wick (İğne)" hareketleridir. Bot bunu bir destek olarak görüp yüksek puanla (Score 55) işleme atlasa da, arkasında 1 Saatlik gibi büyük bir hacim birikimi olmadığı için %2'lik harekette hemen Stop seviyesine çarpıp işlemi kapatmıştır.

**Özet Karar:** Zaten bizim sistemi `1H` periyot üzerine kurmamızın sebebi tam olarak buydu Brom. 15M grafikleri algoritmaya katmak kasayı sadece komisyon ve Stop'larla yavaşça eritir. Sistemin orijinali olan **1H (Saatlik) mumların asilliğinden şaşmamak en mantıklısı!** 🎯
