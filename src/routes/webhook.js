const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../config/supabase');
const leadService = require('../services/leadService');

/**
 * Meta (Facebook/Instagram) X-Hub-Signature-256 xavfsizlik imzosini tekshirish middleware.
 * Bu so'rov aynan Meta platformasidan kelayotganini kafolatlaydi.
 */
function verifyWebhookToken(req, res, next) {
  // GET so'rovi (tasdiqlash) uchun xavfsizlik tekshiruvini o'tkazib yuboramiz
  if (req.method === 'GET') return next();

  console.log(`[Signature Check] POST so'rov keldi. URL: ${req.originalUrl}`);

  const signature = req.headers['x-hub-signature-256'];
  const appSecret = process.env.APP_SECRET;

  // Agar server muhitida APP_SECRET o'rnatilmagan bo'lsa, tekshiruvni chetlab o'tamiz
  if (!appSecret) {
    console.warn('[Signature Check] APP_SECRET o\'rnatilmagan — signature tekshiruvi o\'tkazib yuborildi.');
    return next();
  }

  if (!signature) {
    console.error('[Meta Webhook Secure] Signature xabari headerlarda topilmadi.');
    return res.status(401).json({ error: 'Signature is missing.' });
  }

  try {
    const elements = signature.split('=');
    const signatureHash = elements[1];
    
    // rawBody ni crypto yordamida appSecret orqali hashlaymiz
    const expectedHash = crypto
      .createHmac('sha256', appSecret)
      .update(req.rawBody || '')
      .digest('hex');

    const sigBuffer = Buffer.from(signatureHash || '', 'hex');
    const expectedBuffer = Buffer.from(expectedHash, 'hex');

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      console.error('[Meta Webhook Secure] Signature mos kelmadi (Signature Mismatch).');
      return res.status(401).json({ error: 'Signature mismatch.' });
    }

    next();
  } catch (error) {
    console.error('[Meta Webhook Secure] Imzoni tekshirishda xatolik:', error.message);
    return res.status(500).json({ error: 'Internal signature verification error.' });
  }
}

// Xavfsizlik Middleware: Tokenni tekshirish (Make.com webhook uchun)
const verifyMakeToken = (req, res, next) => {
  const token = req.header('X-CRM-Webhook-Token');
  const secret = process.env.WEBHOOK_SECRET_TOKEN || 'desco-crm-secret-2026';

  if (!token || token !== secret) {
    return res.status(403).json({ error: 'Forbidden: Invalid or missing Webhook Token' });
  }
  next();
};

// POST /api/webhook/lead (Make/Zapier uchun)
router.post('/lead', verifyMakeToken, async (req, res, next) => {
  try {
    const sanitize = (str) => (str ? String(str).trim().substring(0, 500) : null);
    
    let { name, phone, region, product, forWhom, campaign, source } = req.body;

    name = sanitize(name);
    phone = sanitize(phone);
    region = sanitize(region);
    product = sanitize(product);
    forWhom = sanitize(forWhom);
    campaign = sanitize(campaign);
    source = sanitize(source);

    if (!name || !phone) {
      return res.status(400).json({ error: 'Bad Request: "name" and "phone" are required fields.' });
    }

    const cleanPhone = phone.replace(/[\s-]/g, '');

    let { data: client } = await supabase
      .from('Client')
      .select('*')
      .ilike('phone', `%${cleanPhone}%`)
      .limit(1)
      .maybeSingle();

    if (!client) {
      const { data: exactClient } = await supabase
        .from('Client')
        .select('*')
        .eq('phone', cleanPhone)
        .limit(1)
        .maybeSingle();
      client = exactClient;
    }

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

    const notesArray = [];
    if (forWhom) notesArray.push(`Kim uchun: ${forWhom}`);
    if (campaign) notesArray.push(`Kampaniya: ${campaign}`);
    if (source) notesArray.push(`Manba: ${source}`);
    if (region) notesArray.push(`Viloyat: ${region}`);
    const finalNotes = notesArray.length > 0 ? notesArray.join('\n') : null;

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

// 1-QADAM: Meta Webhook tasdiqlash (Verification)
router.get('/', (req, res) => {
  const verify_token = process.env.VERIFY_TOKEN || process.env.WEBHOOK_VERIFY_TOKEN || 'desco-secret-token-123';

  const mode = req.query['hub.mode'] || (req.query.hub && req.query.hub.mode);
  const token = req.query['hub.verify_token'] || (req.query.hub && req.query.hub.verify_token);
  const challenge = req.query['hub.challenge'] || (req.query.hub && req.query.hub.challenge);

  if (mode && token) {
    if (mode === 'subscribe' && token === verify_token) {
      console.log('META WEBHOOK VERIFIED!');
      res.status(200).send(challenge); // Meta faqatgina toza matn formatidagi challenge raqamini kutadi
    } else {
      res.sendStatus(403);
    }
  } else {
    res.status(400).send('Bad Request');
  }
});

// 2-QADAM: Meta'dan Lead qabul qilish (POST)
router.post('/', verifyWebhookToken, async (req, res) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`[Webhook POST] So'rov keldi! Vaqt: ${new Date().toISOString()}`);
  console.log(`[Webhook POST] Body object: ${req.body?.object}, entry soni: ${req.body?.entry?.length || 0}`);
  console.log(`[Webhook POST] Headers: content-type=${req.headers['content-type']}, x-hub-signature=${req.headers['x-hub-signature-256'] ? 'MAVJUD' : 'YO\'Q'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Meta'ga bloklanib qolmaslik uchun darhol 200 OK qaytaramiz
  res.status(200).send('EVENT_RECEIVED');

  try {
    const broadcast = req.app.get('broadcast');
    await leadService.handleMetaWebhook(req.body, broadcast);
  } catch (error) {
    console.error('[Meta Webhook Router Error] Asinxron ishga tushirishda xato:', error);
  }
});

module.exports = router;
