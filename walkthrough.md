# Tahlil / Analytics Section Upgrade Walkthrough

Ushbu loyiha doirasida Desco CRM tizimining "Tahlil" sahifasi jahon darajasidagi Stripe, HubSpot, Shopify, Salesforce va Linear loyihalaridan ilhomlangan holda to'liq yangilandi.

Barcha o'zgarishlar faqat **local** tarzda amalga oshirildi (GitHub repository'ga push qilinmadi).

## Asosiy o'zgarishlar

### 1. Boshqaruv KPI paneli (Stripe & Shopify uslubida)
KPI kartalari yangi operatsion ko'rsatkichlar bilan boyitildi:
- **Jami Savdo (Revenue):** Barcha yopilgan buyurtmalardan tushgan pul.
- **Sof Foyda (Net Profit):** Jami daromaddan mahsulot tan narxi va barcha xarajatlar ayrilgan balans.
- **Instagram Target xarajati:** "Marketing" xarajatlari va ularning samaradorligi (**CPL** - cost per lead hamda **ROI**).
- **Otkaz summasi va foizi:** Yo'qotilgan moliya va qaytish foizi.
- **Shopirdagi pullar:** Ayni paytda haydovchilar qo'lida turgan mablag' (Shopir bosqichidagi sdelkalar summasi).
- **Kutilayotgan prognoz (Salesforce Forecast):** Voronkadagi barcha ochiq sdelkalarning yutilish ehtimoli bo'yicha tortilgan qiymati.

### 2. Savdo Voronkasi (HubSpot Funnel)
- Leadlar yaratilishi, muzokaraga o'tishi va yutilishi bosqichlari bo'yicha vizual oqim va har bir bosqichdagi konversiya foizi (Conversion Rate).

### 3. Shaharlar bo'yicha Tahlil (Shopify Locations)
- Mijozlarning hududlari (`city`) bo'yicha sotuvlar hajmi va buyurtmalar soni bo'yicha reyting jadvali (progress barlar bilan).

### 4. Menejerlar KPI va Oylik Kalkulyatori (Linear Performance & Config)
- Har bir menejer bo'yicha umumiy sdelkalar, won (yopilgan) sdelkalar, Win Rate % va o'rtacha chek.
- Dinamik kalkulyator: Har bir menejer uchun dashboard ichida "Base Salary" va "Commission %" ko'rsatkichlarini qo'lda o'zgartirish imkoniyati.
- Qiymatlar o'zgarishi bilan "Yakuniy to'lov" maydoni darhol avtomatik hisoblab yangilanadi va sozlamalar **localStorage**da eslab qolinadi (baza yangilanishini talab qilmaydi).

### 5. Nasiya va Shopirlardagi Balans
- Nasiya Desco (3 oylik bo'lib to'lash), Nasiya Ishonch, Nasiya Baraka do'konlar tarmog'i va Shopirdagi pullar kesimida aylanma mablag'lar balansi va sdelkalar soni.

---

## Qanday test qilish mumkin (Localhost:3000)

1. Local dev server avtomatik ravishda `localhost:3000` portida ishga tushdi.
2. Brauzerda [http://localhost:3000/](http://localhost:3000/) havolasini oching va Tahlil bo'limini ko'ring.
3. Menejerlar KPI jadvalidagi foiz yoki oyliklarni o'zgartirib ko'ring (to'lovlar joyida hisoblanadi).
4. "Xarajatlar" bo'limida "Marketing" kategoriyasi bo'yicha xarajat qo'shib ko'ring. Tahlil bo'limida "Target xarajati" va "CPL" o'zgarishini kuzating.

---

## 📱 To'liq Telefon (Mobile) Versiyaga Moslashuv

Tizim endi mobil qurilmalarga to'liq moslashtirildi:
- **Mobile Menyular va Overlay:** Yon menyu (Sidebar) mobil qurilmalarda ekranning chap tomonidan silliq ochiladi. Orqa fonda "Overlay" qatlami paydo bo'ladi.
- **Scroll qilinuvchi Jadvallar:** Jadvallarning barchasi `table-responsive` klassi yordamida mobil ekranlarga moslandi va ular ekrandan tashqariga toshib ketmaydi.
- **Kanban Doskasi (Sdelkalar):** Kanban ustunlari telefon kengligining `85vw` qismini egallab, o'ngga-chapga surish orqali boshqariladigan holatga keltirildi.
- **Modallar va Oynalar:** Qo'shish va tahrirlash oynalari ekran kengligiga to'liq moslashib, ortiqcha scroll muammolari bartaraf etildi.
- **Tahlil Sahifasi:** Barcha grafiklar, kartalar va diagrammalar kichik ekranlarda ketma-ket bir-birining tagida chiroyli chiqadigan qilib sozlandi.
