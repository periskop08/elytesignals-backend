# Google Sheets - "Gün Gün Şablon" Uygulama Görevleri

- [x] Google Sheets üzerindeki eski bozuk format (`A2:Z` aralığı) API çağrısıyla sıfırlanıp "Temiz Bir Sayfa" haline getirilecek.
- [x] `backend/scanner.js` içerisinde 13 standart satır üretecek algoritmik blok inşaa edilecek.
  - Sütunlar: `[Skor Puanı, Sinyal Sayısı, TP, SL, WR, Toplam Sinyal Sayısı, Tarih, Günlük Toplam WR]`
  - Opsiyonel sütunların boş geçilmesi (Sadece başlangıç satırında bulunması) sağlanacak.
- [x] `backend/backfill-sheets.js` dosyası tamamen güncel 13 satırlı şablona göre revize edilecek ve Lokal Veri üzerinden Geçmiş Taramalar (`31 Mart...`) tekrar E-Tabloya basılacak.
- [x] Yeni `scanner.js` Amazon AWS (`13.60.44.209`) Live Sunucusuna `Rsync` protokolü ve `.ssh/Elyte.pem` anahtarıyla tekrar gönderilip eski sistemin üzerine yazılacak.
- [x] Sunucu PM2 sistemi yeniden başlatılarak gece 03:00 için yeni şablon tetiklemeye hazır tutulacak.
