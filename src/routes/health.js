const express = require('express');
const router = express.Router();
const prisma = require('../config/database');

const startTime = Date.now();

/**
 * @route GET /health
 * @desc Liveness probe - lightweight check if server process is alive
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString()
  });
});

/**
 * @route GET /ready
 * @desc Readiness probe - verifies database connection & core dependencies
 */
router.get('/ready', async (req, res) => {
  let dbStatus = 'disconnected';
  let dbLatencyMs = null;

  try {
    const start = Date.now();
    await prisma.$queryRawUnsafe('SELECT 1');
    dbLatencyMs = Date.now() - start;
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = `error: ${err.message}`;
  }

  const isHealthy = dbStatus === 'connected';
  const mem = process.memoryUsage();

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ready' : 'degraded',
    checks: {
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs
      },
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024)
      },
      process: {
        nodeVersion: process.version,
        pid: process.pid,
        uptimeSec: Math.floor(process.uptime())
      }
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
