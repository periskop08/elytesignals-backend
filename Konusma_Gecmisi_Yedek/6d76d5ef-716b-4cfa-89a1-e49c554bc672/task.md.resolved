# Görev Listesi: BingX API Canlı Cüzdan Bakiyesi Entegrasyonu

- `[/]` **Muhasebe Fonksiyonu (`bingx-trade.js`)**
  - `getAccountBalance()` fonksiyonu yazılarak API üzerinden saf USDT hesap değeri döndürülecek.
- `[ ]` **Backend Endpoint (`backend/index.js`)**
  - `/api/admin/balance/:telegramId` rotası oluşturulup Admin güvenliğinden geçirilerek API isteğine cevap verilecek.
- `[ ]` **Sunucu Güncellemesi (AWS)**
  - Local dosyalar AWS sunucusuna aktarılıp PM2 ile `ElyteBackend` yeniden başlatılacak.
- `[ ]` **Arayüz - Web Paneli (`Dashboard.jsx`)**
  - "Kişisel Performans" sekmesindeki cüzdan bilgisi matematiksel modelden çıkartılıp, `axios.get('/api/admin/balance')` cevabı olan gerçek bakiyeye atanacak.
- `[ ]` **Arayüz - Mobil (`FavoritesScreen.js`)**
  - Aynı mimari `FavoritesScreen.js`'de yer alan sağ üst köşedeki veya genel widget altındaki Cüzdan bakiyesi render'ına taşınacak.
- `[ ]` **Vercel Deployment**
  - Web paneli güncellemeleri Vercel üzerinden anında prod ortama gönderilecek.
