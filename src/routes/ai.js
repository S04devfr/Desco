const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

router.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Xabarlar formati noto'g'ri." });
    }

    const prisma = require('../config/database');
    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    if (!DEEPSEEK_API_KEY) {
      return res.status(500).json({ error: "DeepSeek API kaliti topilmadi (.env faylida kiritilmagan)." });
    }

    // Tizim uchun yopiq kontekst (System Prompt)
    const systemMessage = {
      role: 'system',
      content: `Sen "Desco AI" san — DESCO kompaniyasining CRM tizimi ichidagi sun'iy intellekt tahlilchisisan.
Sening vazifang savdo menejerlariga bazadagi ma'lumotlarni tahlil qilib berish. 
Senda "execute_sql" nomli maxsus vosita (tool) bor. Qachonki foydalanuvchi bazaga oid tahliliy savol bersa (masalan: "Bugun nechta sdelka ochildi?", "Eng ko'p sdelkalar qaysi bosqichda?"), shu vositaga PostgreSQL SELECT so'rovini yuborib, aniq javobni olib berishing shart.
Jadvallar nomi: "Client", "Deal", "Pipeline", "PipelineStage".
Deal jadvalidagi ustunlar: id, productName, amount, status, clientId, stageId, pipelineId, createdAt, updatedAt.
Faqatgina to'g'ri o'zbek tilida va qisqa, aniq raqamlar bilan javob ber.`
    };

    const payloadMessages = [systemMessage, ...messages];

    const tools = [
      {
        type: 'function',
        function: {
          name: 'execute_sql',
          description: `CRM bazasiga faqat o'qish (SELECT) uchun SQL so'rov yuboradi. Misol: SELECT COUNT(*) FROM "Deal" WHERE DATE("createdAt") = CURRENT_DATE`,
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: "PostgreSQL SELECT so'rovi."
              }
            },
            required: ['query']
          }
        }
      }
    ];

    // 1-bosqich: AI ga so'rov yuborish
    let response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: payloadMessages,
        tools: tools,
        tool_choice: 'auto',
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('DeepSeek API Error:', errorData);
      return res.status(response.status).json({ error: "AI bilan bog'lanishda xatolik yuz berdi." });
    }

    let aiData = await response.json();
    let responseMessage = aiData.choices[0].message;

    // Agar AI SQL so'rov ishlatmoqchi bo'lsa (Function Calling)
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      payloadMessages.push(responseMessage); // AI ning tool_call so'rovini tarixga qo'shamiz
      
      for (const toolCall of responseMessage.tool_calls) {
        if (toolCall.function.name === 'execute_sql') {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            let sql = args.query.trim();
            
            // Xavfsizlik: Faqat SELECT so'rovlariga ruxsat beramiz
            if (!sql.toUpperCase().startsWith('SELECT')) {
              throw new Error("Faqat SELECT so'rovlariga ruxsat berilgan!");
            }

            console.log('AI is executing SQL:', sql);
            const dbResult = await prisma.$queryRawUnsafe(sql);
            
            // Natijani AI ga qaytaramiz
            payloadMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(dbResult, (key, value) => typeof value === 'bigint' ? value.toString() : value)
            });
            
          } catch (dbErr) {
            console.error('SQL Execution Error:', dbErr);
            payloadMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: dbErr.message })
            });
          }
        }
      }

      // 2-bosqich: SQL natijalari bilan yana DeepSeek ga so'rov yuboramiz
      response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: payloadMessages,
          temperature: 0.7
        })
      });
      aiData = await response.json();
      responseMessage = aiData.choices[0].message;
    }

    res.json({
      reply: responseMessage.content
    });

  } catch (error) {
    console.error('AI Route Error:', error);
    res.status(500).json({ error: 'Ichki server xatosi.' });
  }
});

module.exports = router;
