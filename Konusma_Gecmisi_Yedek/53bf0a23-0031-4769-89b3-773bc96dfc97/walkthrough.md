# Proje Yayına Hazır: Kripto Sinyal ve Analiz Uygulaması

Projenin kurulumu ve geliştirilmesi tamamlandı. Artık projenizi çalıştırabilir ve test edebilirsiniz! 🎉

## 🛠 Neler Yapıldı?

1. **Altyapı (Backend ve Frontend):**
   - Node.js (Express) tabanlı bir API oluşturuldu: `backend/index.js`
   - React Native (Expo) tabanlı bir mobil uygulama oluşturuldu: `mobile/App.js`
   - `lucide-react-native` ve navigasyon kütüphaneleri (React Navigation) kuruldu.

2. **Backend Entegrasyonları:**
   - **Sinyal Webhook:** `POST /webhook/tradingview` - TradingView'den gelecek sinyalleri karşılar.
   - **Analiz API:** `POST /api/analysis` - "Analiz Sor" ekranından gelen istekleri (örneğin "Bitcoin" kelimesiyle) karşılayıp, uygulamanın kuralları (RSI, MA50 vb.) çerçevesinde cevaplar oluşturur.

3. **Mobil Uygulama Arayüzü (Premium Tasarım):**
   - **Sinyaller (Home) Ekranı:** Koyu (dark mode) tema, "glassmorphism" tarzında şeffaflık detayları kullanılarak tasarlandı. Aktif sinyaller bir liste halinde görüntülendi ve "İşlem Al" butonu yerleştirildi.
   - **Analiz Sor Ekranı:** Kullanıcıların altcoin ismi (veya "Bitcoin analizi ver") yazıp sorgulama yapabileceği bir arayüz kodlandı. Backend'e `http://localhost:3000/api/analysis` üzerinden iletişim kurar.

## 🚀 Nasıl Çalıştırılır ve Doğrulanır?

Projeyi çalıştırmak için iki ayrı işlem yapmalısınız:

### 1. Backend'i (Sunucuyu) Başlatın:
Yeni bir terminalde şu komutları çalıştırın:
```bash
cd /Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend
export PATH="/Users/periskop/.nvm/versions/node/v24.14.1/bin:$PATH"
node index.js
```
*Sunucu varsayılan olarak `http://localhost:3000` adresinde çalışacaktır.*

### 2. Mobil Uygulamayı (Expo) Başlatın:
Diğer bir terminalde şu komutları çalıştırarak Expo'yu başlatın:
```bash
cd /Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/mobile
export PATH="/Users/periskop/.nvm/versions/node/v24.14.1/bin:$PATH"
npx expo start
```
*Simülatör için (örn: iOS Simulator) terminalde `i` tuşuna basabilirsiniz. Gerçek cihazda denemek için Expo Go uygulamasını indirerek QR kodu okutabilirsiniz.* (Gerçek cihaz kullanıyorsanız `AnalysisScreen.js` içerisindeki `localhost` kısmını bilgisayarınızın yerel IP adresiyle değiştirmeniz gerekebilir).

### 3. Doğrulama Adımları:
- Proje açıldığında karşınıza gelen tasarımın modern ve okunaklı olduğunu görün.
- "Analiz Sor" sekmesine tıklayın veya Sinyaller listesinin altında / üstünde yönlendirme butonu var ise kullanın.
- Kutucuğa **"Bitcoin analizi ver"** yazarak klavyenizdeki/ekrandaki ara butonuna basıp cevabın geldiğini görün!
