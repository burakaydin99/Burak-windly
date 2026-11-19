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

## Veri kaynakları (Ayarlar → Veri kaynağı)

1. **Open-Meteo** (varsayılan): API anahtarı gerektirmez, veriler canlı gelir. Windy'nin de kullandığı GFS, ECMWF ve ICON modellerini sunar.
2. **Infoplaza**: Ayarlar'a Infoplaza Platform hesabının `api_key`'i girilir. Veriler `GET https://api.infoplaza.com/v1/weather/forecast` adresinden Infoplaza'nın Optimal modeliyle, 7 gün saatlik (`max_hourly=168`) olarak gelir. Kullanılan alanlar:
   - `windSpeed`, `windGust`: m/sn, uygulamada seçilen birime çevrilir.
   - `windBearing`: rüzgar yönü.
   - `temperature`: sıcaklık.
   - `precipIntensity`: yağış, mm/saat.
   - `cloudCover`, `humidity`: bulut ve nem.

   48 saatten uzun tahmin, her bölge ve her yenileme için 3 kredi harcar. Bu yüzden veriler 30 dakika önbellekte tutulur. “Bağlantıyı test et” düğmesi anahtarı dener. Infoplaza'dan veri alınamazsa uygulama Open-Meteo'ya geçer ve bunu üstte belirtir.

Yenile'ye basıldığında tüm kayıtlı bölgelerin 7 günlük tahmini yeniden alınır. İnternet yoksa en son çekilen veri “çevrimdışı” etiketiyle gösterilir. Kayıtlı bölgeler, ayarlar ve token tarayıcıda (localStorage) saklanır.

### Infoplaza aracı sunucusu (Cloudflare Worker)

Infoplaza API'si tarayıcıdan doğrudan çağrılmaya izin vermiyor (CORS). Bu yüzden istekler ücretsiz bir Cloudflare Worker üzerinden geçer. Kod: [`proxy/infoplaza-worker.js`](proxy/infoplaza-worker.js).

1. https://dash.cloudflare.com adresinde ücretsiz bir hesap aç.
2. **Workers & Pages → Create → Worker** yolunu izle. Adı örneğin `infoplaza-proxy` olsun, sonra **Deploy**'a bas.
3. **Edit code**'a bas, `infoplaza-worker.js` içeriğini yapıştır ve **Deploy**'a bas.
4. **Settings → Variables and Secrets → Add** yolunu izle. Tür **Secret**, ad `INFOPLAZA_KEY`, değer api_key olsun. Sonra **Deploy**'a bas.
5. Worker adresini (`https://infoplaza-proxy.<ad>.workers.dev`) uygulamada Ayarlar → Infoplaza → **Aracı sunucu adresi** alanına yapıştır. api_key alanı boş kalabilir.

Worker sadece `burakaydin99.github.io` adresinden gelen istekleri kabul eder. Aynı isteği 10 dakika önbellekte tutar, böylece aynı istek tekrar geldiğinde kredi harcanmaz.

## Yayın

Uygulama `gh-pages` dalından GitHub Pages ile yayınlanır: https://burakaydin99.github.io/Burak-windly/

## Çalıştırma

Build adımı yoktur, statik dosyalardan oluşur:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

**GitHub Pages**: Repo → Settings → Pages → Source: **GitHub Actions** seçilir. Ardından `.github/workflows/pages.yml` her push'ta siteyi yayınlar. Site telefonda açılıp “Ana ekrana ekle” yapılırsa uygulama gibi çalışır (PWA).
