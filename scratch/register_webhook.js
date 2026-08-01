const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const settings = await prisma.companySettings.findFirst();
    const WAZZUP_API_KEY = process.env.WAZZUP_API_KEY || (settings?.instagramAccessToken && settings.instagramAccessToken.length === 32 ? settings.instagramAccessToken : null);
    
    if (!WAZZUP_API_KEY) {
      throw new Error('Wazzup API Key not configured in settings or environment.');
    }
    
    const domain = process.env.APP_URL || 'https://desco-production.up.railway.app';
    const webhookUrl = `${domain}/api/instagram/webhook`;
    
    console.log(`Registering webhook URL: ${webhookUrl}`);
    console.log(`Using API Key (last 4): ...${WAZZUP_API_KEY.slice(-4)}`);
    
    const payload = {
      webhooksUri: webhookUrl,
      subscriptions: {
        messagesAndStatuses: true
      }
    };
    
    const res = await fetch('https://api.wazzup24.com/v3/webhooks', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WAZZUP_API_KEY}`
      },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      console.log('✅ Webhook registered successfully in Wazzup!');
      
      // Fetch status to verify
      const statusRes = await fetch('https://api.wazzup24.com/v3/webhooks', {
        headers: { 'Authorization': `Bearer ${WAZZUP_API_KEY}` }
      });
      if (statusRes.ok) {
        console.log('Current Wazzup webhook settings:', await statusRes.json());
      }
    } else {
      console.error('❌ Failed to register webhook:', res.status, await res.text());
    }
  } catch (err) {
    console.error('Error registering webhook:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
