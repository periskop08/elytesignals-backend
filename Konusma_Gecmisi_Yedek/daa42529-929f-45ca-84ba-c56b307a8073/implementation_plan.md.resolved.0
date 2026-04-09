# Elyte Mobile App Redesign (Web Parity)

kullanıcı talebi doğrultusunda, React Native ile yapılmış mevcut mobil uygulamanın görünümünü (UX/UI detayları, menüler, renk paleti ve kart yapılarını) tamamen **telefondan açılan web sayfasıyla birebir aynı** olacak şekilde revize ediyoruz.

## User Review Required

> [!WARNING]
> Bu plan mobil uygulamanın ana iskeletini tamamen değiştirecektir. Eski sekme (Tab) yapısı kaldırılacak ve web'deki gibi 3 sekmeli yapıya geçilecek. Eğer onaylarsanız kodlamaya başlayacağım.


## Proposed Changes

Aşağıda yapılacak olan güncellemelerin adım adım açıklamaları yer almaktadır:

### Menü ve Navigasyon (AppNavigator.js)
Mobil uygulamadaki güncel 5 sekmeli yapı (Dashboard, Signals, Analysis, Stats, Favorites), web uyumlu 3 sekmeli yapıya indirgenecek:
1. **Taramalar** (Home/Signals)
2. **Favoriler** (Favorites)
3. **İstatistik** (Stats)

**Değişiklikler:**
- `AnalysisScreen` (Yapay Zeka) alt menüden **kaldırılacak** ve aynı web sitesindeki gibi tepedeki mesaja (Chat) ikonuna tıklandığında ekranı kaplayan bir Modal statüsüne (veya yeni bir Stack ekranına) geçecek.
- Her sayfanın tepesine, web'deki o şık siyah bar (`mobile-top-header`) eklenecek. Solda Elyte logosu, sağ tarafta Chat ikonu, Kullanıcı Profil Fotoğrafı ve Çıkış Yap (LogOut) ikonu olacak.

---

### Sinyal Kartları Tasarımı (HomeScreen & FavoritesScreen)
Web'deki o geniş, alt tarafı hafif siyah arka planlı ve 3 sütunlu "Giriş - Hedef - Stop" tasarımına geçilecek.

#### [MODIFY] `mobile/src/screens/HomeScreen.js`
- Sinyal kartlarının CSS (StyleSheet) yapısı, web'deki `.signal-card` ile birebir eşleştirilecek.
- Kartın içindeki "Entry, Target, Stop" etiketleri Türkçeleştirilecek ve üstlerine o küçük "(*+%X*)" gibi kar marjı oranları eklenecek.
- Kartın sol üstündeki renkli kare ikon zeminli yapı aynen React Native'e geçirilecek.

---

### Yapay Zeka Sohbet Arayüzü (AnalysisScreen / ChatModal)

#### [MODIFY] `mobile/src/screens/AnalysisScreen.js`
- Ayrı bir Tab ekranı olmak yerine, ana sayfaların sağ altındaki uçan bir tuş (FAB) veya tepedeki bir ikondan tetiklenecek şekilde ayarlanacak. 
- Görsel olarak aynen web'deki `Chat Panel` tasarımına evrilecek (Zemini `rgba(22, 35, 54, 0.8)` tonlarında, mavi-yeşil baloncularla).

---

### Favoriler & İstatistik Sayfaları Yüzey Makyajı

#### [MODIFY] `mobile/src/screens/FavoritesScreen.js`
- En üstteki "Kişisel Performans" bloklarının tasarımsal boşlukları (padding/margin değerleri) ve zemin sınırları web'le 1:1 oranlara çekilecek.

#### [MODIFY] `mobile/src/screens/StatisticsScreen.js`
- Web'de bulunan kocaman "Tahmini Cüzdan Büyümesi (PnL)" paneli, altındaki TP/SL butonları (Tıkla ve incele) mantığı birebir mobil ekrana taşınacak.

## Open Questions

> [!IMPORTANT]
> 1. AI Danışmanı / Sohbet (AnalysisScreen) kısmını eskisi gibi alttaki menüde (Tab) olarak korumak ister misiniz, yoksa web'deki gibi sağ üstteki/sohbet ikonuna basınca mı açılsın?
> 2. Dashboard adını verdiğimiz bir giriş/karşılama ekranı vardı. Web sitesinde Dashboard mantığı "Canlı Akış (Taramalar)" listesiyle birleşik durumda. Mobildeki Dashboard ekranını tamamen silebilir miyiz?

Planı inceleyip onayınızı verirseniz (veya soruları cevaplarsanız) uygulamayı ameliyata alıyorum!
