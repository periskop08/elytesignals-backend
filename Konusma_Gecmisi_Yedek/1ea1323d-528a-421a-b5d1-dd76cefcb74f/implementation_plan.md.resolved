# Günlük Kalite Skor Raporu Otomasyonu

Kripto piyasasında her gece saat 03:00 (TR saati) UTC kapanışıdır ve günlük mumlar kapanır. Bu noktada botun bir önceki gün ne performans gösterdiğini özetleyen, oylara (Quality Score) göre bölünmüş bir dökümü her gece otomatik alman çok profesyonel bir yaklaşım olacaktır.

## User Review Required

> [!IMPORTANT]  
> Sinyalleri Telegram üzerinden gönderdiğimiz için, bu raporu da her gece saat **03:00'te doğrudan sana (veya Telegram VIP grubuna)** bir mesaj ve `txt` dosyası olarak göndermemiz en makul ve pratik yöntemdir. Rapor, o güne ait tüm kapanan/aktif işlemleri kalite skorlarına göre ayırarak sana Telegram'dan iletilecektir. Bu yaklaşımı onaylıyor musun?

## Proposed Changes

### `backend/scanner.js`

#### [MODIFY] `scanner.js`
- **Yeni Bir Fonksiyon Eklenecek (`sendNightlyReport`)**: Bu fonksiyon `signals.db` veritabanına bağlanacak, son 24 saatin (veya günün başından o ana kadar olan) sinyallerini çekecek ve Quality Score'a göre başarı oranlarını (WIN/LOSS/ACTIVE) hesaplayacak.
- **Telegram Bot Entegrasyonu**: Hesaplanmış istatistikleri güzel bir Türkçe Markdown (.txt) dosyasına veya doğrudan Telegram mesajına çevirip `TELEGRAM_VIP_GROUP_ID` adresine gönderecek.
- **Cron Job Eklenecek**: Dosyanın en altındaki `startScanner()` fonksiyonuna yeni bir görev eklenecek: 
  `cron.schedule('0 3 * * *', () => { sendNightlyReport(); }, { timezone: "Europe/Istanbul" });`
  Bu sayede sunucu saati ne olursa olsun, **Türkiye Saati ile tam 03:00'te** raporu üretecek.

## Open Questions

> [!WARNING]  
> 1. Raporu doğrudan Telegram grubuna/botuna (sinyallerin geldiği yer) göndermemiz excel veya google drive ugrastırmadan işini çok daha kolay çözecektir, senin için uygun mudur?
> 2. Rapor mesajında kazanma yüzdesi ve kalite skorlarıyla beraber TOPLAM ne kadar Kar (Örn: +$140) yazdığını da ekleyeyim mi?

## Verification Plan

### Automated Tests
- Cron saati geçici olarak 1 dakika sonrasına ayarlanıp test edilecek (veya manuel bir test fonksiyonu çalıştırılacak).
- Telegram'a gönderilen rapor şablonunun düzgün okunup okunmadığı teyit edilecek.
- Sonrasında cron saati tekrar TR 03:00'e (Europe/Istanbul timezone) sabitlenip sunucu yeniden başlatılacak.
