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
# amoCRM Level Deals & Tasks Upgrade Walkthrough

Ushbu loyiha doirasida Desco CRM tizimining "Сделки" (Bitimlar) va "Задачи" (Vazifalar) modullari amoCRM'ning professional funksionalligi va interfeysi darajasiga to'liq ko'tarildi. Barcha ma'lumotlar saqlandi, hech qanday ma'lumot yo'qotilmadi.

## Asosiy o'zgarishlar

### 1. "Сделки" (Bitimlar) Bo'limi va Kanban
- **Statistika Sarlavhasi (Header):** Kanban tepasida har bir bosqich bo'yicha jami sdelkalar soni va umumiy summasi (UZS) ko'rsatiladi (masalan: `782 bitim: 38,680,000 so'm`).
- **Tezkor Qo'shish (Quick Add):** Har bir kanban ustuni tagida "Tezkor sdelka qo'shish" tugmasi paydo bo'ldi. U bosilganda ustun ichida inline shaklda form ochilib, mijoz ismi, telefon raqami, mahsulot va shahar kiritilishi bilan bitim shu zaxotiyoq bosqichga qo'shiladi.
- **Kartochka Dizayni:** Kartalarda bitim nomi, yaratilgan vaqti, ID raqami, mijoz ismi va kompaniyasi, teglari (chip ko'rinishida), telefon raqami, jami summa va vazifa holati indicator (agar vazifa bo'lmasa qizil "задач нет", agar faol bo'lsa vazifa turi va muddati yashil/kulrang nuqta bilan) ko'rsatiladi.

### 2. amoCRM Split Sliding Drawer (Bitim Oynasi)
Bitim ustiga bosilganda o'ng tomondan amoCRM kabi split sliding panel chiqadi:
- **Chap panel (Ma'lumotlar):**
  - **Asosiy (Основное):** Bitim nomi (inline tahrirlash bilan), mas'ul menejer, summa, kontakt ismi, telefoni, emaili hamda kompaniya nomi, telefoni, emaili, sayti, manzili. Har bir maydon o'zgarishi bilan avtomatik tarzda bazaga saqlanadi.
  - **Teglar:** Bitim teglari chip ko'rinishida chiqadi, ularni osongina qo'shish yoki o'chirish imkoni mavjud.
  - **Statistika (Статистика):** Yaratilgan va o'zgartirilgan vaqtlar, joriy bosqichda necha kun turganligi, manbasi va ombor ma'lumotlari.
  - **Fayllar (Файлы):** Bitimga biriktirilgan fayllar ro'yxati (yuklash imkoni bilan).
  - **Progress Bar:** Tepada bosqichlar zanjiri bo'lib, unga bosish orqali bitim bosqichini o'zgartirish mumkin.
- **O'ng panel (Xronologiya / Tarix):**
  - Barcha izohlar va tizim amallari yillar/kunlar bo'yicha guruhlanib, amoCRM xronologik tartibida ko'rsatiladi.
  - Faol vazifalar alohida sariq bloklarda chiqib, vazifani bajarishda operator natijani yozishi uchun maxsus kiritish maydoni ("Natijani yozing...") va "Bajarildi" tugmasi mavjud.
  - Izoh yozish qismida yozilgan sharhlar darhol xronologiyaga sariq kartochka (note) bo'lib qo'shiladi.

### 3. "Задачи" (Vazifalar) Tizimi
- **Kun / Hafta / Oy filtri:** Filtrlar paneli Kun, Hafta, Oy tablari orqali boshqariladi va muddatlar bo'yicha vazifalarni to'g'ri saralaydi.
- **3 ta ustunli Kanban:** Kanban ko'rinishida strictly 3 ta ustun chiqadi:
  1. *Muddati o'tgan (Просроченные)*
  2. *Bugun (Сегодня)*
  3. *Ertaga (Завтра)*
- **Vazifa Kartochkalari:** Kartada vazifa turi qalin harflarda (`Связаться: check arrival`), mijoz ismi, bog'langan bitim nomi (bosganda bitimga havola/link bilan), muddati va vaqti ko'rsatiladi.
- **Drawer Integratsiyasi:** Vazifa kartasiga bosilganda operator deals sahifasiga yo'naltiriladi va o'sha bitimning sliding drawer oynasi avtomatik ravishda ochiladi.

### 4. Sozlamalar (Настройки) va Ma'lumotlarni Himoyalash
- **Drag-and-Drop Reordering:** Voronka sozlamalarida bosqichlarni sudrab olib o'tish (drag-and-drop) orqali tartibini o'zgartirish imkoniyati qo'shildi. O'zgarishlar zaxotiyoq ma'lumotlar bazasida saqlanadi.
- **Status Type mapping:** Har bir bosqich turi sozlamalarda (Standard, Won, Lost) belgilanishi mumkin. Won yoki Lost bosqichlariga o'tkazilganda bitim statuslari avtomatik tarzda to'g'ri hisoblanadi.
- **Majburiy maydonlar:** Sozlamalarda admin yangi sdelka yaratishda qaysi maydonlar majburiyligini belgilashi mumkin (Mijoz ismi, telefon, kompaniya nomi, summa). Ushbu maydonlar kiritilmaganda bitim yaratishga ruxsat berilmaydi.



---

# Tahlil / Analytics Section Upgrade Walkthrough

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

---

## 🎨 Logistika, Dizayn Tizimi va Mantiqiy Tuzatishlar (Push qilingan)

- **Logistika va Dashboard Ajratilishi:** Dashboard'dagi "Leadlar" kartasi endi faqat Asosiy Desco va boshqa sotuv leadlarini to'g'ri ko'rsatadi (1390). Logistika voronkasining buyurtmalari alohida "Zakazlar holati" vidjetiga ko'chirildi.
- **Dublikat Voronkalarni Tozalash va Oldini olish:** Baza migration jarayonida "Zakazlar Holati" voronkasi dublikat bo'lib yaratilishi bartaraf etildi (`mode: 'insensitive'` qidiruv qo'shildi) va mavjud dublikat voronkalar bitta asosiy voronkaga jamlandi.
- **Unique New Inquiries Chart Analytics:** Boshqaruv panelidagi "Murojaatlar (Yangi yozganlar)" grafik ko'rsatkichi mijozning bazadagi ro'yxatdan o'tgan sanasiga (`createdAt`) qarab hisoblanadigan bo'ldi. Bu orqali eski mijozlar faol yozishmalarining HTML statistikalaridan spamelar tozalandi.
- **Sidebar Shriftlari va Yoritilishi:** Chap tomondagi menyu navigatsiya havolalari shrift qalinligi `font-weight: 600` (active bo'limda `700`) qilinib, yuqori kontrastli `var(--text-primary)` rangiga o'tkazildi.
- **Tizim Ranglari va Kontrasti (Oq va Qora Rejimlar):** Butun loyiha bo'yicha ko'zni og'rituvchi o'ta oq chiroqlar va qorong'ilikda elementlar ko'rinmay qolish muammolari senior darajasida hal qilindi:
  - **Light Mode (Oq):** Ko'zni charchatuvchi neon gradient fonlar o'rniga sovuq tekis slate/zinc (`#F8FAFC`, `#F1F5F9`) ranglar kiritildi. Kanban ustunlari va kartalari o'zaro kontrastlandi (ustunlar `#F1F5F9` och kulrang, kartalar esa toza oq `#FFFFFF` qilinib, atrofiga nozik chegara berildi).
  - **Dark Mode (Qora):** Qop-qora elementlar yo'qotildi. Bazaviy fon `#0B0F19` (Deep Space Slate) ga o'tkazildi. Komponentlar, kartalar va modallar uchun `#131924` (surface card) hamda kanbandagi kartalar uchun biroz ochroq `#1C2434` (elevated card) rangi qo'llanib, ustunlardan yaqqol ajralishi ta'minlandi. Chegara chiziqlari yaqqol ko'rinadigan qilib yoritildi (`rgba(255,255,255,0.12)`).
- **Moliyaviy Sozlamalar va Nasiya Jadvali:** "Klientlardan Qarz" jadvali sarlavha qatorining (`thead`) orqa foni light va dark modeda shaffof bo'lmagan solid ranglarga o'rnatildi hamda sarlavha matnlari mos ravishda ustunlardagi ma'lumotlar bilan bir xilda tekislandi (chapga/o'ngga/markazga).
- **Kirish Sahifasi Ambient Animatsiyasi (Login Page Anim):** Kirish sahifasining oq fonli kartasi orqasida 4 ta bir-biriga qo'shiluvchi silliq suyuqliksimon gradient pufakchalar (fluid morphing blobs) hamda tepaga sekin suzib chiquvchi bokeh zarralari (bokeh particles) animatsiyasi qo'shildi. Bu sahifada dark mode kerak emasligi uchun u to'liq light mode fonida qotirildi va mavzuni o'zgartirish tugmasi olib tashlandi.
- **Dostavka Narxi (deliveryPrice):** `Deal` modeliga `deliveryPrice` maydoni qo'shilib, logistika voronkasida uni inline tahrirlash formasi va sdelkalar uchun 24 soatdan so'ng avtomatik arxivlash (Yetib bordi bosqichida) mantig'i kiritildi.
