const { PrismaClient } = require('@prisma/client');

// Model delegates the app expects to exist on the generated Prisma Client.
// Keep this list in sync with prisma/schema.prisma model names (lowerCamelCase).
const EXPECTED_MODELS = [
  'user', 'client', 'pipeline', 'pipelineStage', 'deal',
  'activityLog', 'expense', 'task', 'companySettings',
  'installment', 'shopir', 'ishonchFilial',
  'company', 'contact', 'dealStageHistory', 'activity'
];

// Query methods we stub on a "broken" model delegate so any call site
// (findMany/findUnique/create/update/delete/...) fails the same clean way
// instead of throwing "Cannot read properties of undefined".
const DELEGATE_METHODS = [
  'findMany', 'findUnique', 'findFirst', 'create', 'createMany',
  'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
  'count', 'aggregate', 'groupBy'
];

// Mutating methods we auto-heal against "Unknown argument" errors caused by
// a stale generated client (schema.prisma has the field, but the client was
// generated before that field existed — e.g. Deal.pipelineId, Client.companyAddress).
const MUTATING_METHODS = ['create', 'update', 'upsert', 'createMany', 'updateMany'];

// Deep-clones args while preserving Date instances. JSON.parse(JSON.stringify())
// would corrupt Date objects (e.g. deadline, dueDate) into strings, which then
// fail Prisma's own type validation — so we walk the object graph manually.
function deepCloneArgs(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(deepCloneArgs);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = deepCloneArgs(value[key]);
    return out;
  }
  return value;
}

// Recursively deletes every occurrence of `fieldName` anywhere in the args
// tree (data blocks, nested relation create/connect/update objects, etc.).
// Returns true if at least one occurrence was found and removed.
function stripFieldDeep(obj, fieldName) {
  let stripped = false;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (stripFieldDeep(item, fieldName)) stripped = true;
    }
    return stripped;
  }
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    if (Object.prototype.hasOwnProperty.call(obj, fieldName)) {
      delete obj[fieldName];
      stripped = true;
    }
    for (const key of Object.keys(obj)) {
      if (stripFieldDeep(obj[key], fieldName)) stripped = true;
    }
  }
  return stripped;
}

const ALL_HEALABLE_METHODS = [
  'findMany', 'findUnique', 'findFirst', 'count', 'aggregate', 'groupBy',
  'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'
];

