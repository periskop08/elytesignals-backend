import re

with open('/Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/scanner.js', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace("let qualityScore = 0;", "let qualityScore = 0, s_struct = 0, s_trig = 0, s_vol = 0, s_trend = 0, s_pat = 0;")

code = code.replace("qualityScore += 25;\n            warnings.push('Order Block (+25)');", "s_struct += 25;\n            warnings.push('Order Block (+25)');")
code = code.replace("qualityScore += 15;\n            warnings.push('FVG Confirmed (+15)');", "s_struct += 15;\n            warnings.push('FVG Confirmed (+15)');")
code = code.replace("qualityScore += 15;\n                warnings.push('Smart Money Trap (+15 Bonus)');", "s_struct += 15;\n                warnings.push('Smart Money Trap (+15 Bonus)');")

code = code.replace("qualityScore += 15; warnings.push('Bullish Engulfing (+15)');", "s_trig += 15; warnings.push('Bullish Engulfing (+15)');")
code = code.replace("qualityScore += 15; warnings.push('Bearish Engulfing (+15)');", "s_trig += 15; warnings.push('Bearish Engulfing (+15)');")
code = code.replace("qualityScore += 15; warnings.push('Killer Wick Bull (+15)');", "s_trig += 15; warnings.push('Killer Wick Bull (+15)');")
code = code.replace("qualityScore += 15; warnings.push('Killer Wick Bear (+15)');", "s_trig += 15; warnings.push('Killer Wick Bear (+15)');")

code = code.replace("qualityScore += 15;\n            warnings.push('High Volume Spike (+15)');", "s_vol += 15;\n            warnings.push('High Volume Spike (+15)');")
code = code.replace("qualityScore += 10; warnings.push('Volume Shelter Pullback (+10)');", "s_vol += 10; warnings.push('Volume Shelter Pullback (+10)');")

code = code.replace("qualityScore += 5;\n            warnings.push('Market Regime", "s_trend += 5;\n            warnings.push('Market Regime")
code = code.replace("qualityScore += 15; warnings.push('Ichimoku Bull Trend (+15)');", "s_trend += 15; warnings.push('Ichimoku Bull Trend (+15)');")
code = code.replace("qualityScore += 15; warnings.push('Ichimoku Bear Trend (+15)');", "s_trend += 15; warnings.push('Ichimoku Bear Trend (+15)');")

code = code.replace("qualityScore += 10;\n                warnings.push('Flag/Pennant", "s_pat += 10;\n                warnings.push('Flag/Pennant")
code = code.replace("qualityScore += 5; // Ekstra RVOL uyum bonusu", "s_pat += 5; // Ekstra RVOL uyum bonusu")

code = code.replace("// 5. Günlük MA Golden Cross", "qualityScore += Math.min(s_struct, 30) + Math.min(s_trig, 15) + Math.min(s_vol, 15) + Math.min(s_trend, 20) + Math.min(s_pat, 15);\n\n        // 5. Günlük MA Golden Cross")

with open('/Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/scanner.js', 'w', encoding='utf-8') as f:
    f.write(code)

print("Python refactoring complete.")
