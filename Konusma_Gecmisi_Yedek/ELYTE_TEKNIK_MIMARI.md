# ELYTE SIGNAL / PERISKOP AI - TAM SİSTEM MİMARİSİ VE ÇEKİRDEK KILAVUZU

Bu dosya, sistemin tamamen sıfırdan uyandırıldığında hiçbir bilgiyi kaybetmemesi ve yöneticiye (Sistem Mimarı: Periskop) projenin tüm teknik damarlarını kanıtlaması için hazırlanmıştır. 

---

## 1. TEMEL SİSTEM BİLGİLERİ VE KİMLİK
- **Marka Adı:** Elyte Signal
- **AI Motoru:** PeriskopAI
- **Mimar:** Periskop (Kurucu)
- **Güvenlik Çerçevesi:** Sistemin tüm dış operasyonları (Geleneksel borsa API'leri, Kripto İşlemleri, AWS Sunucu senkronizasyonları) kapalı devre çalışır. "rsync" gibi tehlikeli aktarım komutları Kırmızı Liste'dedir, manuel onaysız çalışmaz.

---

## 2. OTONOM AJANLAR (AGENTS) VE GÖREVLERİ

### A. Sinyal Tarayıcı Ajan (scanner.js)
**Görevi:** Kripto (BingX) ve Geleneksel Market (Hisse Senetleri/Emtia) piyasalarını tarayarak teknik formasyonlardan sinyal avlamak.
**Kullandığı API'ler:** BingX V2 API, Yahoo Finance (Proxy üzerinden).
**Teknik Motor:** 300 Mumluk geniş veri tabanında (200 EMA yönünde) çalışır. Basit Ortalama (SMA) kullanmaz.
**Sinyal Puanlama (Baraj 55 Puan):**
- *Order Block (Kurumsal Blok):* +25 Puan
- *FVG (Fiyat Boşluğu):* +15 Puan
- *Engulfing (Yutan Mum) veya Killer Wick (Katil Fitil):* +20 Puan
- *Liquidity Sweep (Stop Patlatma):* +15 Puan
- *RVOL (Göreceli Hacim Patlaması):* +15 Puan
- *İhlaller / Çatışmalar:* StochRSI aşırı şişmişse FOMO cezası uygulanır (-10 Puan).
**Sonuç:** Bir sinyalin dashboard'a düşmesi için en az **55 Puana** ulaşması zorunludur. Aksi halde sinyal reddedilir (Gölge Ajan'a düşer).

### B. Hisse Senedi Analiz ve Değerleme Ajanı (screener_engine.js)
**Görevi:** Geleneksel Amerikan borsasındaki teknoloji ve değer hisselerini temel vizyonla incelemek.
**Kullandığı API:** Gemini (`gemini-3.1-pro-preview`).
**Karar Mantığı (KTOS Kuralı):** Sadece F/K çarpanına bakmaz. FCF (Serbest Nakit Akışı), Borç/FAVÖK gibi rasyoları ölçer. Harika şirket dahi olsa "Değerleme Şişkinliği" varsa uyarır. Asla %80 gibi komik düşüş destekleri çizmez; %15-%30 arası makul "Alım Bölgeleri" belirler. Kurumsal yapısal büyüme gördüğünde klasik (RSI > 80) uyarılarını ezip +5 puan "Hak Ediş" bonusu verir.

### C. Kantan İstihbarat Ajanı (news_agent.js)
**Görevi:** Küresel finans haberlerini okuyup piyasaya etkisini milisaniyeler içinde ölçmek.
**Kullandığı API:** kantan.news API & Gemini (`gemini-3.1-pro-preview`).
**Wall Street Mantığı:** Haberleri asla düz okumaz. "Chip-to-Grid" (Çip üretiliyorsa nükleer altyapıya yarar) mantığıyla çalışır. Savunma haberlerini doğrudan XAR, PPA, LMT gibi kodlara bağlayıp, Makro-Faiz/Fed gelişmelerinin şirket hendeklerini (Moat) yok edip etmeyeceğini kurgular. Saf gereksiz haberleri doğrudan "REJECT" eder, sadece piyasa değeri taşıyanları Dashboard'daki kırmızı uyarı kısmına JSON olarak düşürür.

