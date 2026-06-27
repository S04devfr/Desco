const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// Xavfsizlik Middleware: Tokenni tekshirish
const verifyWebhookToken = (req, res, next) => {
  const token = req.header('X-CRM-Webhook-Token');
  const secret = process.env.WEBHOOK_SECRET_TOKEN || 'desco-crm-secret-2026';

  if (!token || token !== secret) {
    return res.status(403).json({ error: 'Forbidden: Invalid or missing Webhook Token' });
  }
  next();
};

// POST /api/webhooks/lead
router.post('/lead', verifyWebhookToken, async (req, res, next) => {
  try {
    // Kiberxavfsizlik: ma'lumotlarni tozalash (sanitize)
    const sanitize = (str) => (str ? String(str).trim().substring(0, 500) : null);
    
    let { name, phone, region, product, forWhom, campaign, source } = req.body;

    name = sanitize(name);
    phone = sanitize(phone);
    region = sanitize(region);
    product = sanitize(product);
    forWhom = sanitize(forWhom);
    campaign = sanitize(campaign);
    source = sanitize(source);

    // Majburiy maydonlarni tekshirish
    if (!name || !phone) {
      return res.status(400).json({ error: 'Bad Request: "name" and "phone" are required fields.' });
    }

    // Telefon raqami formatini biroz tozalash (masalan probellar va tirelarni olib tashlash)
    const cleanPhone = phone.replace(/[\s-]/g, '');

    // Telefon raqami bo'yicha mijozni qidiramiz (ilike bilan)
    let { data: client } = await supabase
      .from('Client')
      .select('*')
      .ilike('phone', `%${cleanPhone}%`)
      .limit(1)
      .maybeSingle();

    // Agar roppa-rosa moslik bilan topilmasa yoki contains xato qilsa, yana bir bor to'liq phone bilan qidiramiz
    if (!client) {
      const { data: exactClient } = await supabase
        .from('Client')
        .select('*')
        .eq('phone', cleanPhone)
        .limit(1)
        .maybeSingle();
      client = exactClient;
    }

    // Mijoz topilmasa, yangisini yaratamiz
    if (!client) {
      const { data: newClient, error: clientErr } = await supabase
        .from('Client')
        .insert({
          name: name,
          phone: cleanPhone,
          companyAddress: region || null,
          notes: `Manba: ${source || 'Instagram Target / Webhook'}`
        })
        .select()
        .single();
        
      if (clientErr) throw new Error(`Client yaratishda xato: ${clientErr.message}`);
      client = newClient;
    }

    // Asosiy Voronka (isDefault = true) va uning 1-bosqichini topamiz
    const { data: pipeline } = await supabase
      .from('Pipeline')
      .select('id, PipelineStage(id, order)')
      .eq('isDefault', true)
      .limit(1)
      .maybeSingle();

    let targetStageId = null;
    let targetPipelineId = null;

    if (pipeline && pipeline.PipelineStage && pipeline.PipelineStage.length > 0) {
      targetPipelineId = pipeline.id;
      const sortedStages = pipeline.PipelineStage.sort((a, b) => a.order - b.order);
      targetStageId = sortedStages[0].id;
    } else {
      // Agar Asosiy Voronka topilmasa, istalgan birinchi voronkani olamiz
      const { data: fallbackPipeline } = await supabase
        .from('Pipeline')
        .select('id, PipelineStage(id, order)')
        .limit(1)
        .maybeSingle();
        
      if (fallbackPipeline && fallbackPipeline.PipelineStage && fallbackPipeline.PipelineStage.length > 0) {
        targetPipelineId = fallbackPipeline.id;
        const sortedStages = fallbackPipeline.PipelineStage.sort((a, b) => a.order - b.order);
        targetStageId = sortedStages[0].id;
      }
    }

    // Izohni chiroyli formatda shakllantiramiz
    const notesArray = [];
    if (forWhom) notesArray.push(`Kim uchun: ${forWhom}`);
    if (campaign) notesArray.push(`Kampaniya: ${campaign}`);
    if (source) notesArray.push(`Manba: ${source}`);
    if (region) notesArray.push(`Viloyat: ${region}`);
    const finalNotes = notesArray.length > 0 ? notesArray.join('\n') : null;

    // Sdelka yaratamiz
    const { data: deal, error: dealErr } = await supabase
      .from('Deal')
      .insert({
        productName: product || 'Instagram orqali Lead',
        amount: 0,
        status: 'new',
        clientId: client.id,
        pipelineId: targetPipelineId,
        stageId: targetStageId,
        notes: finalNotes
      })
      .select()
      .single();

    if (dealErr) throw new Error(`Deal yaratishda xato: ${dealErr.message}`);

    res.status(201).json({
      message: 'Lead muvaffaqiyatli qabul qilindi va sdelkaga aylantirildi',
      dealId: deal.id,
      clientId: client.id
    });

  } catch (error) {
    console.error('Webhook Lead Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==========================================
// TO'G'RIDAN-TO'G'RI META (FACEBOOK/INSTAGRAM) INTEGRATSIYASI
// ==========================================

// 1. Meta Webhook tasdiqlash (Verification)
router.get('/meta', (req, res) => {
  const verify_token = process.env.META_VERIFY_TOKEN;

  let mode = req.query['hub.mode'];
  let token = req.query['hub.verify_token'];
  let challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === verify_token) {
      console.log('META WEBHOOK VERIFIED!');
      res.status(200).send(challenge); // Meta faqat shu yalang'och raqamni (string) kutadi
    } else {
      res.sendStatus(403);
    }
  } else {
    res.status(400).send('Bad Request');
  }
});

// 2. Meta'dan Lead qabul qilish
router.post('/meta', async (req, res) => {
  const sanitize = (str) => (str ? String(str).trim().substring(0, 500) : null);
  
  try {
    const body = req.body;

    // Payload aynan sahifadan (page) kelganligini tekshirish
    if (body.object === 'page') {
      
      for (const entry of body.entry) {
        if (entry.changes) {
          for (const change of entry.changes) {
            
            // Faqat leadgen (forma to'ldirilgan) hodisalarini ushlash
            if (change.field === 'leadgen') {
              const leadgenId = change.value.leadgen_id;
              
              if (leadgenId) {
                // 3. Graph API ga so'rov yuborib asl ma'lumotlarni tortib olish
                const accessToken = process.env.META_ACCESS_TOKEN;
                const metaResponse = await fetch(`https://graph.facebook.com/v19.0/${leadgenId}?access_token=${accessToken}`);
                const leadData = await metaResponse.json();

                if (leadData && leadData.field_data) {
                  // Meta field_data formatini o'qish (odatda full_name va phone_number bo'ladi)
                  let rawName = '';
                  let rawPhone = '';

                  leadData.field_data.forEach(field => {
                    if (field.name === 'full_name' || field.name === 'first_name') {
                      rawName = field.values[0];
                    }
                    if (field.name === 'phone_number') {
                      rawPhone = field.values[0];
                    }
                  });

                  const name = sanitize(rawName) || 'Nomsiz Lead';
                  let phone = sanitize(rawPhone);

                  if (phone) {
                    const cleanPhone = phone.replace(/[\s-]/g, '');

                    // Baza bilan ishlash (oldingi mantiq kabi)
                    let client = await prisma.client.findFirst({
                      where: { phone: { contains: cleanPhone } }
                    });

                    if (!client) {
                      client = await prisma.client.findFirst({
                        where: { phone: cleanPhone }
                      });
                    }

                    if (!client) {
                      client = await prisma.client.create({
                        data: {
                          name: name,
                          phone: cleanPhone,
                          notes: `Manba: Instagram Lead Ads (To'g'ridan-to'g'ri Meta)`
                        }
                      });
                    }

                    // Voronkani topish
                    const pipeline = await prisma.pipeline.findFirst({
                      where: { isDefault: true },
                      include: { stages: { orderBy: { order: 'asc' }, take: 1 } }
                    });

                    let targetStageId = null;
                    let targetPipelineId = null;

                    if (pipeline && pipeline.stages.length > 0) {
                      targetPipelineId = pipeline.id;
                      targetStageId = pipeline.stages[0].id;
                    } else {
                      const fallbackPipeline = await prisma.pipeline.findFirst({
                        include: { stages: { orderBy: { order: 'asc' }, take: 1 } }
                      });
                      if (fallbackPipeline && fallbackPipeline.stages.length > 0) {
                        targetPipelineId = fallbackPipeline.id;
                        targetStageId = fallbackPipeline.stages[0].id;
                      }
                    }

                    // Sdelka yaratish
                    await prisma.deal.create({
                      data: {
                        productName: 'Instagram Meta Lead',
                        amount: 0,
                        status: 'new',
                        clientId: client.id,
                        pipelineId: targetPipelineId,
                        stageId: targetStageId,
                        notes: `Meta LeadGen ID: ${leadgenId}`
                      }
                    });
                    
                    console.log(`[Meta Webhook] Muvaffaqiyatli saqlandi: ${name} / ${cleanPhone}`);
                  }
                }
              }
            }
          }
        }
      }
      // Meta serverlari so'rov yetib kelganini bilishi uchun tezkor 200 qaytarish shart
      return res.status(200).send('EVENT_RECEIVED');
    } else {
      // Agar 'page' bo'lmasa
      return res.sendStatus(404);
    }
  } catch (error) {
    console.error('Meta Webhook Error:', error);
    res.status(500).send('ERROR');
  }
});

module.exports = router;
