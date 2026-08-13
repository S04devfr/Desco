require('dotenv').config();
const prisma = require('../src/config/database');

const rawData = [
  { region: 'Surxondaryo', phone: '94 867 43 43', feeStr: '150000' },
  { region: 'Andijon', phone: '93 772 10 65', feeStr: '—' },
  { region: 'Farg‘ona', phone: '90 566 29 75', feeStr: '—' },
  { region: 'Navoiy Shahar', phone: '99-234-00-01', feeStr: '150000' },
  { region: 'Qo‘qon', phone: '90 855 55 56', feeStr: '0' },
  { region: 'Toshkent', phone: '95 172 33 77', feeStr: '0' },
  { region: 'Toshkent', phone: '90 000 01 67', feeStr: '50000' },
  { region: 'Qo‘qon', phone: '90 361 61 11', feeStr: '0' },
  { region: 'Buxoro', phone: '94-679-13-19', feeStr: '170000' },
  { region: 'Toshkent', phone: '50-250-53-03', feeStr: '50000' },
  { region: 'Samarqand', phone: '92-056-54-63', feeStr: '120000' },
  { region: 'Toshkent', phone: '99-993-47-22', feeStr: '100000' },
  { region: 'Toshkent', phone: '+99891-208-57-67', feeStr: '50000' },
  { region: 'Toshkent', phone: '+99897752-25-99', feeStr: '70000' },
  { region: 'Samarqand', phone: '+99894-044-82-80', feeStr: '130000' },
  { region: 'Toshkent', phone: '+99833-433-13-43', feeStr: '—' },
  { region: 'Samarqand', phone: '+99893-102-10-56', feeStr: '120000' },
  { region: 'Toshkent', phone: '+99890 588-13-50', feeStr: '—' },
  { region: 'Toshkent', phone: '+99877-978-29-39', feeStr: '60000' },
  { region: 'Buxoro', phone: '+99899-909-48-88', feeStr: '180000' },
  { region: 'Toshkent', phone: '94-648-26-36', feeStr: '50000' },
  { region: 'Toshkent', phone: '90-974-34-36', feeStr: '40000' },
  { region: 'Toshkent', phone: '93-766-61-64', feeStr: '—' },
  { region: 'Samarqand', phone: '97-958-70-07', feeStr: '130000' },
  { region: 'Jizzax', phone: '93-391-23-24', feeStr: '150000' },
  { region: 'Toshkent', phone: '99-812-60-02', feeStr: '55000' },
  { region: 'Toshkent', phone: '97-700-85-94', feeStr: '35000' },
  { region: 'Qashqadaryo', phone: '88-325-20-92', feeStr: '170000' },
  { region: 'Toshkent', phone: '99-030-08-12', feeStr: '0' },
  { region: 'Jizzax', phone: '95-961-95-55', feeStr: '150000' },
  { region: 'Samarqand', phone: '94-008-20-48', feeStr: '100000' },
  { region: 'Toshkent', phone: '95-182-87-71', feeStr: '—' },
  { region: 'Surxondaryo', phone: '94-208-84-94', feeStr: '140000' },
  { region: 'Surxondaryo', phone: '94-698-95-97', feeStr: '150000' },
  { region: 'Qashqadaryo', phone: '88-410-09-02', feeStr: '130000' },
  { region: 'Andijon', phone: '97-995-72-77', feeStr: '—' },
  { region: 'Toshkent', phone: '93-518-27-77', feeStr: '—' }
];

function cleanDigits(p) {
  if (!p) return '';
  let digits = String(p).replace(/\D/g, '');
  if (digits.startsWith('998') && digits.length === 12) {
    digits = digits.slice(3);
  }
  return digits;
}

async function main() {
  console.log(`Loading all clients and deals...`);
  
  const allClients = await prisma.client.findMany({ select: { id: true, phone: true, city: true } });
  const allDeals = await prisma.deal.findMany({ select: { id: true, productName: true, clientId: true, driverPhone: true, deliveryPrice: true } });
  const existingExpenses = await prisma.expense.findMany({ where: { category: 'transport' } });

  console.log(`Loaded ${allClients.length} clients, ${allDeals.length} deals, and ${existingExpenses.length} transport expenses.`);

  const clientMap = new Map();
  allClients.forEach(c => {
    const d = cleanDigits(c.phone);
    if (d) {
      if (!clientMap.has(d)) clientMap.set(d, []);
      clientMap.get(d).push(c);
    }
  });

  let matchedNumbersCount = 0;
  let updatedDealsCount = 0;
  let expensesAddedCount = 0;
  let totalTransportExpensesSum = 0;

  const dbOps = [];

  for (const item of rawData) {
    const digits = cleanDigits(item.phone);
    const amount = (item.feeStr === '—' || item.feeStr === '-' || !item.feeStr) ? 0 : Number(item.feeStr) || 0;

    const matchedClients = clientMap.get(digits) || [];
    const clientIds = new Set(matchedClients.map(c => c.id));

    const matchedDeals = allDeals.filter(d => 
      (d.clientId && clientIds.has(d.clientId)) ||
      (d.driverPhone && cleanDigits(d.driverPhone) === digits)
    );

    if (matchedDeals.length > 0) {
      matchedNumbersCount++;
      for (const deal of matchedDeals) {
        dbOps.push(prisma.deal.update({ where: { id: deal.id }, data: { deliveryPrice: amount } }));
        updatedDealsCount++;

        if (deal.clientId) {
          const cl = matchedClients.find(c => c.id === deal.clientId);
          if (cl && !cl.city) {
            dbOps.push(prisma.client.update({ where: { id: cl.id }, data: { city: item.region } }));
          }
        }

        if (amount > 0) {
          const desc = `Shofyor yo'l kirdi puli (${item.region}) - Sdelka #${deal.id} (${deal.productName || 'Zakaz'}) - Tel: +998${digits}`;
          const existing = existingExpenses.find(e => e.description.includes(`Sdelka #${deal.id}`));

          if (existing) {
            dbOps.push(prisma.expense.update({ where: { id: existing.id }, data: { amount, description: desc } }));
          } else {
            dbOps.push(prisma.expense.create({ data: { description: desc, amount, category: 'transport', date: new Date() } }));
            expensesAddedCount++;
          }
          totalTransportExpensesSum += amount;
        }
      }
    } else {
      if (amount > 0) {
        const desc = `Shofyor yo'l kirdi puli (${item.region}) - Tel: +998${digits}`;
        const existing = existingExpenses.find(e => e.description.includes(digits));

        if (existing) {
          dbOps.push(prisma.expense.update({ where: { id: existing.id }, data: { amount, description: desc } }));
        } else {
          dbOps.push(prisma.expense.create({ data: { description: desc, amount, category: 'transport', date: new Date() } }));
          expensesAddedCount++;
        }
        totalTransportExpensesSum += amount;
      }
    }
  }

  await Promise.all(dbOps);
  console.log(`Driver fees migration finished successfully. ${dbOps.length} records processed.`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
