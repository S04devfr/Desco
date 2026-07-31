const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    console.log('Starting optimized fast pipeline consolidation...');
    
    // 1. Get all pipelines named "Zakazlar Holati" or containing "zakaz"
    const pipelines = await prisma.pipeline.findMany({
      where: { name: { contains: 'zakaz', mode: 'insensitive' } },
      include: { stages: { orderBy: { order: 'asc' } } }
    });

    console.log(`Found ${pipelines.length} matching pipelines.`);
    if (pipelines.length <= 1) {
      console.log('No consolidation needed.');
      return;
    }

    // 2. Identify the target/correct pipeline (the latest one with 5 stages)
    const targetPipeline = pipelines.find(p => p.stages.length === 5 && p.stages.some(s => s.name.toLowerCase().includes('taksi')));
    if (!targetPipeline) {
      console.error('Error: Could not find target pipeline with the correct 5 stages!');
      return;
    }

    console.log(`Target pipeline: ID ${targetPipeline.id} ("${targetPipeline.name}") with stages:`);
    targetPipeline.stages.forEach(s => console.log(`  - ${s.name} (id=${s.id})`));

    const newStages = targetPipeline.stages; // Yangi, Taksi kelyapti, Kutilyapti, Yolda, Yetib bordi
    const duplicatePipelineIds = [];
    
    // Collect all old stage definitions and build target mapping
    const stageIdToTargetIdMap = {};
    const allOldStageIds = [];

    for (const p of pipelines) {
      if (p.id === targetPipeline.id) continue;
      duplicatePipelineIds.push(p.id);
      
      for (let i = 0; i < p.stages.length; i++) {
        const oldStage = p.stages[i];
        allOldStageIds.push(oldStage.id);
        
        let targetStage = null;
        if (oldStage.name.toLowerCase().includes('yangi') || oldStage.name.toLowerCase().includes('qabul')) {
          targetStage = newStages[0]; // Yangi
        } else if (oldStage.name.toLowerCase().includes('taksi') || oldStage.name.toLowerCase().includes('tayyor')) {
          targetStage = newStages[1]; // Taksi kelyapti
        } else if (oldStage.name.toLowerCase().includes('kutil') || oldStage.name.toLowerCase().includes('yo\'lga')) {
          targetStage = newStages[2]; // Kutilyapti
        } else if (oldStage.name.toLowerCase().includes('yolda') || oldStage.name.toLowerCase().includes('chiqdi')) {
          targetStage = newStages[3]; // Yolda
        } else if (oldStage.name.toLowerCase().includes('yetib') || oldStage.name.toLowerCase().includes('olindi')) {
          targetStage = newStages[4]; // Yetib bordi
        } else {
          const idx = Math.min(i, newStages.length - 1);
          targetStage = newStages[idx];
        }
        
        if (targetStage) {
          stageIdToTargetIdMap[oldStage.id] = targetStage.id;
        }
      }
    }

    // 3. Find only the stages that ACTUALLY contain deals
    console.log('Finding duplicate stages that actually contain deals...');
    const activeDeals = await prisma.deal.findMany({
      where: { stageId: { in: allOldStageIds } },
      select: { stageId: true },
      distinct: ['stageId']
    });

    const activeStageIds = activeDeals.map(d => d.stageId);
    console.log(`Found ${activeStageIds.length} active old stages containing deals.`);

    // 4. Update only active stages sequentially or in a small batch
    for (const oldStageId of activeStageIds) {
      const targetId = stageIdToTargetIdMap[oldStageId];
      if (targetId) {
        const res = await prisma.deal.updateMany({
          where: { stageId: oldStageId },
          data: { stageId: targetId }
        });
        console.log(`  Moved ${res.count} deals from old stage ID ${oldStageId} to target stage ID ${targetId}`);
      }
    }

    // 5. Bulk delete all duplicate stages
    console.log(`Bulk deleting stages for ${duplicatePipelineIds.length} duplicate pipelines...`);
    const stagesDel = await prisma.pipelineStage.deleteMany({
      where: { pipelineId: { in: duplicatePipelineIds } }
    });
    console.log(`Deleted ${stagesDel.count} stages.`);

    // 6. Bulk delete all duplicate pipelines
    console.log(`Bulk deleting ${duplicatePipelineIds.length} duplicate pipelines...`);
    const pipeDel = await prisma.pipeline.deleteMany({
      where: { id: { in: duplicatePipelineIds } }
    });
    console.log(`Deleted ${pipeDel.count} pipelines.`);

    console.log('Pipeline consolidation successfully completed!');
  } catch (err) {
    console.error('Error during consolidation:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
