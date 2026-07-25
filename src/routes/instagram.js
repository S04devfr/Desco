const express = require('express');
const router = express.Router();
const prisma = require('../config/database');

// Webhook Verification (Instagram/Wazzup needs this when subscribing)
router.get('/webhook', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Handle Wazzup verification ping
  if (!mode && !token && !challenge) {
    return res.status(200).send('OK');
  }

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

// Receive messages from Instagram / Wazzup
router.post('/webhook', async (req, res) => {
  const body = req.body;

  // Handle Wazzup Webhook Payload
  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.chatType !== 'instagram') continue; // only handle Instagram messages

      const messageId = msg.messageId;
      const text = msg.text || '';
      const isEcho = msg.isEcho || false;
      const clientIgId = msg.chatId;

      // Extract attachment if present
      let attachmentType = null;
      let attachmentUrl = null;
      if (msg.type && msg.type !== 'text') {
        attachmentType = msg.type; // image, audio, video, document, etc.
        attachmentUrl = msg.contentUri || null;
      }

      try {
        // Find or create Client
        let client = await prisma.client.findUnique({
          where: { instagramId: clientIgId }
        });

        if (!client) {
          // Use name/username from contact if provided
          let clientName = msg.contact?.name || `Instagram Lead (${clientIgId})`;
          let username = msg.contact?.username || null;

          client = await prisma.client.create({
            data: {
              name: clientName,
              instagramId: clientIgId,
              instagramUsername: username,
              notes: 'Instagram (Wazzup) orqali yangi murojaat.'
            }
          });

          // Auto-create a Deal in default pipeline
          const pipeline = await prisma.pipeline.findFirst({
            where: { isDefault: true },
            include: { stages: { orderBy: { order: 'asc' }, take: 1 } }
          });

          if (pipeline && pipeline.stages.length > 0) {
            await prisma.deal.create({
              data: {
                productName: `Instagram Lead - ${clientIgId}`,
                clientId: client.id,
                pipelineId: pipeline.id,
                stageId: pipeline.stages[0].id,
                status: 'new',
                amount: 0,
                notes: `Avtomatik yaratildi. Wazzup xabari: "${text.substring(0, 100)}"`
              }
            });
          }
        }

        // Determine sender/recipient based on isEcho
        const senderId = isEcho ? 'CRM' : clientIgId;
        const recipientId = isEcho ? clientIgId : 'CRM';

        // Save the message in database
        const savedMsg = await prisma.instagramMessage.upsert({
          where: { messageId },
          update: {
            text,
            attachmentType,
            attachmentUrl
          },
          create: {
            messageId,
            text,
            senderId,
            recipientId,
            timestamp: msg.timestamp ? new Date(msg.timestamp * 1000) : new Date(),
            isOutgoing: isEcho,
            clientId: client.id,
            attachmentType,
            attachmentUrl
          }
        });

        // Broadcast to client-side UI
        const broadcast = req.app.get('broadcast');
        if (broadcast) {
          broadcast({
            type: 'instagram_message',
            clientId: client.id,
            message: {
              ...savedMsg,
              timestamp: savedMsg.timestamp.toISOString()
            }
          });
        }
      } catch (err) {
        console.error('Error processing Wazzup message:', err);
      }
    }
    return res.status(200).send('EVENT_RECEIVED');
  }

  // Handle Meta API Webhook Payload
  if (body.object === 'instagram') {
    for (const entry of body.entry) {
      if (entry.messaging) {
        for (const webhookEvent of entry.messaging) {
          const senderId = webhookEvent.sender.id;
          const recipientId = webhookEvent.recipient.id;

          if (webhookEvent.message && (webhookEvent.message.text || webhookEvent.message.attachments)) {
            const messageId = webhookEvent.message.mid;
            const text = webhookEvent.message.text || '';
            const isEcho = webhookEvent.message.is_echo || false;

            // Determine if the message is outgoing (sent by our page) or incoming (sent by the client)
            const isOutgoing = isEcho;
            const clientIgId = isOutgoing ? recipientId : senderId;

            // Handle attachments (images, voice notes/audio, etc.)
            let attachmentType = null;
            let attachmentUrl = null;
            if (webhookEvent.message.attachments && webhookEvent.message.attachments.length > 0) {
              const attachment = webhookEvent.message.attachments[0];
              attachmentType = attachment.type; // image, audio, video, file
              if (attachment.payload && attachment.payload.url) {
                attachmentUrl = attachment.payload.url;
              }
            }

            try {
              // Try to find if client exists
              let client = await prisma.client.findUnique({
                where: { instagramId: clientIgId }
              });

              // If client exists but doesn't have instagramUsername, fetch and update it
              if (client && !client.instagramUsername) {
                const settings = await prisma.companySettings.findFirst();
                const PAGE_ACCESS_TOKEN = settings?.instagramAccessToken || process.env.META_PAGE_ACCESS_TOKEN;
                if (PAGE_ACCESS_TOKEN) {
                  try {
                    const profileRes = await fetch(`https://graph.facebook.com/v19.0/${clientIgId}?fields=username,name&access_token=${PAGE_ACCESS_TOKEN}`);
                    const profileData = await profileRes.json();
                    if (profileData && profileData.username) {
                      client = await prisma.client.update({
                        where: { id: client.id },
                        data: {
                          name: profileData.name || profileData.username,
                          instagramUsername: profileData.username
                        }
                      });
                    }
                  } catch (profileErr) {
                    console.error('Error updating instagram profile:', profileErr);
                  }
                }
              }

              // If not, create a new client
              if (!client) {
                const settings = await prisma.companySettings.findFirst();
                const PAGE_ACCESS_TOKEN = settings?.instagramAccessToken || process.env.META_PAGE_ACCESS_TOKEN;

                let username = null;
                let clientName = `Instagram Lead (${clientIgId})`;

                if (PAGE_ACCESS_TOKEN) {
                  try {
                    const profileRes = await fetch(`https://graph.facebook.com/v19.0/${clientIgId}?fields=username,name&access_token=${PAGE_ACCESS_TOKEN}`);
                    const profileData = await profileRes.json();
                    if (profileData && profileData.username) {
                      username = profileData.username;
                      clientName = profileData.name || profileData.username;
                    }
                  } catch (profileErr) {
                    console.error('Error fetching instagram profile:', profileErr);
                  }
                }

                const previewText = text ? text.substring(0, 50) : `[${attachmentType || 'Fayl'}]`;
                client = await prisma.client.create({
                  data: {
                    name: clientName,
                    instagramId: clientIgId,
                    instagramUsername: username,
                    notes: `Instagram orqali yangi murojaat. Xabar: "${previewText}..."`
                  }
                });

                // Auto-create a Deal for this new client
                const pipeline = await prisma.pipeline.findFirst({
                  where: { isDefault: true },
                  include: { stages: { orderBy: { order: 'asc' }, take: 1 } }
                });

                if (pipeline && pipeline.stages.length > 0) {
                  await prisma.deal.create({
                    data: {
                      productName: `Instagram Lead - ${clientIgId}`,
                      clientId: client.id,
                      pipelineId: pipeline.id,
                      stageId: pipeline.stages[0].id,
                      status: 'new',
                      amount: 0,
                      notes: `Avtomatik yaratildi. Instagram xabari: "${text || `[${attachmentType || 'Fayl'}]`}"`
                    }
                  });
                }
              }

              // Save the message
              const savedMsg = await prisma.instagramMessage.upsert({
                where: { messageId },
                update: {
                  text,
                  attachmentType,
                  attachmentUrl
                },
                create: {
                  messageId,
                  text,
                  senderId,
                  recipientId,
                  timestamp: new Date(webhookEvent.timestamp),
                  isOutgoing,
                  clientId: client.id,
                  attachmentType,
                  attachmentUrl
                }
              });

              // Real-time WebSocket broadcast
              const broadcast = req.app.get('broadcast');
              if (broadcast) {
                broadcast({
                  type: 'instagram_message',
                  clientId: client.id,
                  message: {
                    ...savedMsg,
                    timestamp: savedMsg.timestamp.toISOString()
                  }
                });
              }

            } catch (err) {
              console.error('Error saving instagram message:', err);
            }
          }
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.status(200).send('OK');
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
    const WAZZUP_API_KEY = process.env.WAZZUP_API_KEY;

    // 1. If Wazzup API Key is present, send via Wazzup
    if (WAZZUP_API_KEY) {
      // Save to DB first with a temp ID
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

      try {
        // Fetch the Wazzup Channel ID dynamically
        const channelRes = await fetch('https://api.wazzup24.com/v3/channels', {
          headers: {
            'Authorization': `Bearer ${WAZZUP_API_KEY}`
          }
        });
        const channels = await channelRes.json();
        
        // Find the active Instagram channel
        const igChannel = channels.find(c => c.transport === 'instagram' && c.state === 'active') || channels[0];
        
        if (!igChannel) {
          await prisma.instagramMessage.delete({ where: { id: savedMsg.id } });
          return res.status(400).json({ error: 'Faol Wazzup Instagram kanali topilmadi.' });
        }

        // Send message via Wazzup API
        const sendRes = await fetch('https://api.wazzup24.com/v3/message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${WAZZUP_API_KEY}`
          },
          body: JSON.stringify({
            channelId: igChannel.channelId,
            chatId: recipientId,
            chatType: 'instagram',
            text: text,
            crmMessageId: messageId
          })
        });

        const sendResult = await sendRes.json();
        if (sendRes.status >= 400 || (sendResult && sendResult.error)) {
          console.error('Wazzup API Error:', sendResult);
          await prisma.instagramMessage.delete({ where: { id: savedMsg.id } });
          return res.status(400).json({ error: (sendResult && sendResult.error) || 'Wazzup API Error' });
        }

        // Broadcast the message via WebSocket
        const broadcast = req.app.get('broadcast');
        if (broadcast) {
          broadcast({
            type: 'instagram_message',
            clientId: client.id,
            message: {
              ...savedMsg,
              timestamp: savedMsg.timestamp.toISOString()
            }
          });
        }

        return res.json(savedMsg);
      } catch (apiErr) {
        console.error('Failed to send via Wazzup API:', apiErr);
        await prisma.instagramMessage.delete({ where: { id: savedMsg.id } });
        return res.status(500).json({ error: apiErr.message || 'Failed to connect to Wazzup API' });
      }
    }

    // 2. Fallback to Meta API if Wazzup is not configured
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
          await prisma.instagramMessage.delete({ where: { id: savedMsg.id } });
          return res.status(400).json({ error: result.error.message || 'Meta API Error', details: result.error });
        }
      } catch (apiErr) {
        console.error('Failed to send to Meta API:', apiErr);
        await prisma.instagramMessage.delete({ where: { id: savedMsg.id } });
        return res.status(500).json({ error: apiErr.message || 'Failed to connect to Meta API' });
      }
    } else {
      await prisma.instagramMessage.delete({ where: { id: savedMsg.id } });
      return res.status(400).json({ error: 'Instagram Access Token topilmadi. Sozlamalarni tekshiring.' });
    }

    // Broadcast the message via WebSocket
    const broadcast = req.app.get('broadcast');
    if (broadcast) {
      broadcast({
        type: 'instagram_message',
        clientId: client.id,
        message: {
          ...savedMsg,
          timestamp: savedMsg.timestamp.toISOString()
        }
      });
    }

    res.json(savedMsg);
  } catch (error) {
    console.error('Error sending instagram message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
