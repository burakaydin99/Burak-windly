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
  - yağış olasılığı (%)
- **Ayarlar**:
  - birim (km/s, knot, m/sn, Bft)
  - zaman adımı (1 veya 3 saat)
  - bölgeleri yeniden adlandırma, sıralama, silme

## Motor modu

Ayarlar → Motor modu bölümünden açılır:
- **Hamle▲ satırı**, o saat için tüm kaynakların en yüksek hamlesini gösterir. Kaynaklar GFS, ICON, ECMWF ve varsa Infoplaza. Hücreye dokununca her kaynağın değeri görünür. Seçili kaynaktan belirgin yüksekse hücrenin altında koyu bir çizgi olur.
- **Sürüş satırı**, her saati renkle işaretler:
  - 🟢 uygun
  - 🟡 dikkat: hamle ≥ 40 km/s, yağış ≥ 0.2 mm/saat veya sıcaklık ≤ 3 °C
  - 🔴 riskli: hamle ≥ 55 km/s veya yağış ≥ 1 mm/saat

  Hamle eşikleri Ayarlar'dan değiştirilebilir.

## Harita

Harita düğmesinden dört görünüm seçilebilir: Koyu (varsayılan), Açık, Uydu ve Sokak. Hepsi anahtarsızdır: Esri ve OpenStreetMap.

## Veri kaynakları (Ayarlar → Veri kaynağı)

1. **Open-Meteo** (varsayılan): API anahtarı gerektirmez, veriler canlı gelir. Windy'nin de kullandığı GFS, ECMWF ve ICON modellerini sunar.
2. **Infoplaza**: Infoplaza API'si tarayıcıdan doğrudan çağrılamadığı (CORS) için veriyi GitHub çeker:
   - `.github/workflows/infoplaza.yml` 3 saatte bir ve elle (**Actions → Infoplaza verisi → Run workflow**) çalışır.
   - `data/locations.json` içindeki her bölge için `https://api.infoplaza.com/v1/weather/forecast` adresinden 7 günlük saatlik tahmini (Optimal model) çeker. Sonucu `gh-pages` dalında `data/infoplaza/` klasörüne yazar.
   - Uygulama veriyi kendi sitesinden okur. Telefonda anahtar gerekmez.
   - **Gerekli ayar:** repo **Settings → Secrets and variables → Actions → New repository secret** yolunu izle. Adı `INFOPLAZA_KEY`, değeri api_key olsun.
   - Her bölge ve her çalışma 3 kredi harcar (3 saatte bir × bölge sayısı).
   - İsteğe bağlı olarak Ayarlar → Gelişmiş bölümünden kendi Cloudflare Worker'ın (`proxy/infoplaza-worker.js`) üzerinden canlı veri de alınabilir.

## Yayın

Uygulama `gh-pages` dalından GitHub Pages ile yayınlanır: https://w.burakaydin.one (Cloudflare DNS: `w` CNAME → `burakaydin99.github.io`)

## Çalıştırma

Build adımı yoktur, statik dosyalardan oluşur:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

**GitHub Pages**: Repo → Settings → Pages → Source: **GitHub Actions** seçilir. Ardından `.github/workflows/pages.yml` her push'ta siteyi yayınlar. Site telefonda açılıp “Ana ekrana ekle” yapılırsa uygulama gibi çalışır (PWA).
