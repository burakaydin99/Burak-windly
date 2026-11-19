# Rüzgar Takip

Windy / Windguru tarzı, telefona uygun bir rüzgar tahmin uygulaması.

- **Üstte kayıtlı bölgeler**: Bölgeler isimle aranarak, GPS konumundan, haritadan dokunarak ya da koordinat girilerek eklenir. Her bölgenin yanında şu anki rüzgar hızı renkli bir rozetle görünür.
- **Harita ve pusula**: Seçili bölgedeki rüzgarın yönünü ve hızını gösterir. Tabloda bir sütuna dokununca pusula o saati gösterir.
- **Model seçimi**: GFS, ECMWF ve ICON arasında geçiş yapılabilir.
- **Gün şeridi**: Her günün rüzgar dağılımı renkli bir bar olarak görünür. Bir güne dokununca tablo o güne kayar.
- **Saatlik tablo (yana kaydırmalı)**:
  - hava durumu ikonu
  - rüzgar yönü
  - **rüzgar** ve **hamle (peak)** hızı (renk skalalı)
  - **sıcaklık**
  - **yağış (mm)**
  - nem
- **Ayarlar**:
  - birim (km/s, knot, m/sn, Bft)
  - zaman adımı (1 veya 3 saat)
  - bölgeleri yeniden adlandırma, sıralama, silme
  - Windy API anahtarı

## Veri kaynağı

1. **Windy Point Forecast API**: Ayarlar'a bir anahtar girildiğinde veriler doğrudan Windy'den gelir. Anahtar https://api.windy.com/keys adresinden alınır (“Point Forecast API”). GFS bu yolla alınır. ICON için Windy'nin `iconEu` modeli kullanılır.
   Not: Windy'nin ücretsiz *trial* anahtarı bilerek karıştırılmış (gerçek olmayan) veri döndürür. Gerçek veri için ücretli anahtar gerekir.
2. **Open-Meteo**: Anahtar yoksa, Windy hata verirse veya model Windy API'de yoksa (ECMWF gibi) aynı modeller ücretsiz ve anahtarsız olarak Open-Meteo'dan çekilir.

Kayıtlı bölgeler ve ayarlar tarayıcıda (localStorage) saklanır.

## Çalıştırma

Build adımı yoktur, statik dosyalardan oluşur:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

**GitHub Pages**: Repo → Settings → Pages → Source: **GitHub Actions** seçilir. Ardından `.github/workflows/pages.yml` her push'ta siteyi yayınlar. Site telefonda açılıp “Ana ekrana ekle” yapılırsa uygulama gibi çalışır (PWA).
