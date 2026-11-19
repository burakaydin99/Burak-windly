# Rüzgar Takip

Windy / Windguru tarzı, telefona uygun bir rüzgar tahmin uygulaması.

- **Üstte kayıtlı bölgeler**: Bölgeler isimle aranarak, GPS konumundan, haritadan dokunarak ya da koordinat girilerek eklenir. Her bölgenin yanında şu anki rüzgar hızı renkli bir rozetle görünür.
- **Harita**: Kayıtlı bölgeler haritada rüzgar yönü ve hızıyla işaretlidir. Bir işarete dokununca o bölge seçilir. Seçili bölge, rüzgar pusulasıyla gösterilir. Tabloda bir saate dokununca harita o saatin rüzgarını gösterir. ⤢ düğmesi tüm bölgeleri ekrana sığdırır.
- **Model seçimi**: GFS, ECMWF ve ICON arasında geçiş yapılabilir.
- **Gün seçimi**: Açılışta yalnızca bugün gösterilir. ◀ ▶ oklarıyla 7 gün içinde önceki ve sonraki güne geçilir. Gün başlığında o günün en yüksek rüzgar ve hamle değerleri, toplam yağış ve gün doğumu/batımı yazar.
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

## Veri kaynağı

Veriler API anahtarı gerekmeden, canlı olarak [Open-Meteo](https://open-meteo.com)'dan çekilir. Open-Meteo, Windy'nin de kullandığı GFS, ECMWF ve ICON modellerini sunar. Yenile'ye basıldığında tüm kayıtlı bölgelerin 7 günlük tahmini yeniden alınır. İnternet yoksa en son çekilen veri “çevrimdışı” etiketiyle gösterilir.

Kayıtlı bölgeler ve ayarlar tarayıcıda (localStorage) saklanır.

## Çalıştırma

Build adımı yoktur, statik dosyalardan oluşur:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

**GitHub Pages**: Repo → Settings → Pages → Source: **GitHub Actions** seçilir. Ardından `.github/workflows/pages.yml` her push'ta siteyi yayınlar. Site telefonda açılıp “Ana ekrana ekle” yapılırsa uygulama gibi çalışır (PWA).
