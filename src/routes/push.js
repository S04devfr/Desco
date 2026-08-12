const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { saveSubscription, sendPushToUser, vapidPublicKey } = require('../services/pushService');

router.use(protect);

// GET /api/push/public-key
router.get('/public-key', (req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

// POST /api/push/subscribe
router.post('/subscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Subscription endpoint is required' });
    }

    const userAgent = req.headers['user-agent'] || 'Unknown Browser';
    await saveSubscription(req.userId, subscription, userAgent);

    res.json({ success: true, message: 'Web Push bildirishnomalar faollashtirildi' });
  } catch (err) {
    console.error('Push subscription error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/push/test
router.post('/test', async (req, res) => {
  try {
    const result = await sendPushToUser(req.userId, {
      title: '🔔 Desco CRM Test Bildirishnoma',
      body: 'Tabriklaymiz! Telefoningizda Web Push bildirishnomalar muvaffaqiyatli ishlamoqda.',
      url: '/'
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
