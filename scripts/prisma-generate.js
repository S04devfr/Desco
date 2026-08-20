const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Load .env variables
try {
  require('dotenv').config();
} catch (e) {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)$/);
      if (match) {
        process.env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
      }
    }
  }
}

const schemaPath = path.join(__dirname, '../prisma/schema.prisma');
const dbUrl = process.env.DATABASE_URL || '';
const isSqlite = dbUrl.startsWith('file:') || dbUrl.includes('.db');

const shouldPush = process.argv.includes('--push') || !process.argv.includes('--no-push');

if (isSqlite) {
  console.log('[Prisma] Local SQLite detected — temporarily swapping schema...');
  const original = fs.readFileSync(schemaPath, 'utf8');
  try {
    let patched = original;
    patched = patched.replace(/provider\s*=\s*"postgresql"/g, 'provider = "sqlite"');
    patched = patched.replace(/tags\s+String\[\]\s+@default\(\[\]\)/g, 'tags      String? @default("")');
    fs.writeFileSync(schemaPath, patched, 'utf8');
    execSync('npx prisma generate', { stdio: 'inherit' });
    if (shouldPush) {
      try {
        execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
      } catch (e) {
        console.warn('[Prisma] db push warning:', e.message);
      }
    }
  } finally {
    fs.writeFileSync(schemaPath, original, 'utf8');
    console.log('[Prisma] Restored schema.prisma to PostgreSQL.');
  }
} else {
  console.log('[Prisma] PostgreSQL detected — generating client...');
  execSync('npx prisma generate', { stdio: 'inherit' });
  if (shouldPush) {
    try {
      execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
    } catch (e) {
      console.warn('[Prisma] db push warning:', e.message);
    }
  }
}
