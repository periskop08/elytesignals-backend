# Telegram Dinamik PNL Kartı Entegrasyonu

Bu plan, Otopilot'un Telegram'a attığı kuru TP/SL mesajlarını bir üst seviyeye taşıyarak, her kapanan işlem için kurumsal seviyede dinamik bir PNL resmi (Poster) çizen ve mesajın içerisine gömen mimarinin kurulumunu kapsar.

## User Review Required

> [!IMPORTANT]
> Bu güncelleme sunucuya yeni bir harici resim çizim kütüphanesi (`jimp`) kurmamızı gerektiriyor. Ayrıca `scanner.js` içerisindeki Telegram bildirim fonksiyonları köklü bir şekilde güncellenerek düz metin (text) yerine fotoğraf (photo) tabanlı API yapısına geçirilecektir. Lütfen mimari değişiklikleri onaylayın.

## Proposed Changes

### 1. Kütüphane Kurulumu & Şablonun Hazırlanması
- Sunucuya Saf JavaScript bazlı (sunucu RAM'ini yormayan) resim manipülasyon kütüphanesi olan `npm install jimp` eklenecektir.
- Az önce yapay zeka ile oluşturduğum ortası tamamen boşaltılmış olan kusursuz "Elyte Signals - Powered by PeriskopAI" arka plan görseli (`pnl_base.png`) sunucuya yüklenecek ve şablon olarak kullanılacaktır.

### 2. PNL Çizim Motoru'nun (pnl-generator.js) Yazılması
#### [NEW] [pnl-generator.js](file:///Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/pnl-generator.js)
- Bu isimde yeni bir dosya oluşturularak `generatePnlImage(symbol, side, pnl, netUsd)` fonksiyonu yazılacaktır.
- Fonksiyon, boş arka plan şablonunu alacak; PnL % değeri (Örn: +150.00% ROE), Net USDT miktarı, İşlem Yönü ve Coin sembolünü şablonun tam merkezindeki cam panelin üzerine piksel hassasiyetinde çizecektir.
- Çıktı olarak fotoğraf buffer'ı döndürecektir.

### 3. Scanner Entegrasyonu ve Telegram'a Fırlatma
#### [MODIFY] [scanner.js](file:///Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/scanner.js)
- Stop Loss veya Take Profit tetiklenip `checkActiveSignals` döngüsünde işlem kapatıldığında, `pnl-generator.js` çağrılarak PNL Kartı Buffer'ı elde edilecektir.
- Mevcut `telegramBot.sendMessage(groupId, msg)` kodu, `telegramBot.sendPhoto(groupId, imageBuffer, { caption: msg })` yapısına dönüştürülecektir.

## Open Questions
- Hazırladığım bu şablon yapısı her coin için kullanılacak, standart şık "Jimp" fontlarıyla işlenmesini arzu eder misin?

## Verification Plan
1. `jimp` kütüphanesi AWS sunucusuna kurulacak.
2. Basit bir Node scripti (`test-pnl.js`) çalıştırılarak sunucunun resmi doğru çizip çizmediği kontrol edilecek.
3. Telegram entegrasyonu tamamlandığında bizzat VIP Telegram grubuna bir adet TEST PNL kartı fırlatılacak ve birlikte incelenecektir.
