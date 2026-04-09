# Google Sheets - "Gün Gün Şablon" Raporlama Revizyon Planı

Senin E-Tablo'ya çizdiğin şablonu çok iyi anladım. "Skor Puanı" başlığı altındaki 40'tan 100'e kadar olan 13 standart puan skalası, her gün için sabit kalacak; karşılıkları "O günkü" skor değerlerine göre (Sinyal Sayısı, TP, SL, WR) doldurulacak. Toplam veriler ve Günlük Toplam WR ile Tarih ise sadece ilk satırda (başlığın hemen altında) yer alacak ki tablo temiz görünsün!

Bunun, her gece eksiksiz olarak "Gün Gün" alt alta uzaması ve aynı zamanda eski karmaşık verilerin tablodan temizlenmesi için şu planı uygulayacağız:

## Proposed Changes

### [backend/scanner.js] Güncellenmesi
Artık `sendNightlyReport` algoritmamız, her gece dinamik olarak sana uyan 13 satırlık (40,45..100) yepyeni bir "Günlük Şablon Bloğu" oluşturacak ve Google Sheets'e tek seferde **Append (Alt Alta Ekleme)** işlemiyle yapıştıracak. 

Döngü her bir gün için şu işlemleri yapacak:
1. Puan 40 (İlk satır): `[40, sinyal, tp, sl, wr, "GÜNLÜK TOPLAM SİNYAL", "TARİH", "GÜNLÜK TOPLAM WR"]`
2. Puan 45: `[45, sinyal, tp, sl, wr, "", "", ""]` (Boş kısımlar toplam sütunlarının tekrar etmemesi için).
3. Puan 50...100 aynı şekilde devam edecek.

### Geçmiş Verileri Yenileme (Backfill Update)
Şu anda tablonun 15. satırından itibaren eski formattaki bozuk kayıtlarım var. Seni uğraştırmamak adına; sisteme ufak bir komut ateşleyerek Google E-Tablo'nun 2. satırından altını tamamen temizleyeceğim (silgiyle siler gibi). Sonrasında yeni yazdığımız bu efsane 13-satırlı şablon sistemini geçmiş günler (Bugün ve dün) dahil devreye sokup **tablonu sıfırdan ilk günkü gibi nizami bir şekilde 7 Sütun + Günlük Toplam WR sütunuyla** dolduracağım.

### Amazon (AWS) Sunucu Entegrasyonu
Yenilediğimiz `scanner.js` algoritmasını SSH üzerinden Amazon sunucuna yollayacak ve işlemi kalıcılaştıracağız. (Tüm gecelik yedekler saat 03:00'te bu formata uyumlu akacak.)

## Open Questions

> [!CAUTION]
> Tüm önceki bozuk satırları API üzerinden tam otomatik C-L-E-A-R edip, yeni efsane mimariye sahip tablo modelinle **Bugün ve Düne** ait geçmiş işlemleri tabloya tekrar sırayla basacağım, onaylıyor musun?
