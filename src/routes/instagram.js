const express = require('express');
const router = express.Router();
const prisma = require('../config/database');

const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN || 'desco-crm-verify-token';

// Webhook Verification (Instagram needs this when subscribing)
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.status(400).json({ error: 'Missing mode or token' });
  }
});

// Receive messages from Instagram
router.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'instagram') {
    for (const entry of body.entry) {
      if (entry.messaging) {
        for (const webhookEvent of entry.messaging) {
          const senderId = webhookEvent.sender.id;
          const recipientId = webhookEvent.recipient.id;

          if (webhookEvent.message && webhookEvent.message.text) {
            const text = webhookEvent.message.text;
            const messageId = webhookEvent.message.mid;
            
            try {
              // Try to find if client exists
              let client = await prisma.client.findUnique({
                where: { instagramId: senderId }
              });

              // If not, create a new client
              if (!client) {
                client = await prisma.client.create({
                  data: {
                    name: `Instagram Lead (${senderId})`,
                    instagramId: senderId,
                    notes: `Instagram orqali yangi murojaat. Xabar: "${text.substring(0, 50)}..."`
                  }
                });

                // Auto-create a Deal for this new client
                // Find the default pipeline and its first stage
                const pipeline = await prisma.pipeline.findFirst({
                  where: { isDefault: true },
                  include: { stages: { orderBy: { order: 'asc' }, take: 1 } }
                });

                if (pipeline && pipeline.stages.length > 0) {
                  await prisma.deal.create({
                    data: {
                      productName: `Instagram Lead - ${senderId}`,
                      clientId: client.id,
                      pipelineId: pipeline.id,
                      stageId: pipeline.stages[0].id,
                      status: 'new',
                      amount: 0,
                      notes: `Avtomatik yaratildi. Instagram xabari: "${text}"`
                    }
                  });
                }
              }

              // Save the message
              await prisma.instagramMessage.upsert({
                where: { messageId },
                update: {},
                create: {
                  messageId,
                  text,
                  senderId,
                  recipientId,
                  timestamp: new Date(webhookEvent.timestamp),
                  isOutgoing: false,
                  clientId: client.id
                }
              });

            } catch (err) {
              console.error('Error saving instagram message:', err);
            }
          }
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

module.exports = router;
