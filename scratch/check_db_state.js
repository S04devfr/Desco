const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const userCount = await prisma.user.count();
    const clientCount = await prisma.client.count();
    const dealCount = await prisma.deal.count();
    const taskCount = await prisma.task.count();
    const pipelineCount = await prisma.pipeline.count();
    const stageCount = await prisma.pipelineStage.count();
    const activityLogCount = await prisma.activityLog.count();

    console.log('=== Database Counts ===');
    console.log(`Users: ${userCount}`);
    console.log(`Clients: ${clientCount}`);
    console.log(`Deals: ${dealCount}`);
    console.log(`Tasks: ${taskCount}`);
    console.log(`Pipelines: ${pipelineCount}`);
    console.log(`Stages: ${stageCount}`);
    console.log(`Activity Logs: ${activityLogCount}`);

    if (clientCount > 0) {
      const sampleClients = await prisma.client.findMany({ take: 3 });
      console.log('\n--- Sample Clients ---');
      console.log(JSON.stringify(sampleClients, null, 2));
    }
  } catch (err) {
    console.error('Error reading DB state:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
