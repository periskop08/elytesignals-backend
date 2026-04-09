# Elyte Signals Sistem ve Altyapı Kayıtları

Bu doküman, Antigravity ve kullanıcı arasında geçen görüşmelerden harmanlanmış sunucu, deployment (yayın) ve mimari altyapı bilgilerini içerir. Bilgisayar kapatılsa veya Antigravity yeniden başlatılsa bile sistem bu şemayı izleyerek kaldığı yerden devam edecektir.

## 🌍 Güvenlik ve Sunucu Bağlantıları
* **Sunucu Sağlayıcısı:** Amazon Web Services (AWS Ubuntu)
* **Sunucu IP Adresi:** `13.60.44.209`
* **SSH Bağlantı Anahtarı:** Konsol yetkisi `~/.ssh/Elyte.pem` key dosyası ile sağlanmaktadır. *(Bağlantı esnasında Root veya Ubuntu yetkisi kullanılır).*

## 🚀 Backend (Yapay Zeka ve Sinyal Merkezi)
* **Konum:** AWS sunucusunda `/home/ubuntu/backend` dizininde veya çalışma alanında bulunmaktadır.
* **Yayın Sistemi:** `PM2` işlem yöneticisi ile arka planda sınırsız çalışır. 
* **Uygulama Adı:** `ElyteBackend`
* **Port / API İstekleri:** Mobil uygulama ve web sitesi, verileri `http://13.60.44.209:3000/api/signals/active` ve `stats` gibi uç noktalarından (endpoint) çeker. (Gelecekte SSL veya Domain entegrasyonuyla `https` üzerine taşınması planlanabilir).
* **Reset / Restart Komutu:** `pm2 restart ElyteBackend`

## 🌐 Web Sitesi (Dashboard)
* **Altyapı:** React, Vite (veya Vercel CLI)
* **Yayın Linki:** `https://www.elytesignals.com`
* **Hosting Platformu:** Vercel 
* **Deployment Komutu:** Kod güncellemeleri Vercel CLI kullanılarak `npx vercel --prod` komutu ile canlı yayına saniyeler içinde aktarılır. Github üzerinden de sürekli entegrasyon (CI/CD) yetkileri tamamlanmıştır.

## 📱 Mobil Uygulama (React Native)
* **Framework:** React Native / Expo
* **Bileşenler:** Tab Navigation (Saydam Glassmorphism), BlurView, Flatlist ve Context API mimarisi kullanılır. 
* **Animasyonlar:** Cüzdan bakiyesi hareketlendiğinde veya sinyal durumları değiştiğinde ping ve loop animasyonları çalışır. 
* **Risk Yönetimi (Son Sürüm):** Kasa limiti sabit **$500**, işlem başına alınan risk ise **1R = $10** üzerine inşa edilmiştir.

## 💾 Kritik Notlar & Kurallar (Elyte AI)
1. Yeni sistem eklemesi yapılacağı zaman mutlaka Web <> Mobil uyumluluğuna dikkat edilecektir.
2. Tasarımda asla **düz siyah renk** kullanılmaz! Mutlaka Glassmorphism (şeffaf cam) ve arkadan vuran LinearGradient ışık küreleri eşliğinde modern Premium tema kullanılır.
3. Kripto, Varlık gibi sinyal filtresi algoritması arka planda USDT/USDC veya son ek metrajlarına göre bölümlenir.

**Durum:** Tüm bilgiler Antigravity hafızasına kalıcı (Persistent Context) olarak kazınmıştır. Bilgisayarı kapatabilirsiniz! 🔥
