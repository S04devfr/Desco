const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const tasks = await prisma.task.findMany({ orderBy: { id: 'desc' }, take: 2 });
  const safeTasks = JSON.parse(JSON.stringify(tasks));
  function fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yyyy = dt.getFullYear();
    return dd + '.' + mm + '.' + yyyy;
  }
  for (const t of safeTasks) {
    console.log('dueDate:', t.dueDate);
    console.log('typeof dueDate:', typeof t.dueDate);
    console.log('fmtDate output:', fmtDate(t.dueDate));
  }
}
run();
