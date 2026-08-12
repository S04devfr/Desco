const express = require('express');
const router = express.Router();
const path = require('path');
const { protect, requireRole } = require('../middleware/auth');
const { createBackup, listBackups, BACKUP_DIR } = require('../services/backupService');

router.use(protect);
router.use(requireRole('admin'));

// GET /api/settings/backups
router.get('/', (req, res) => {
  const backups = listBackups();
  res.json({ backups });
});

// POST /api/settings/backups/create
router.post('/create', async (req, res) => {
  const result = await createBackup();
  if (result.success) {
    res.json({ message: 'Zahira nusxa muvaffaqiyatli yaratildi', result });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// GET /api/settings/backups/download/:filename
router.get('/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(BACKUP_DIR, filename);

  if (!filepath.startsWith(BACKUP_DIR)) {
    return res.status(400).json({ error: 'Fayl yo\'li xato' });
  }

  if (require('fs').existsSync(filepath)) {
    res.download(filepath);
  } else {
    res.status(404).json({ error: 'Zahira fayli topilmadi' });
  }
});

module.exports = router;
