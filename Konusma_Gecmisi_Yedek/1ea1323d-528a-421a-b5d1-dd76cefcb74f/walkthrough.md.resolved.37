# Günlük Kalite Skor Raporu - Telegram Otomasyonu

Backend projesi içerisinde `scanner.js` içerisindeki tarama ve fiyat takibi sistemlerine ek olarak **Gecelik Otomatik Raporlama Modülü** başarıyla entegre edilmiştir.

## Yapılan Değişiklikler

1. **`sendNightlyReport` Fonksiyonu Yazıldı:**
   - Veritabanı (`signals.db`) üzerinden bir önceki güne ait olan (`date(createdAt) = Dün`) tüm sinyaller çekildi.
   - Bu sinyaller `qualityScore` etiketlerine göre döngü içerisine sokuldu ve her skorun ne kadar kârlı olduğu (Başarılı/Stop/Açık İşlem detaylarıyla) hesaplandı.
   - Tüm işlemleri tek bir genel hesaplamadan geçirerek **Günün Win Rate'i (Kazanma Oranı)** hesaplandı.

2. **Cron Job Entegrasyonu:**
   - `node-cron` paketine parametre olarak `{ timezone: "Europe/Istanbul" }` eklendi.
   - `0 3 * * *` formatıyla Türkiye saatiyle tam **03:00'te** çalışması emredildi.
   - Bu sayede sunucunun konumu London vs neresi olursa olsun saat şaşmayacaktır.

3. **Telegram VIP Grubu Bildirimi:**
   - Markdown parse edebilen yapısıyla güzel, hizalanmış ve emojili metin blokları oluşturuldu.
   - Hazırlanan metin geceleri otomatik olarak Telegram'da `TELEGRAM_VIP_GROUP_ID` id'sine sahip kanala veya gruba fırlatılacak şekilde bağlandı.

## Nasıl Test Edildi?
- Fonksiyonu test amacıyla bir kez tetikleyerek Telegram üzerinden sana ait olan gruba/kullanıcıya ilk örnek veri **canlı olarak** atıldı. 
- Loglarda `"[SCANNER] Nightly report successfully sent to Telegram."` dönüşü teyit edilmiştir.

> [!TIP]
> **Ne Yapman Gerekiyor?**
> Sinyal uygulamasını çalıştırdığın **Backend sunucusunda** yapılan bu kod güncellemelerinin aktif olması için, sunucudaki NodeJS uygulamasını (`npm start` veya `PM2` vb. üzerinden) sadece 1 kez **Yeniden Başlatman (Restart)** gerekmektedir! Başka bir şey yapmana gerek yok.
