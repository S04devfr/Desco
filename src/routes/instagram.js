const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const { protect } = require('../middleware/auth');

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
    // Senior implementation: fetch active Wazzup channels list to find target channel ID matching configured settings
    const settings = await prisma.companySettings.findFirst();
    const WAZZUP_API_KEY = process.env.WAZZUP_API_KEY || (settings?.instagramAccessToken && settings.instagramAccessToken.length === 32 ? settings.instagramAccessToken : null);
    let targetChannelId = null;
    let telegramChannelId = null;

    if (WAZZUP_API_KEY) {
      try {
        const channelRes = await fetch('https://api.wazzup24.com/v3/channels', {
          headers: {
            'Authorization': `Bearer ${WAZZUP_API_KEY}`
          }
        });
        if (channelRes.ok) {
          const channels = await channelRes.json();
          if (Array.isArray(channels)) {
            const targetPageId = settings?.instagramPageId;
            const matchedChannel = channels.find(c => c.transport === 'instagram' && c.state === 'active' && c.instId === targetPageId)
              || channels.find(c => c.transport === 'instagram' && c.state === 'active' && c.plainId === 'desco.premium')
              || channels.find(c => c.transport === 'instagram' && c.state === 'active');
            
            if (matchedChannel) {
              targetChannelId = matchedChannel.channelId;
              console.log(`[Wazzup Webhook] Resolved active Instagram channel to ${matchedChannel.plainId} (ID: ${targetChannelId})`);
            }

            const matchedTgChannel = channels.find(c => (c.transport === 'telegram' || c.transport === 'tgapi') && c.state === 'active');
            if (matchedTgChannel) {
              telegramChannelId = matchedTgChannel.channelId;
              console.log(`[Wazzup Webhook] Resolved active Telegram channel to ${matchedTgChannel.plainId} (ID: ${telegramChannelId})`);
            }
          }
        }
      } catch (err) {
        console.error('[Wazzup Webhook] Error resolving active channels:', err);
      }
    }

    for (const msg of body.messages) {
      if (msg.chatType !== 'instagram' && msg.chatType !== 'telegram' && msg.chatType !== 'instagramComment') continue;

      // Skip messages from non-configured Wazzup channel
      if ((msg.chatType === 'instagram' || msg.chatType === 'instagramComment') && targetChannelId && msg.channelId && msg.channelId !== targetChannelId) {
        console.log(`[Wazzup Webhook] Skipping Instagram message from non-target channel ${msg.channelId} (expected target channel ${targetChannelId})`);
        continue;
      }
      if (msg.chatType === 'telegram' && telegramChannelId && msg.channelId && msg.channelId !== telegramChannelId) {
        console.log(`[Wazzup Webhook] Skipping Telegram message from non-target channel ${msg.channelId} (expected target channel ${telegramChannelId})`);
        continue;
      }

      // Prefix messageId if it is a comment
      const messageId = msg.chatType === 'instagramComment' ? `comment_${msg.messageId}` : msg.messageId;
      let text = msg.text || '';
      if ((msg.chatType === 'instagram' || msg.chatType === 'instagramComment') && msg.instPost && msg.instPost.url) {
        text += `\n\n[Instagram Post: ${msg.instPost.url}]`;
      }
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
        let client = null;
        if (msg.chatType === 'instagram' || msg.chatType === 'instagramComment') {
          client = await prisma.client.findUnique({
            where: { instagramId: clientIgId }
          });

          if (!client) {
            let clientName = msg.contact?.name || `Instagram Lead (${clientIgId})`;
            let username = msg.contact?.username || null;

            if (username) {
              try {
                const existingClient = await prisma.client.findFirst({
                  where: { instagramUsername: username }
                });
                if (existingClient) {
                  client = await prisma.client.update({
                    where: { id: existingClient.id },
                    data: {
                      instagramId: clientIgId,
                      name: clientName
                    }
                  });
                  console.log(`[Wazzup Webhook] Re-mapped client ${client.name} (ID: ${client.id}) to new chatId: ${clientIgId}`);
                }
              } catch (findErr) {
                console.error('Error looking up client by username in Wazzup webhook:', findErr);
              }
            }

            if (!client) {
              try {
                client = await prisma.client.create({
                  data: {
                    name: clientName,
                    instagramId: clientIgId,
                    instagramUsername: username,
                    notes: 'Instagram (Wazzup) orqali yangi murojaat.'
                  }
                });
              } catch (createErr) {
                if (createErr.code === 'P2002') {
                  client = await prisma.client.findUnique({
                    where: { instagramId: clientIgId }
                  });
                } else {
                  throw createErr;
                }
              }
            }
          }
        } else if (msg.chatType === 'telegram') {
          client = await prisma.client.findUnique({
            where: { telegramId: clientIgId }
          });

          if (!client) {
            let clientName = msg.contact?.name || `Telegram Lead (${clientIgId})`;
            let username = msg.contact?.username || null;

            if (username) {
              try {
                const existingClient = await prisma.client.findFirst({
                  where: { telegramUsername: username }
                });
                if (existingClient) {
                  client = await prisma.client.update({
                    where: { id: existingClient.id },
                    data: {
                      telegramId: clientIgId,
                      name: clientName
                    }
                  });
                  console.log(`[Wazzup Webhook] Re-mapped client ${client.name} (ID: ${client.id}) to new Telegram chatId: ${clientIgId}`);
                }
              } catch (findErr) {
                console.error('Error looking up client by username in Wazzup webhook:', findErr);
              }
            }

            if (!client) {
              try {
                client = await prisma.client.create({
                  data: {
                    name: clientName,
                    telegramId: clientIgId,
                    telegramUsername: username,
                    notes: 'Telegram (Wazzup) orqali yangi murojaat.'
                  }
                });
              } catch (createErr) {
                if (createErr.code === 'P2002') {
                  client = await prisma.client.findUnique({
                    where: { telegramId: clientIgId }
                  });
                } else {
                  throw createErr;
                }
              }
            }
          }
        }

        // Auto-extract phone and city from incoming messages (only if they are not echo)
        if (!isEcho && text) {
          const extracted = extractClientDetails(text);
          if (extracted) {
            const clientUpdate = {};
            if (extracted.phone && !client.phone) clientUpdate.phone = extracted.phone;
            if (extracted.city && !client.city) clientUpdate.city = extracted.city;

            if (Object.keys(clientUpdate).length > 0) {
              client = await prisma.client.update({
                where: { id: client.id },
                data: clientUpdate
              });
            }
          }
        }

        // Determine sender/recipient based on isEcho
        const senderId = isEcho ? 'CRM' : clientIgId;
        const recipientId = isEcho ? clientIgId : 'CRM';

        if (msg.chatType === 'telegram') {
          // Save the message in database
          const savedMsg = await prisma.telegramMessage.upsert({
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
              type: 'telegram_message',
              clientId: client.id,
              message: {
                ...savedMsg,
                timestamp: savedMsg.timestamp.toISOString()
              }
            });
          }
        } else {
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

              // If not, fetch Meta Profile and check if client already exists by Username to prevent duplicates when switching accounts
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

                      // Check if client with this username already exists in our CRM
                      const existingClient = await prisma.client.findFirst({
                        where: { instagramUsername: username }
                      });

                      if (existingClient) {
                        client = await prisma.client.update({
                          where: { id: existingClient.id },
                          data: {
                            instagramId: clientIgId,
                            name: clientName
                          }
                        });
                        console.log(`[Instagram Webhook] Re-mapped client ${client.name} (ID: ${client.id}) to new ID: ${clientIgId}`);
                      }
                    }
                  } catch (profileErr) {
                    console.error('Error fetching instagram profile:', profileErr);
                  }
                }

                // If still no client found/mapped, create a new one
                if (!client) {
                  const previewText = text ? text.substring(0, 50) : `[${attachmentType || 'Fayl'}]`;
                  client = await prisma.client.create({
                    data: {
                      name: clientName,
                      instagramId: clientIgId,
                      instagramUsername: username,
                      notes: `Instagram orqali yangi murojaat. Xabar: "${previewText}..."`
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
router.get('/clients', protect, async (req, res) => {
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
router.get('/messages/:clientId', protect, async (req, res) => {
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
router.post('/messages', protect, async (req, res) => {
  try {
    const { clientId, text, attachmentUrl, attachmentType } = req.body;
    
    const client = await prisma.client.findUnique({ where: { id: Number(clientId) } });
    if (!client || !client.instagramId) {
      return res.status(404).json({ error: 'Client or Instagram ID not found' });
    }

    const recipientId = client.instagramId;
    const settings = await prisma.companySettings.findFirst();
    const WAZZUP_API_KEY = process.env.WAZZUP_API_KEY || (settings?.instagramAccessToken && settings.instagramAccessToken.length === 32 ? settings.instagramAccessToken : null);

    // 1. If Wazzup API Key is present, send via Wazzup
    if (WAZZUP_API_KEY) {
      // Save to DB first with a temp ID
      const messageId = `out_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const savedMsg = await prisma.instagramMessage.create({
        data: {
          messageId,
          text: text || null,
          senderId: 'CRM', // CRM sending
          recipientId,
          timestamp: new Date(),
          isOutgoing: true,
          clientId: client.id,
          attachmentType: attachmentType || null,
          attachmentUrl: attachmentUrl || null
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
        
        // Find the active Instagram channel matching the configured page ID or default name
        const targetPageId = settings?.instagramPageId;
        const igChannel = channels.find(c => c.transport === 'instagram' && c.state === 'active' && c.instId === targetPageId)
          || channels.find(c => c.transport === 'instagram' && c.state === 'active' && c.plainId === 'desco.premium')
          || channels.find(c => c.transport === 'instagram' && c.state === 'active')
          || channels[0];
        
        if (!igChannel) {
          await prisma.instagramMessage.delete({ where: { id: savedMsg.id } });
          return res.status(400).json({ error: 'Faol Wazzup Instagram kanali topilmadi.' });
        }

        // Construct correct Wazzup payload (do NOT send "type" parameter, Wazzup v3 uses contentUri to identify attachment sends)
        const wazzupPayload = {
          channelId: igChannel.channelId,
          chatId: recipientId,
          chatType: 'instagram',
          crmMessageId: messageId
        };

        if (attachmentUrl) {
          wazzupPayload.contentUri = attachmentUrl;
          if (text) wazzupPayload.text = text;
        } else {
          wazzupPayload.text = text;
        }

        // Send message via Wazzup API
        const sendRes = await fetch('https://api.wazzup24.com/v3/message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${WAZZUP_API_KEY}`
          },
          body: JSON.stringify(wazzupPayload)
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
    const PAGE_ACCESS_TOKEN = (settings?.instagramAccessToken && settings.instagramAccessToken.length > 32) ? settings.instagramAccessToken : process.env.META_PAGE_ACCESS_TOKEN;

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

// Helper: Auto-extract Phone & City from chat message text
function extractClientDetails(text) {
  if (!text) return null;
  const lowerText = text.toLowerCase();
  const updates = {};

  // 1. Phone Extraction (Uzbek format phone numbers, e.g. +998901234567, 901234567, 90 123 45 67)
  const phoneRegex = /(?:\+?998)?\s?\(?\d{2}\)?\s?\d{3}\s?\d{2}\s?\d{2}/;
  const match = text.match(phoneRegex);
  if (match) {
    let clean = match[0].replace(/[^\d]/g, '');
    if (clean.length === 9) {
      clean = '+998' + clean;
    } else if (clean.length === 12 && clean.startsWith('998')) {
      clean = '+' + clean;
    }
    if (clean.startsWith('+998') && clean.length === 13) {
      updates.phone = clean;
    }
  }

  // 2. City Extraction
  const cityMappings = [
    { keys: ['tashkent', 'toshkent'], name: 'Toshkent' },
    { keys: ['samarqand', 'samarkand'], name: 'Samarqand' },
    { keys: ['buxoro', 'bukhara'], name: 'Buxoro' },
    { keys: ['qarshi', 'karshi'], name: 'Qarshi' },
    { keys: ['namangan'], name: 'Namangan' },
    { keys: ['andijon', 'andijan'], name: 'Andijon' },
    { keys: ['farg', 'fergana'], name: 'Farg\'ona' },
    { keys: ['nukus'], name: 'Nukus' },
    { keys: ['jizzax', 'jizzakh'], name: 'Jizzax' },
    { keys: ['guliston'], name: 'Guliston' },
    { keys: ['termiz'], name: 'Termiz' },
    { keys: ['navoiy', 'navoi'], name: 'Navoiy' },
    { keys: ['urganch', 'urgench'], name: 'Urganch' },
    { keys: ['kokand', 'qo\'qon'], name: 'Qo\'qon' },
    { keys: ['chirchiq'], name: 'Chirchiq' },
    { keys: ['xiva', 'khiva'], name: 'Xiva' },
    { keys: ['marg'], name: 'Marg\'ilon' }
  ];

  for (const mapping of cityMappings) {
    if (mapping.keys.some(key => lowerText.includes(key))) {
      updates.city = mapping.name;
      break;
    }
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

const fs = require('fs');
const path = require('path');

// POST /api/instagram/upload-base64
router.post('/upload-base64', protect, async (req, res) => {
  try {
    const { base64Data, fileName, mimeType } = req.body;
    if (!base64Data) {
      return res.status(400).json({ error: 'Fayl ma\'lumotlari (base64) topilmadi' });
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Ensure public/uploads directory exists
    const uploadsDir = path.join(__dirname, '../../public/uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Generate a unique file name
    const ext = path.extname(fileName) || '.jpg';
    const newFileName = `inst_${Date.now()}_${Math.floor(Math.random() * 10000)}${ext}`;
    const filePath = path.join(uploadsDir, newFileName);

    fs.writeFileSync(filePath, buffer);

    const fileUrl = `${req.protocol}://${req.headers.host}/uploads/${newFileName}`;
    res.json({ fileUrl });
  } catch (error) {
    console.error('Error uploading base64 file:', error);
    res.status(500).json({ error: 'Fayl yuklashda xatolik yuz berdi' });
  }
});

// POST /api/instagram/update-client
router.post('/update-client', protect, async (req, res) => {
  try {
    const { clientId, name, phone, email, city, notes } = req.body;
    
    const client = await prisma.client.update({
      where: { id: Number(clientId) },
      data: {
        name,
        phone: phone || null,
        email: email || null,
        city: city || null,
        notes: notes || null
      }
    });

    res.json(client);
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: 'Mijoz ma\'lumotlarini saqlashda xatolik yuz berdi' });
  }
});

module.exports = router;
