const { ATR } = require('technicalindicators');

/**
 * Dinamik ATR tabanlı Pivot Tespit (ZigZag) ve Elliot Dalga Analiz Modülü
 */
function analyzeElliottWaves(klines, symbol) {
    if (!klines || klines.length < 50) return { status: "Yetersiz Veri" };

    const highs = klines.map(k => parseFloat(k[2]));
    const lows = klines.map(k => parseFloat(k[3]));
    const closes = klines.map(k => parseFloat(k[4]));

    // 1. ATR Hesaplama: Her coinin kendi oynaklığına göre dinamik bir sapma (deviation) belirlemek için.
    const atrRes = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const currentATR = atrRes.length > 0 ? atrRes[atrRes.length - 1] : closes[closes.length - 1] * 0.015;
    
    // ZigZag Deviation Eşiği (ATR'nin 2 katı kadar bir dönüş olursa orası bir zirve veya diptir)
    const deviationThreshold = currentATR * 2;

    // 2. Pivot Noktalarını (Zirveler ve Dipler) Bulma
    let pivots = [];
    let isLookingForHigh = true; // Yön takibi
    let extremeValue = closes[0];
    let extremeIndex = 0;

    for (let i = 0; i < closes.length; i++) {
        const h = highs[i];
        const l = lows[i];

        if (isLookingForHigh) {
            if (h > extremeValue) {
                extremeValue = h;
                extremeIndex = i;
            } else if (extremeValue - l > deviationThreshold) {
                // Fiyat tepe değerinden eşik kadar düştüyse, o tepe artık resmileşti demektir!
                pivots.push({ type: 'High', val: extremeValue, idx: extremeIndex });
                isLookingForHigh = false; // Artık dip arayışındayız
                extremeValue = l;
                extremeIndex = i;
            }
        } else {
            if (l < extremeValue) {
                extremeValue = l;
                extremeIndex = i;
            } else if (h - extremeValue > deviationThreshold) {
                // Fiyat dipten yönünü eşik kadar yukarı çevirdiyse, orası dip olmuştur!
                pivots.push({ type: 'Low', val: extremeValue, idx: extremeIndex });
                isLookingForHigh = true; // Artık yeni bir tepe arıyoruz
                extremeValue = h;
                extremeIndex = i;
            }
        }
    }

    // Son oluşmakta olan bitmemiş ekstrem noktayı da dâhil edelim
    pivots.push({ type: isLookingForHigh ? 'High' : 'Low', val: extremeValue, idx: extremeIndex });

    if (pivots.length < 5) return { status: "Geçersiz (Net Dalga Yok)" };

    // 3. Tespit Edilen Son Dalgaların Elliot Kurallarına Uyumu Analizi
    // Sadece en güncel yapıyı (Son 5 pivot = Son 4 Dalga + İçinde bulunduğumuz 5. Dalga/C dalgası) inceleyelim
    // Senaryo A: Bullish İtki Dalgası (1-2-3-4 ve oluşan bir 5)
    // Pivotlar şöyle olmalı: Low(0) -> High(1) -> Low(2) -> High(3) -> Low(4)
    
    // Son 5 pivotu alalım
    let last5 = pivots.slice(-5);
    
    // Eğer sonuncu pivot High ise bu bir Bullish uzayıştır, yani dipten tepeye (Low->High->Low->High->Low) sıralıdır (tam tersi de Bearish)
    const isBullish = last5[0].type === 'Low';
    
    if (isBullish) {
        let p0_start = last5[0].val;
        let p1_wave1_top = last5[1].val;
        let p2_wave2_bottom = last5[2].val;
        let p3_wave3_top = last5[3].val;
        let p4_wave4_bottom = last5[4].val;

        // --- KURAL 1: 2. Dalga, 1. Dalga başlangıç noktasının altına düşemez.
        if (p2_wave2_bottom <= p0_start) {
            return {
                asset: symbol,
                status: "Geçersiz Kılındı",
                reason: "Kural 1 İhlali: Dalga 2, Dalga 1'in altına sarktı.",
                current_wave: 0
            };
        }

        // --- KURAL 3: 4. Dalga, 1. Dalga'nın tepe noktasıyla örtüşemez (kesişemez).
        if (p4_wave4_bottom <= p1_wave1_top) {
            return {
                asset: symbol,
                status: "Geçersiz Kılındı",
                reason: "Kural 3 İhlali: Dalga 4, Dalga 1'in zirvesiyle kesişti.",
                current_wave: 0
            };
        }

        let w1_len = p1_wave1_top - p0_start;
        let w3_len = p3_wave3_top - p2_wave2_bottom;
        
        let invalidates_at = p1_wave1_top; // 4. dalga buralara düşmemeli

        // --- KURAL 2: 3. Dalga asla en kısa dalga olamaz!
        // Şu an fiyat p4 noktasından yukarı 5. dalgaya gidiyorsa:
        if (w3_len < w1_len) {
            // Eğere Dalga 3, Dalga 1'den kısaysa, Dalga 5 BAŞLASA BİLE Dalga 3'ten daha UZUN OLAMAZ!
            // Aksi takdirde Dalga 3 en kısa olur ve tüm kural bozulur.
            invalidates_at = p4_wave4_bottom + w3_len; 
        }

        // Fib tabanlı teorik 5. dalga hedefi (Bölge)
        let f_target_1 = p4_wave4_bottom + w1_len; // 1. dalga kadar bir 5. dalga
        let f_target_2 = p4_wave4_bottom + (w1_len * 1.618);
        
        return {
            asset: symbol,
            status: "Geçerli Bullish İtki (5. Dalga Devam Ediyor)",
            current_wave: 5,
            invalidates_at: invalidates_at,
            confluence_zone: [parseFloat(f_target_1.toFixed(4)), parseFloat(f_target_2.toFixed(4))]
        };
    } else {
        // Bearish Senaryo (Düşüş Dalgası - High(0) -> Low(1) -> High(2) -> Low(3) -> High(4))
        let p0_start = last5[0].val;
        let p1_wave1_bot = last5[1].val;
        let p2_wave2_top = last5[2].val;
        let p3_wave3_bot = last5[3].val;
        let p4_wave4_top = last5[4].val;

        if (p2_wave2_top >= p0_start) {
            return { asset: symbol, status: "Geçersiz Kılındı", reason: "Dalga 2, Dalga 1 başlangıcını aştı.", current_wave: 0 };
        }

        if (p4_wave4_top >= p1_wave1_bot) {
            return { asset: symbol, status: "Geçersiz Kılındı", reason: "Dalga 4, Dalga 1 dibiyle örtüştü.", current_wave: 0 };
        }

        let w1_len = p0_start - p1_wave1_bot;
        let w3_len = p2_wave2_top - p3_wave3_bot;
        
        let invalidates_at = p1_wave1_bot;

        if (w3_len < w1_len) {
            invalidates_at = p4_wave4_top - w3_len; 
        }
        
        let f_target_1 = p4_wave4_top - w1_len;
        let f_target_2 = p4_wave4_top - (w1_len * 1.618);

        return {
            asset: symbol,
            status: "Geçerli Bearish İtki (5. Dalga Devam Ediyor)",
            current_wave: 5,
            invalidates_at: invalidates_at,
            confluence_zone: [parseFloat(f_target_2.toFixed(4)), parseFloat(f_target_1.toFixed(4))]
        };
    }
}

module.exports = { analyzeElliottWaves };
