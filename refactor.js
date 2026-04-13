const fs = require('fs');
let code = fs.readFileSync('/Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/scanner.js', 'utf8');

code = code.replace(/let qualityScore = 0;/g, "let qualityScore = 0, s_struct = 0, s_trig = 0, s_vol = 0, s_trend = 0, s_pat = 0;");

// Structure
code = code.replace(/qualityScore \+= 25;\s*warnings\.push\('Order Block \(\+25\)'\);/g, "s_struct += 25;\n            warnings.push('Order Block (+25)');");
code = code.replace(/qualityScore \+= 15;\s*warnings\.push\('FVG Confirmed \(\+15\)'\);/g, "s_struct += 15;\n            warnings.push('FVG Confirmed (+15)');");
code = code.replace(/qualityScore \+= 15;\s*warnings\.push\('Smart Money Trap \(\+15 Bonus\)'\);/g, "s_struct += 15;\n                warnings.push('Smart Money Trap (+15 Bonus)');");

// Trigger
code = code.replace(/qualityScore \+= 15;\s*warnings\.push\('Bullish Engulfing \(\+15\)'\);/g, "s_trig += 15; warnings.push('Bullish Engulfing (+15)');");
code = code.replace(/qualityScore \+= 15;\s*warnings\.push\('Bearish Engulfing \(\+15\)'\);/g, "s_trig += 15; warnings.push('Bearish Engulfing (+15)');");
code = code.replace(/qualityScore \+= 15;\s*warnings\.push\('Killer Wick Bull \(\+15\)'\);/g, "s_trig += 15; warnings.push('Killer Wick Bull (+15)');");
code = code.replace(/qualityScore \+= 15;\s*warnings\.push\('Killer Wick Bear \(\+15\)'\);/g, "s_trig += 15; warnings.push('Killer Wick Bear (+15)');");

// Volume
code = code.replace(/qualityScore \+= 15;\s*warnings\.push\('High Volume Spike \(\+15\)'\);/g, "s_vol += 15;\n            warnings.push('High Volume Spike (+15)');");
code = code.replace(/qualityScore \+= 10;\s*warnings\.push\('Volume Shelter Pullback \(\+10\)'\);/g, "s_vol += 10; warnings.push('Volume Shelter Pullback (+10)');");

// Trend / Regime
code = code.replace(/qualityScore \+= 5;\s*warnings\.push\('Market Regime/g, "s_trend += 5;\n            warnings.push('Market Regime");
code = code.replace(/qualityScore \+= 15;\s*warnings\.push\('Ichimoku Bull Trend \(\+15\)'\);/g, "s_trend += 15; warnings.push('Ichimoku Bull Trend (+15)');");
code = code.replace(/qualityScore \+= 15;\s*warnings\.push\('Ichimoku Bear Trend \(\+15\)'\);/g, "s_trend += 15; warnings.push('Ichimoku Bear Trend (+15)');");

// Patterns
code = code.replace(/qualityScore \+= 10;\s*warnings\.push\('Flag\/Pennant/g, "s_pat += 10;\n                warnings.push('Flag/Pennant");
code = code.replace(/qualityScore \+= 5; \/\/ Ekstra RVOL uyum bonusu/g, "s_pat += 5; // Ekstra RVOL uyum bonusu");

// Now inject the summation before 1D check
code = code.replace(/\/\/ 5\. Günlük MA Golden Cross/g, "qualityScore += Math.min(s_struct, 30) + Math.min(s_trig, 15) + Math.min(s_vol, 15) + Math.min(s_trend, 20) + Math.min(s_pat, 15);\n\n        // 5. Günlük MA Golden Cross");

fs.writeFileSync('/Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/scanner.js', code);
console.log("Refactoring complete.");
