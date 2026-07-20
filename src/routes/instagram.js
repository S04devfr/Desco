const express = require('express');
const router = express.Router();
const prisma = require('../config/database');

// Webhook Verification (Instagram needs this when subscribing)
router.get('/webhook', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const settings = await prisma.companySettings.findFirst();
  const VERIFY_TOKEN = settings?.instagramVerifyToken || process.env.INSTAGRAM_VERIFY_TOKEN || 'desco-crm-verify-token';

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

// GET /api/instagram/clients
router.get('/clients', async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      where: { instagramId: { not: null } },
      include: {
        messages: {
          orderBy: { timestamp: 'desc' },
          take: 1
        }
      },
      orderBy: { updatedAt: 'desc' }
    });
    res.json(clients);
  } catch (error) {
    console.error('Error fetching instagram clients:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/instagram/messages/:clientId
router.get('/messages/:clientId', async (req, res) => {
  try {
    const clientId = Number(req.params.clientId);
    const messages = await prisma.instagramMessage.findMany({
      where: { clientId },
      orderBy: { timestamp: 'asc' }
    });
    res.json(messages);
  } catch (error) {
    console.error('Error fetching instagram messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/instagram/messages
router.post('/messages', async (req, res) => {
  try {
    const { clientId, text } = req.body;
    
    const client = await prisma.client.findUnique({ where: { id: Number(clientId) } });
    if (!client || !client.instagramId) {
      return res.status(404).json({ error: 'Client or Instagram ID not found' });
    }

    const recipientId = client.instagramId;
    const settings = await prisma.companySettings.findFirst();
    const PAGE_ACCESS_TOKEN = settings?.instagramAccessToken || process.env.META_PAGE_ACCESS_TOKEN;

    // Save to DB first
    const messageId = `out_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const savedMsg = await prisma.instagramMessage.create({
      data: {
        messageId,
        text,
        senderId: 'CRM', // CRM sending
        recipientId,
        timestamp: new Date(),
        isOutgoing: true,
        clientId: client.id
      }
    });

    // If we have token, actually send to Meta
    if (PAGE_ACCESS_TOKEN) {
      try {
        const response = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text }
          })
        });
        const result = await response.json();
        if (result.error) {
          console.error('Meta API Error:', result.error);
        }
      } catch (apiErr) {
        console.error('Failed to send to Meta API:', apiErr);
      }
    }

    res.json(savedMsg);
  } catch (error) {
    console.error('Error sending instagram message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