### D. Otopsi Ajanı (post_mortem.js)
**Görevi:** Hedefine ulaşamayan ve Stop-Loss (Zarar Kes) ile kapanan işlemleri sorguya çekmek.
**Kullandığı API:** Gemini (`gemini-3.1-pro-preview`).
**Mantık:** Biten hatalı işlemin son mum haritalarını ve indikatörlerini okur ve yapay zekaya "Nerede hata yaptık, piyasa bizi neden tuzağa düşürdü?" sorusunu sorarak sisteme kalıcı yatırım tavsiyeleri (Dersler) çıkarır.

### E. Gölge Lojistik Ajanı (shadow_tracker.js)
**Görevi:** Sinyal Tarayıcının 55 Puanı geçemediği için veya AI tarafından reddedildiği için girmediği (kıyıdan dönen) sinyalleri karanlıkta izlemek.
**Kullandığı API:** Gemini (`gemini-3.1-pro-preview`).
**Evrim Mantığı:** Eğer yapay zekanın "kötü" deyip girmediği bir sinyal hedefine ulaşıp kâr yazarsa (Win), gölge ajan bunu tespit eder ve *"Buna neden girmemiştik?"* diyerek kuralı esnetir; kuralların altına evrimsel "İstisnalar" yazarak sistemi sığ bir bottan canlı bir fona dönüştürür.

---

## 3. RİSK YÖNETİMİ, KURALLAR VE CEZALAR 

1. **Katı R:R (Risk/Ödül) Barajı:** Bir işlemde edilecek potansiyel kâr, alınacak riske göre en az 1.5 katı olmak zorundadır. Hedefi 1:1.5 vermeyen veya Stop Loss seviyesi %3.5'in üstüne sarkan her sinyal acımadan reddedilir.
2. **FOK Kalkanı (Kayma Koruması):** Yapay Zeka geçmiş analizleri düşünürken fiyat 10 saniye içinde binde 3'ten (%0.3) fazla kaçmışsa (Slippage), emir borsaya girilmez ve tamamen öldürülür. Kötü fiyattan mal alınmaz.
3. **Delta-Hedge Portföy Yığılması:** Otopilot tek bir yöne körü körüne girmez. Trend (kârda olunan lider piyasa) yönüne en fazla 5 emir, tersine (Hedge/Sigorta) en fazla 3 emir kotası tahsis edilir.
4. **Otonom Bütçe Çarpanı:** Arka arkaya 2 işlem zarar (Loss) kapatırsa, robot psikolojiyi ve parayı korumak için işlem boyutunu 0.5x'e indirir. Arka arkaya 2 işlem Win olursa momentum sürülerek risk 1.5x artırılır.
5. **Breakeven ve Admin Balyozu:** Hedefin çeyreğine gidip geri dönerek giriş seviyesine (Maliyete/Stopa) çarpan işlemler Loss (Zarar) sayılmaz, "Breakeven" (Başabaş) istatistiği olarak temizlenir. Sistemdeki kötü giden/yatay bağlayan herhangi bir işlemi yönetici "Admin Balyozu" ile anında kesebilir; hedef o anki fiyata çekilir, win-rate yalandan şişmez, ne kazanıldıysa/kaybedildiyse o yazılır.
6. **Kurumsal Mesai Kuralı:** Asya sığ piyasasındaki manipülasyonlardan ve sığ mum fitillerinden kaçmak adına Geleneksel Varlıklar ve Hisseler SADECE Türkiye Saatiyle 15:30 - 23:00 (Amerikan Seansı) arasında otonom işleme alınır.

> Bu döküman Elyte Signal'in kalbidir. Mimar geri döndüğünde, sistemin otopilot beyni bu metinden inşa edilecektir.
