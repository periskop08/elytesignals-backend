# Proje Hedefi: Kripto Sinyal ve Analiz Uygulaması

TradingView'den gelen sinyalleri listeleyen, kullanıcının bu sinyallere göre işlem alabilmesini sağlayan ve istenen altcoinler için (RSI, MA50, fiyat seviyeleri gibi) analizler sunan "premium" tasarımlı bir mobil uygulama geliştirilecek.

## Kullanıcı Onayı Gereken Konular (User Review Required)

> [!IMPORTANT]
> İlerlemeye başlamadan önce aşağıdaki detayları netleştirmemiz gerekiyor:
> 
> 1. **Teknoloji Yığını:** Mobil uygulama için hem iOS hem Android'e çıktı verebilen **React Native (Expo)** kullanılmasını öneriyorum. Sizin için uygun mu? Başka bir tercihiniz var mı (örn. Flutter, Swift)?
> 2. **Sinyal ve Veri Altyapısı:**
>    - TradingView sinyallerini uygulamaya iletmek için uygulamanın bir sunucuya (Backend'e) ihtiyacı olacak. Bu sunucu için Firebase veya basit bir Node.js servisi kuralım mı?
>    - İşlem alma özelliği için hangi borsayı (örn. Binance, Bybit) entegre edelim, yoksa şimdilik sadece görsel bir demo mu olsun?
>    - "Analiz Sor" bölümündeki RSI, MA50 ve anlık fiyat verilerini çekmek için CoinGecko, Binance API veya TAAPI gibi servisleri kullanmalı mıyız?
> 3. **Proje Kurulumu:** Kodları `/Users/periskop/.gemini/antigravity/scratch/crypto-signal-app` dizini içerisinde oluşturacağım. Bu yeni dizini aktif çalışma alanı olarak ayarlamak ister misiniz?

## Önerilen Mimari

### Mobil Uygulama (React Native + Expo)
- **Sinyaller Ekranı:** Aktif sinyallerin anlık listelendiği, "İşlem Al" seçenekli ana sayfa.
- **Analiz Sor Ekranı:** Kullanıcının coin sorgulayıp sizin belirttiğiniz şablonda teknik analiz yanıtları aldığı bölüm.
- Klasik, yorucu görünümlerden uzak, akıcı animasyonlar (glassmorphism detayları) içeren modern bir arayüz.

### Sunucu / Fonksiyon Katmanı (Backend)
- TradingView webhook'larını karşılayıp mobil uygulamaya anında iletecek sistem.
- Borsa işlemleri (API anahtarlarının mobil uygulamada tutulmaması için güvenlik katmanı).
- Canlı fiyat ve indikatör verilerini çekip analiz metin şablonunu oluşturan mantık katmanı.

## Doğrulama Planı (Verification Plan)
- Seçilen teknolojiyle boş proje oluşturulup derlendiğinden emin olunacak.
- Arayüz bileşenleri "mock" (sahte) verilerle (Bitcoin 70.600$, RSI 30 vb.) doldurulup test edilecek.
- Geliştirme sonunda kullanıcıdan seçilen dizini çalışma alanı (workspace) olarak ayarlaması istenecek ve yerel ortamda test edilmesi sağlanacak.
