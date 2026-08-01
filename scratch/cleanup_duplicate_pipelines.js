const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    console.log('Starting pipeline consolidation...');
    
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

    // Target stages maps
    const newStages = targetPipeline.stages; // Yangi, Taksi kelyapti, Kutilyapti, Yolda, Yetib bordi
    
    // 3. Loop through other pipelines and migrate their deals
    for (const p of pipelines) {
      if (p.id === targetPipeline.id) continue;
      
      console.log(`Consolidating duplicate pipeline: ID ${p.id} ("${p.name}") with ${p.stages.length} stages...`);
      
      for (let i = 0; i < p.stages.length; i++) {
        const oldStage = p.stages[i];
        
        // Find matching target stage based on order or name
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
          // Fallback to order index
          const idx = Math.min(i, newStages.length - 1);
          targetStage = newStages[idx];
        }

        if (targetStage) {
          // Move deals to target stage
          const dealsCount = await prisma.deal.count({ where: { stageId: oldStage.id } });
          if (dealsCount > 0) {
            console.log(`  Moving ${dealsCount} deals from old stage "${oldStage.name}" (id=${oldStage.id}) to target "${targetStage.name}" (id=${targetStage.id})`);
            await prisma.deal.updateMany({
              where: { stageId: oldStage.id },
              data: { stageId: targetStage.id }
            });
          }
        }
      }

      // 4. Delete old stages and pipeline
      console.log(`  Deleting duplicate stages for pipeline ID ${p.id}...`);
      await prisma.pipelineStage.deleteMany({ where: { pipelineId: p.id } });
      console.log(`  Deleting duplicate pipeline ID ${p.id}...`);
      await prisma.pipeline.delete({ where: { id: p.id } });
    }

    console.log('Pipeline consolidation successfully completed!');
  } catch (err) {
    console.error('Error during consolidation:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