// Wraps a model delegate's method so that if the live (possibly stale) Prisma client
// rejects the call with "Unknown argument `X`" or "Unknown field `X`" or "no such column: X" — meaning
// schema.prisma defines field X or code queries field X but the generated client or DB predates it —
// we strip X from the payload/query/select/include/where and retry, instead of crashing the request.
function wrapAutoHealingMethod(originalFn, modelName, methodName) {
  const maxAttempts = 6;
  return async function (args) {
    let currentArgs = args;
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      try {
        return await originalFn(currentArgs);
      } catch (err) {
        const message = err && err.message ? String(err.message) : '';
        let fieldName = null;

        const argMatch = message.match(/Unknown (?:argument|field) [`'"]([a-zA-Z0-9_]+)[`'"]/i);
        if (argMatch) {
          fieldName = argMatch[1];
        } else {
          const colMatch = message.match(/(?:column|such column:?)\s+[`'"a-zA-Z0-9_.]*?([a-zA-Z0-9_]+)[`'"]?\s*(?:does not exist|in the current database)?/i);
          if (colMatch) {
            fieldName = colMatch[1];
          }
        }

        if (!fieldName || attempt === maxAttempts) throw err;

        const cloned = deepCloneArgs(currentArgs);
        const didStrip = stripFieldDeep(cloned, fieldName);
        if (!didStrip) throw err;

        console.warn(
          `[Database] "${modelName}.${methodName}": auto-healing stripped missing field "${fieldName}" (${attempt + 1}/${maxAttempts}).`
        );
        currentArgs = cloned;
      }
    }
  };
}

async function autoMigrateDatabase(client) {
  try {
    const isPostgres = process.env.DATABASE_URL && (process.env.DATABASE_URL.startsWith('postgres://') || process.env.DATABASE_URL.startsWith('postgresql://'));
    if (!isPostgres) return;

    const queries = [
      'ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "phone2" TEXT;',
      'ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "phone2" TEXT;',
      'ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "contactPhone2" TEXT;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "boardId" INTEGER;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "columnId" INTEGER;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "order" INTEGER DEFAULT 0;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN DEFAULT false;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "reminderMinutes" INTEGER;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "reminderSent" BOOLEAN DEFAULT false;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "labels" TEXT;',
      'ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP;'
    ];

    for (const q of queries) {
      try {
        await client.$executeRawUnsafe(q);
      } catch (_) { /* column already exists */ }
    }
  } catch (err) {
    // Ignore migration warnings
  }
}

class PrismaClientOutOfSyncError extends Error {
  constructor(modelName) {
    super(
      `Ma'lumotlar bazasi mijozi eskirgan: "${modelName}" modeli topilmadi. ` +
      `Iltimos serverda "npx prisma generate" buyrug'ini ishga tushiring va serverni qayta ishga tushiring.`
    );
    this.name = 'PrismaClientOutOfSyncError';
    this.code = 'PRISMA_CLIENT_OUT_OF_SYNC';
    this.status = 503;
  }
}

// Builds a stand-in for a missing/broken model delegate. Every query method
// rejects with a clean, actionable error instead of crashing the process.
function buildBrokenModelStub(modelName) {
  const stub = {};
  for (const method of DELEGATE_METHODS) {
    stub[method] = () => Promise.reject(new PrismaClientOutOfSyncError(modelName));
  }
  return stub;
}

function createSafePrismaClient() {
  let client;
  try {
    client = new PrismaClient({
      log: process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error']
    });
  } catch (e) {
    console.error('[Database] PrismaClient yaratilmadi:', e.message);
    client = {};
  }

  const missing = [];
  for (const modelName of EXPECTED_MODELS) {
    const delegate = client[modelName];
    const looksValid = delegate && typeof delegate.findMany === 'function';
    if (!looksValid) {
      missing.push(modelName);
      client[modelName] = buildBrokenModelStub(modelName);
    }
  }

  if (missing.length) {
    console.error(
      '\n' +
      '========================================================================\n' +
      '⚠️  PRISMA CLIENT ESKIRGAN (out of sync with schema.prisma)\n' +
      `   Quyidagi modellar generatsiya qilingan clientda topilmadi: ${missing.join(', ')}\n` +
      '   Bu ularga tegishli so\'rovlar 503 xatosi qaytarishiga olib keladi,\n' +
      '   server esa ishlashda davom etadi (crash bo\'lmaydi).\n' +
      '   TUZATISH: terminalda quyidagini ishga tushiring:\n' +
      '     npx prisma generate && npm run dev  (yoki serverni qayta ishga tushiring)\n' +
      '========================================================================\n'
    );
  }

  // Auto-heal unknown field / argument errors on every valid model delegate's query and mutating methods
  for (const modelName of EXPECTED_MODELS) {
    if (missing.includes(modelName)) continue;
    const delegate = client[modelName];
    if (!delegate) continue;
    for (const method of ALL_HEALABLE_METHODS) {
      if (typeof delegate[method] === 'function') {
        const original = delegate[method].bind(delegate);
        delegate[method] = wrapAutoHealingMethod(original, modelName, method);
      }
    }
  }

  // Guard top-level helpers too, in case construction failed entirely.
  if (typeof client.$disconnect !== 'function') {
    client.$disconnect = () => Promise.resolve();
  }
  const originalTransaction = typeof client.$transaction === 'function' ? client.$transaction.bind(client) : null;
  client.$transaction = async (arg, options) => {
    if (typeof arg === 'function') {
      if (originalTransaction) return originalTransaction(arg, options);
      return arg(client);
    }
    if (Array.isArray(arg)) {
      if (originalTransaction) {
        try {
          return await originalTransaction(arg, options);
        } catch (err) {
          if (err.message && err.message.includes('Prisma Client promises')) {
            return await originalTransaction(async (tx) => {
              const results = [];
              for (const item of arg) {
                results.push(await item);
              }
              return results;
            }, options);
          }
          throw err;
        }
      }
      const results = [];
      for (const p of arg) {
        results.push(await p);
      }
      return results;
    }
    if (originalTransaction) return originalTransaction(arg, options);
    throw new PrismaClientOutOfSyncError('$transaction');
  };
  if (typeof client.$executeRawUnsafe !== 'function') {
    client.$executeRawUnsafe = () => Promise.reject(new PrismaClientOutOfSyncError('$executeRawUnsafe'));
  }
  if (typeof client.$queryRawUnsafe !== 'function') {
    client.$queryRawUnsafe = () => Promise.reject(new PrismaClientOutOfSyncError('$queryRawUnsafe'));
  }

  return client;
}

const prisma = createSafePrismaClient();

// Run schema auto-migration on start
autoMigrateDatabase(prisma).catch(() => {});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Database] Closing Prisma connection...');
  try {
    await prisma.$disconnect();
  } catch (e) {
    // already a no-op stub or already disconnected — ignore
  }
  process.exit(0);
});

module.exports = prisma;
module.exports.PrismaClientOutOfSyncError = PrismaClientOutOfSyncError;
