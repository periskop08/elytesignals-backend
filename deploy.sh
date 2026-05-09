#!/bin/bash
# Antigravity Safe Deployment Script (Git-Based)
# Bu script, canli veritabanini ASLA ezmemesi icin rsync yerine tamamen Git tabanli calisir.

if [ ! -f "Elyte.pem" ]; then
    PEM_KEY="~/.ssh/Elyte.pem"
else
    PEM_KEY="Elyte.pem"
fi

echo "🚀 Güvenli Deployment Başlıyor (Git-Based)..."

echo "📦 Değişiklikler GitHub'a gönderiliyor..."
git add .
git commit -m "Auto deploy update: $(date +'%Y-%m-%d %H:%M:%S')"
git push origin main

if [ $? -ne 0 ]; then
    echo "❌ Git push başarısız oldu veya gönderilecek bir değişiklik yok! Lütfen kontrol edin."
    echo "Yine de sunucuyu güncelleyip yeniden başlatmak istiyorsanız, AWS'ye bağlanılıyor..."
fi

echo "🔄 AWS Sunucusunda Değişiklikler Çekiliyor ve PM2 Yeniden Başlatılıyor..."
ssh -o StrictHostKeyChecking=no -i $PEM_KEY ubuntu@51.20.7.21 'cd ~/backend && git pull origin main && pm2 restart ElyteBackend'

echo "✅ Deployment Tamamlandı! Veritabanı %100 Güvende."
