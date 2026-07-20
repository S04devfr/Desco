/**
 * Parol reset + server restart
 * Ishlatish: node reset-password.js
 */
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
require('dotenv').config()

const prisma = new PrismaClient()
const NEW_PASSWORD = 'Admin@2026'

async function main() {
  const hash = await bcrypt.hash(NEW_PASSWORD, 12)

  const result = await prisma.user.updateMany({
    where: { role: 'admin' },
    data: { password: hash }
  })

  console.log(`\n✅ ${result.count} ta admin parol yangilandi`)
  console.log(`📧 Email:  admin@desco.com`)
  console.log(`🔑 Parol:  ${NEW_PASSWORD}\n`)
  console.log(`📧 Email:  shokirovsharifjon04@gmail.com`)
  console.log(`🔑 Parol:  ${NEW_PASSWORD}\n`)
}

main()
  .catch(e => console.error('Xato:', e.message))
  .finally(() => prisma.$disconnect())
