# 🏛️ Elyte Trade Algoritması ve Sinyal Mimarisi

Sistemimiz piyasadaki standart teknik indikatörlerin ötesinde; kurumsal "Order Flow (Emir Akışı)" ve "Akıllı Para Konseptlerini (SMC)" yapay zeka puanlama mimarisiyle birleştiren otonom bir fon yöneticisi (Hedge Fund) robotudur. İşte botumuzun karar alma anatomisi:

## 1️⃣ Kalkanlar (Hard Limits - Tolerans Yok!)
Bir sinyalin, hesaplanmaya dahi başlanmadan önce geçmek **zorunda** olduğu güvenlik gümrükleri:

- **Hacim Barajı (Slippage/Scam Önleyici):** Paritedeki işlem hacmi, manipülatif (Scam-wick) hareketleri engellemek için taranır. **LONG** işlemler için min **7 Milyon $**, **SHORT** işlemler için min **3 Milyon $** barajı vardır.
- **Likidite Temizliği (Sweep & Deviation):** Fiyat sadece yatayda veya rastgele bir çizgide ilerliyorsa asla işleme girilmez. Bir önceki tepe veya diplerde yer alan yatırımcıların likiditesinin (Stop-loss havuzunun) patlatıldığını teyit eden özel bir **Sweep** algoritmamız vardır.
- **Kâr Oranı Şartı (R:R < 1.0 Blokajı):** Girilecek işlemdeki hedeflenen kâr miktarı, olası zarardan (Stop-Loss) matematiksel olarak daha küçükse sistem *"Aç tavuk gibi oynamaya değmez"* diyerek hedefe ne kadar yakın olsa da işlemi iptal eder.
- **Maksimum Risk:** Kasada aynı anda en fazla 10 adet açık sinyal tutulur ve nakit riski dağıtılır.

## 2️⃣ Dinamik Trend Kontrolü (Soft Filter)
*Fiyatın genel trende uyumu sert kurallarla bloklanmak yerine, esnek "Ceza Puanı" sistemiyle tartılır.*
- **200 SMA Modülü:** 
  Eğer 200 SMA (200 Periyotluk Ortalama) **altındayken LONG** (yükseliş) tespit edilirse veya SMA'nın **üstündeyken SHORT** tespit edilirse sinyale direkt red vermek yerine **-15 CEZA PUANI** yazılır. Sinyal eğer mucizevi kalitedeyse (-15 cezaya rağmen barajı geçiyorsa) işleme onay verilir. Bu sayede harika dip dönüşü (Bottom Fishing) fırsatları kaçırılmaz.

## 3️⃣ Yapay Zeka Skorlama Motoru (Konfluent Nöral Ağ)
Bir işlemi analiz ederken her şey bir bütündür. Sinyal aşağıdaki modüllerden puan toplar:

* 🟢 **Order Block (+25 Puan):** Mumun, kurumsalların dip veya tepe noktasında bıraktığı o devasa açık emir kitlesine çarpıp milimetrik dönüş yapması. (En büyük ağırlık budur).
* 🟢 **FVG Boşlukları (+15 Puan):** Grafikte devasa hacimli mumların yarattığı "Fair Value Gap" isimli mıknatıs bölgelerinin algılanması.
* 🟢 **Yüksek Göreceli Hacim (+15 Puan):** O anki tetiklenme hacminin, son 20 mumun ortalama hacminden (Average Volume) en az %20 daha sarsıcı olması.
* 🟢 **Ichimoku Onayı (+15 Puan):** Trend bulutunun (Kumo) ve Conversion/Base çizgilerinin o anki kırılımın momentumunu Japon analiz matematiği ile teyit etmesi.
* 🟢 **Alış/Satış Baskısı Ölçer (+8 veya -8 Puan):** Mum yeşil kapatsa bile, içindeki fitil uzunluklarına göre o yeşil mumu oluşturan gücün Alıcılara (Smart Money) mı yoksa sadece panik alışlara mı ait olduğunun tespiti.
* 🔴 **Stochastic Aşırılık Cezası (-10 Puan):** Eğer LONG gireceksek ve K/D çizgileri 80'in (Zirvenin) üstündeyse "Güzel fırsat ama burası artık tepe, alım yapılamaz" diyerek puan keser.

## 4️⃣ Optimizasyon ve Kalite Barajları
*Sistemde her yöne ayrı baraj uygulanır (Asimetrik Risk Yönetimi).*
- Kriptolar aşağı daha tutarlı şelale gibi düşerken, yukarı çıkarken çok fazla tuzak yaparlar.
- Bu yüzden botun **LONG (Alım)** fırsatlarına güvenip Telegram'dan bildirim göndermesi için bir coinin yukarıdaki sınavlardan **Minimum 55 Puan** toplaması ŞARTTIR. ("Elite Sniper Modu").
- **SHORT (Düşüş)** işlemlerin kazanma oranı piyasada yüksek olduğu için kalite barajı **Minimum 40 Puan** olarak sabitlenmiştir.

## 5️⃣ Çıktı ve Karar Alma (Execution)
Gözetmen kodlardan tulum çıkaran bir varlık;
1. **Dinamik Stop Loss (ATR x 1.5):** Çılgın fitillerden korunmak için anlık ortalama volatiliteye göre stop-loss hedefini çeker.
2. **Take Profit (Likidite Noktası):** Fiyatın mıknatıs gibi çekileceği likidite EQ çizgisini hedef koyar. 
3. İşleme girer, veri tabanına `ACTIVE` olarak mühürler, Telegram kanalına tüm uyarı faktörlerini/kâr grafiğini muazzam bir bülten formatında uçurur ve Bybit/BingX'te emri piyasaya otonom sallar! 🏦🚀
