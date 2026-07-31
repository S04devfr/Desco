const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function countAll() {
  try {
    const pipelines = await prisma.pipeline.findMany({
      include: { stages: true }
    });
    console.log('--- Pipelines in Database ---');
    for (const p of pipelines) {
      console.log(`Pipeline: "${p.name}" (id=${p.id})`);
      for (const s of p.stages) {
        console.log(`  - Stage: "${s.name}" (id=${s.id}, order=${s.order})`);
      }
    }
  } catch (error) {
    console.error('Error counting records:', error);
  } finally {
    await prisma.$disconnect();
  }
}

countAll();
