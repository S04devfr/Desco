/**
 * PostgreSQL ma'lumotlar bazasidagi barcha (yoki belgilangan) jadvallarning autoincrement sequence (id)
 * raqamlarini MAX(id) + 1 qiymatiga avtomatik ravishda tenglashtiradi.
 * Bu 'Unique constraint failed on the fields: (id)' xatolarining oldini oladi.
 */
async function fixPostgresSequences(prisma, specificTable = null) {
  try {
    const dbUrl = process.env.DATABASE_URL || '';
    const isSQLite = dbUrl.includes('.db') || dbUrl.startsWith('file:');
    if (isSQLite) {
      return; // SQLite AUTOINCREMENT ni o'zi boshqaradi
    }

    if (specificTable) {
      // Bitta aniq jadval uchun sequence ni tiklash
      const query = `
        SELECT setval(
          pg_get_serial_sequence('"${specificTable}"', 'id'),
          COALESCE((SELECT MAX(id) FROM "${specificTable}"), 0) + 1,
          false
        );
      `;
      await prisma.$executeRawUnsafe(query);
      console.log(`[Sequence Sync] "${specificTable}" jadvali sekvensiyasi tiklandi.`);
      return;
    }

    // Dynamic sequence sync SQL block (Barcha autoincrement sequence mavjud jadvallar uchun)
    const dynamicSql = `
      DO $$
      DECLARE
          r RECORD;
      BEGIN
          FOR r IN (
              SELECT table_name, column_name, pg_get_serial_sequence('"' || table_name || '"', column_name) as sequence_name
              FROM information_schema.columns
              WHERE table_schema = 'public' AND column_default LIKE 'nextval%'
          ) LOOP
              IF r.sequence_name IS NOT NULL THEN
                  EXECUTE 'SELECT setval(''' || r.sequence_name || ''', COALESCE((SELECT MAX("' || r.column_name || '") FROM "' || r.table_name || '"), 0) + 1, false)';
              END IF;
          END LOOP;
      END $$;
    `;
    await prisma.$executeRawUnsafe(dynamicSql);
    console.log('[Sequence Sync] ✅ PostgreSQL barcha jadvallarining ID sekvensiyalari MAX(id) ga muvofiqlashtirildi.');
  } catch (err) {
    // Fallback: Agar dinamik PL/pgSQL bloki bajarilmasa, ma'lum jadvallar ro'yxati bo'yicha ketma-ket bajaramiz
    const knownTables = [
      'User', 'Client', 'Company', 'Contact', 'Deal', 'Task', 'Expense',
      'Pipeline', 'PipelineStage', 'WarehouseStock', 'InstagramMessage',
      'TelegramMessage', 'ActivityLog', 'CallLog', 'Plan', 'ManagerSalary',
      'ManagerFine', 'PushSubscription'
    ];
    
    for (const tableName of knownTables) {
      try {
        await prisma.$executeRawUnsafe(`
          SELECT setval(
            pg_get_serial_sequence('"${tableName}"', 'id'),
            COALESCE((SELECT MAX(id) FROM "${tableName}"), 0) + 1,
            false
          );
        `);
      } catch (_) {}
    }
    console.log('[Sequence Sync Fallback] ✅ PostgreSQL jadvallar sekvensiyasi tiklandi.');
  }
}

module.exports = {
  fixPostgresSequences
};
