require('dotenv').config();

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = `http://localhost:${PORT}/api/webhooks/telegram`;
const SECRET_TOKEN = process.env.TELEGRAM_WEBHOOK_SECRET || 'desco-telegram-webhook-secret-token-2026';

async function runTest(testName, payload, headers = {}, useToken = true) {
  console.log(`\n--- Test: ${testName} ---`);
  
  const reqHeaders = {
    'Content-Type': 'application/json',
    ...headers
  };
  
  if (useToken && !reqHeaders['x-telegram-bot-api-secret-token']) {
    reqHeaders['x-telegram-bot-api-secret-token'] = SECRET_TOKEN;
  }

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(payload)
    });

    const status = res.status;
    const body = await res.json();
    console.log(`Response Status: ${status}`);
    console.log(`Response Body:`, JSON.stringify(body, null, 2));
    return { status, body };
  } catch (err) {
    console.error(`Request failed: ${err.message}`);
    return { status: 500, error: err };
  }
}

async function startTests() {
  console.log("Starting Telegram Webhook integration tests with new parsing and normalization logic...");

  // 1. Test: Unauthorized request (Missing secret token)
  await runTest(
    "Missing Secret Token (Expect 401)",
    { update_id: 10001, message: { text: "Hello" } },
    {},
    false
  );

  // 2. Test: Unauthorized request (Wrong secret token)
  await runTest(
    "Invalid Secret Token (Expect 401)",
    { update_id: 10002, message: { text: "Hello" } },
    { 'x-telegram-bot-api-secret-token': 'wrong-token-value' },
    false
  );

  // 3. Test: Fallback Key-Value format
  await runTest(
    "Fallback Key-Value Parsing",
    {
      update_id: 20001,
      message: {
        message_id: 101,
        from: { id: 98765, is_bot: false, first_name: "Temur" },
        chat: { id: 98765, type: "private" },
        text: `Ism: Temur Razzoqov\nTel: +998 90 999 88 77\nMahsulot: Desco Cooler Pro`
      }
    }
  );

  // 4. Test: Yuboraman.Uz Format (Case A: Standard "+998" Phone, city is not a real city)
  const yuboramanTextA = `📄 Nomi: Universal forma | 1.04 (MuxammadAli Alisherovich Yormatov)
📝 Ma'lumotlar:
   1. Kim uchun: o'zim_uchun
   2. manzil: Нархи канча
   3. Telefon raqamingiz: 90 232 03 33
   4. ism: ezoza
   5. Phone number: +998902320333
   6. Qaysi reklamadan: lobar apa
   7. Campaign Name: rek 1 | 20.06 | Oyoq massajor (1) | CBO | ABO
ℹ️ Manba: Instagram
📅 Sana: 24-06-2026 10:53:44

✅ Telegram uchun tayyor`;

  await runTest(
    "Yuboraman.Uz Format A (Standard +998 Phone, Non-city Filtered)",
    {
      update_id: 30001,
      message: {
        message_id: 201,
        from: { id: 55501, is_bot: false, first_name: "Yuboraman Bot" },
        chat: { id: 55501, type: "private" },
        text: yuboramanTextA
      }
    }
  );

  // 5. Test: Yuboraman.Uz Format (Case B: starts with "8", City is "Toshkent")
  const yuboramanTextB = `📄 Nomi: Buyurtma formasi
📝 Ma'lumotlar:
   1. ism: Dilshod
   2. tel: 890 232 03 34
   3. shahar: Toshkent
   4. Campaign Name: target | 12.02 | Desco Cooler Mini | ABO
ℹ️ Manba: Telegram
📅 Sana: 24-06-2026 11:00:00

✅ Telegram uchun tayyor`;

  await runTest(
    "Yuboraman.Uz Format B (8-prefix Phone Normalization, Real City)",
    {
      update_id: 30002,
      message: {
        message_id: 202,
        from: { id: 55501, is_bot: false },
        chat: { id: 55501, type: "private" },
        text: yuboramanTextB
      }
    }
  );

  // 6. Test: Yuboraman.Uz Format (Case C: starts with "998" (+)less, City is "Samarqand")
  const yuboramanTextC = `📄 Nomi: Aloqa formasi
📝 Ma'lumotlar:
   1. ismingiz: Sardor Bek
   2. raqami: 998935551125
   3. manzil: Samarqand
   4. Campaign Name: rek | Desco Air Conditioner | CBO
ℹ️ Manba: Web
📅 Sana: 24-06-2026 11:15:00

✅ Telegram uchun tayyor`;

  await runTest(
    "Yuboraman.Uz Format C (998-prefix Phone Normalization, Real City)",
    {
      update_id: 30003,
      message: {
        message_id: 203,
        from: { id: 55501, is_bot: false },
        chat: { id: 55501, type: "private" },
        text: yuboramanTextC
      }
    }
  );

  // 7. Test: Yuboraman.Uz Format (Case D: 9-digits local number, no city)
  const yuboramanTextD = `📄 Nomi: Lead formasi
📝 Ma'lumotlar:
   1. name: Jamshid
   2. Phone number: 91 555 66 80
   3. Campaign Name: Campaign-102 | Desco Smart Fan | target
ℹ️ Manba: Facebook
📅 Sana: 24-06-2026 11:20:00

✅ Telegram uchun tayyor`;

  await runTest(
    "Yuboraman.Uz Format D (Local 9-digit Phone Normalization, No City)",
    {
      update_id: 30004,
      message: {
        message_id: 204,
        from: { id: 55501, is_bot: false },
        chat: { id: 55501, type: "private" },
        text: yuboramanTextD
      }
    }
  );

  // 8. Test: Yuboraman.Uz Format (Case E: starts with "+" and 10 digits local, no city)
  const yuboramanTextE = `📄 Nomi: Lead formasi
📝 Ma'lumotlar:
   1. name: Malika
   2. Phone number: +95 123 45 70
   3. Campaign Name: target | Desco Rice Cooker
ℹ️ Manba: Telegram
📅 Sana: 24-06-2026 11:25:00

✅ Telegram uchun tayyor`;

  await runTest(
    "Yuboraman.Uz Format E (+95-prefix 10-digit Phone Normalization)",
    {
      update_id: 30005,
      message: {
        message_id: 205,
        from: { id: 55501, is_bot: false },
        chat: { id: 55501, type: "private" },
        text: yuboramanTextE
      }
    }
  );

  // 9. Test: Fallback with invalid phone (Should create deal with raw/null phone, returns 200)
  await runTest(
    "Fallback with Invalid Phone",
    {
      update_id: 20002,
      message: {
        message_id: 102,
        from: { id: 98765, is_bot: false },
        chat: { id: 98765, type: "private" },
        text: `Ism: Rustam\nTel: 12345\nMahsulot: Desco Cooler Pro`
      }
    }
  );

  console.log("\nAll tests completed!");
}

startTests().catch(console.error);
