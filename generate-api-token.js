const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) {
    console.error('❌ Admin user topilmadi! Iltimos, CRM tizimida kamida bitta admin yarating.');
    process.exit(1);
  }

  const payload = {
    id: admin.id,
    email: admin.email,
    fullName: admin.fullName,
    role: admin.role
  };

  const secret = process.env.JWT_SECRET || "desco-crm-jwt-secret-key-2026-very-secure";
  const token = jwt.sign(payload, secret, { expiresIn: '365d' }); // 1 yil davomida yaroqli token

  console.log('\n======================================================');
  console.log('🔑 SIZNING HAQIQIY DESCO CRM SERVICE TOKENINGIZ:');
  console.log('======================================================\n');
  console.log(token);
  console.log('\n======================================================');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
