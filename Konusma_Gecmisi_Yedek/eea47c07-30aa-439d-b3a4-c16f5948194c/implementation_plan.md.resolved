# Nasdaq Barometer Arayüz Yenilemesi (UI Overhaul)

Kullanıcının talebi üzerine, "Sinyaller" ve "Favoriler" sekmelerindeki sinyal kartlarının (signal cards) "Varlık Yöneticisi" (Nasdaq Barometer) arayüzündeki gibi şık, yatay ve kurumsal bir tablo düzenine dönüştürülmesi hedeflenmektedir.

## Kurumsal Değerlendirme (Sence Nasıl Olur?)

Bu harika bir fikir! Elyte'i standart bir "kripto sinyal botu" arayüzünden çıkarıp tam anlamıyla **"Kurumsal bir Yatırım Fonu (Hedge Fund) Terminali"** havasına sokacaktır. 
Nasdaq Barometer arayüzündeki yatay tablo dizilimi; verileri çok daha hızlı okumayı, farklı işlemleri birbirleriyle kolayca kıyaslamayı ve tek ekranda daha fazla sinyali yönetmeyi sağlayacak.

## User Review Required

> [!IMPORTANT]  
> Nasdaq Barometer stili yatay tablolar bilgisayar (Web) ekranlarında mükemmel durur ancak **Mobil ekranlarda** (telefonlarda) yan yana çok fazla sütun sığdırmak zorlaşabilir. Mobil cihazlar için yatay tabloyu ya ekranı kaydırmalı (scrollable) biçimde sunmalıyım, ya da mobilde esnek (responsive) olarak otomatik şekilde biraz sıkıştırıp iki satıra böldürmeliyim. Bunu CSS grid ile modern bir şekilde çözeceğim ancak bilgin olmasını isterim. 

## Proposed Changes

Mevcut dikey kart yapısı aşağıdaki sütun düzeninde yatay bir tabloya revize edilecek:

### 1️⃣ Yeni Sütun Dizilimi (Grid Layout)
* **Sütun 1: Varlık & Yön:** Örneğin "STXUSDT" ve altında yeşil "LONG" veya kırmızı "SHORT" etiketi.
* **Sütun 2: Fiyat Tablosu:** Giriş Fiyatı, Hedef ve Stop Loss'un minimal, alt alta temiz bir sunumu.
* **Sütun 3: Kalite & Filtreler:** Sinyalin Skoru (Örn: 55), "Bayrak Formasyonu", "Tekrar İşlem" gibi sinyal uyarıları.
* **Sütun 4: Canlı PnL Durumu:** Sinyalin BingX'teki anlık kâr/zarar oranı ve net durumu. Eğer kapandıysa "ZARAR (%2.1)".
* **Sütun 5: Aksiyon (Favori / Kapat):** Favoriye ekleme yıldızı, ya da "Takipten Çıkar / İşlemi Sonlandır" butonu.

### [web/src/pages/Dashboard.jsx]

#### [MODIFY] Dashboard.jsx
- `renderSignalCard` fonksiyonunun içerisindeki JSX tasarımı tamamen silinip `PortfolioManager.jsx` içerisindeki grid mantığıyla (grid-template-columns) yeniden inşa edilecek.
- Kartların dış kapsayıcısı dikey akıştan çıkarılıp, tek bir sütun listesi (Data Table) mantığına geçirilecek.
- Sinyaller ve Favoriler için tablonun en üstüne, verileri açıklayan bir `Table Header` (Başlık Satırı) eklenecek.

### [web/src/index.css]

#### [MODIFY] index.css
- Yatay grid tablolarının mobil cihazlarda düzgün görünebilmesi için `@media (max-width: 768px)` altında çalışacak özel CSS grid güncellemeleri yapılacak.

## Open Questions

1. Mobilden girildiğinde bu yeni barometre tarzı listenin sağa sola kaydırılabilir (yatay scroll) olmasını mı istersin yoksa mobilde otomatik olarak sütunları alt alta mı atsın? (Tavsiyem mobilde alt alta hafif sıkıştırılmış bir versiyona dönüşmesidir).
2. Tasarım onayını verdikten sonra kodlamaya başlayabilirim. Başlayalım mı?
