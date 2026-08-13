const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

async function testSeedClean() {
  const seedPath = path.join(__dirname, '../prisma/seed_data.json');
  if (!fs.existsSync(seedPath)) {
    console.log('No seed_data.json found');
    return;
  }

  const backup = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const data = backup.data;

  // Inspect contactIds and companyIds in deals
  const dealsWithContact = data.deals.filter(d => d.contactId !== null && d.contactId !== undefined);
  const dealsWithCompany = data.deals.filter(d => d.companyId !== null && d.companyId !== undefined);
  console.log(`Deals with contactId: ${dealsWithContact.length}`);
  console.log(`Deals with companyId: ${dealsWithCompany.length}`);
  console.log(`Contacts count in seed: ${data.contacts ? data.contacts.length : 0}`);
  console.log(`Companies count in seed: ${data.companies ? data.companies.length : 0}`);
}

testSeedClean();
