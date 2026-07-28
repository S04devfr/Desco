const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const { protect } = require('../middleware/auth');

// GET /api/telegram/clients
router.get('/clients', protect, async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      where: { telegramId: { not: null } },
      include: {
        telegramMessages: {
          orderBy: { timestamp: 'desc' },
          take: 1
        }
      },
      orderBy: { updatedAt: 'desc' }
    });
    res.json(clients);
  } catch (error) {
    console.error('Error fetching telegram clients:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/telegram/messages/:clientId
router.get('/messages/:clientId', protect, async (req, res) => {
  try {
    const clientId = Number(req.params.clientId);
    const messages = await prisma.telegramMessage.findMany({
      where: { clientId },
      orderBy: { timestamp: 'asc' }
    });
    res.json(messages);
  } catch (error) {
    console.error('Error fetching telegram messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/telegram/messages - Send Telegram reply
router.post('/messages', protect, async (req, res) => {
  try {
    const { clientId, text, attachmentUrl, attachmentType } = req.body;
    
    const client = await prisma.client.findUnique({ where: { id: Number(clientId) } });
    if (!client || !client.telegramId) {
      return res.status(404).json({ error: 'Client or Telegram Chat ID not found' });
    }

    const recipientId = client.telegramId;
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

    // Save to DB first with a temp ID
    const messageId = `out_tg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const savedMsg = await prisma.telegramMessage.create({
      data: {
        messageId,
        text: text || null,
        senderId: 'CRM_BOT',
        recipientId,
        timestamp: new Date(),
        isOutgoing: true,
        clientId: client.id,
        attachmentType: attachmentType || null,
        attachmentUrl: attachmentUrl || null
      }
    });

    if (BOT_TOKEN) {
      try {
        let telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        let payload = {
          chat_id: recipientId,
          text: text || ''
        };

        if (attachmentUrl) {
          if (attachmentType === 'image') {
            telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
            payload = {
              chat_id: recipientId,
              photo: attachmentUrl,
              caption: text || ''
            };
          } else {
            telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`;
            payload = {
              chat_id: recipientId,
              document: attachmentUrl,
              caption: text || ''
            };
          }
        }

        const response = await fetch(telegramApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok || !result.ok) {
          console.error('[Telegram Send API Error]:', result);
        }
      } catch (apiErr) {
        console.error('Failed to send via Telegram Bot API:', apiErr);
      }
    }

    // Broadcast the message via WebSocket
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

    return res.json(savedMsg);
  } catch (error) {
    console.error('Error sending telegram message:', error);
    res.status(500).json({ error: 'Failed to send telegram message' });
  }
});

// POST /api/telegram/update-client
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

// POST /api/telegram/upload-base64
const fs = require('fs');
const path = require('path');

router.post('/upload-base64', protect, async (req, res) => {
  try {
    const { base64Data, fileName } = req.body;
    if (!base64Data) {
      return res.status(400).json({ error: 'Fayl ma\'lumotlari (base64) topilmadi' });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const uploadsDir = path.join(__dirname, '../../public/uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const ext = path.extname(fileName) || '.jpg';
    const newFileName = `tg_${Date.now()}_${Math.floor(Math.random() * 10000)}${ext}`;
    const filePath = path.join(uploadsDir, newFileName);

    fs.writeFileSync(filePath, buffer);

    const fileUrl = `${req.protocol}://${req.headers.host}/uploads/${newFileName}`;
    res.json({ fileUrl });
  } catch (error) {
    console.error('Error uploading base64 file:', error);
    res.status(500).json({ error: 'Fayl yuklashda xatolik yuz berdi' });
  }
});

module.exports = router;
