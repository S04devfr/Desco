const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true }
    });
    
    console.log(`Found ${users.length} active users in the database.`);
    
    const settings = await prisma.companySettings.findFirst();
    const WAZZUP_API_KEY = process.env.WAZZUP_API_KEY || (settings?.instagramAccessToken && settings.instagramAccessToken.length === 32 ? settings.instagramAccessToken : null);
    
    if (!WAZZUP_API_KEY) {
      throw new Error('Wazzup API Key not found in environment or database settings.');
    }
    
    console.log(`Using Wazzup API Key (last 4 chars): ...${WAZZUP_API_KEY.slice(-4)}`);
    
    const wazzupUsers = users.map(u => ({
      id: u.id.toString(),
      name: u.fullName || u.email,
      phone: '' // User phone is not in our schema
    }));
    
    console.log('Users to sync:', JSON.stringify(wazzupUsers, null, 2));
    
    const res = await fetch('https://api.wazzup24.com/v3/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WAZZUP_API_KEY}`
      },
      body: JSON.stringify(wazzupUsers)
    });
    
    if (res.ok) {
      console.log('✅ Users synced successfully with Wazzup!');
    } else {
      console.error('❌ Failed to sync users:', res.status, await res.text());
    }
  } catch (err) {
    console.error('Error during user sync:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
