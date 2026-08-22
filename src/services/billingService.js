const prisma = require('../config/database');

const PLANS = {
  free: {
    id: 'free',
    name: 'Free Starter',
    price: 0,
    currency: 'UZS',
    interval: 'month',
    limits: {
      maxUsers: 3,
      maxDeals: 500,
      maxPipelines: 1,
      analytics: 'basic',
      aiAssistant: false,
      telephony: false,
      whatsappInstagram: true
    },
    features: [
      '3 tagacha foydalanuvchi',
      '500 tagacha sdelka',
      '1 ta asosiy voronka',
      'Instagram va Telegram integratsiyasi',
      'Boshlang\'ich analitika'
    ]
  },
  starter: {
    id: 'starter',
    name: 'Business Starter',
    price: 250000,
    currency: 'UZS',
    interval: 'month',
    limits: {
      maxUsers: 10,
      maxDeals: 5000,
      maxPipelines: 3,
      analytics: 'advanced',
      aiAssistant: true,
      telephony: false,
      whatsappInstagram: true
    },
    features: [
      '10 tagacha foydalanuvchi',
      '5,000 tagacha sdelka',
      '3 ta savdo voronkasi',
      'Instagram, Telegram, Webhook',
      'AI Smart Assistant (DeepSeek)',
      'To\'liq savdo tahlili va KPI'
    ]
  },
  pro: {
    id: 'pro',
    name: 'Professional CRM',
    price: 600000,
    currency: 'UZS',
    interval: 'month',
    limits: {
      maxUsers: 30,
      maxDeals: 25000,
      maxPipelines: 10,
      analytics: 'enterprise',
      aiAssistant: true,
      telephony: true,
      whatsappInstagram: true
    },
    features: [
      '30 tagacha foydalanuvchi',
      '25,000 tagacha sdelka',
      '10 ta savdo va logistika voronkasi',
      'IP Telefoniya & Call Tracking (Zadarma, Asterisk)',
      'AI Chatbot & Avtomatlashtirish',
      'Nasiya va shofyorlar balansi',
      '24/7 Premium Texnik yordam'
    ]
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise Scale',
    price: 1200000,
    currency: 'UZS',
    interval: 'month',
    limits: {
      maxUsers: 9999,
      maxDeals: 999999,
      maxPipelines: 99,
      analytics: 'enterprise',
      aiAssistant: true,
      telephony: true,
      whatsappInstagram: true
    },
    features: [
      'Cheksiz foydalanuvchilar',
      'Cheksiz sdelkalar va mijozlar',
      'Cheksiz savdo voronkalari',
      'Maxsus server va Dedicated DB imkoniyati',
      'Custom API & Webhook integratsiyalari',
      'SLA Kafolati & Shaxsiy menejer'
    ]
  }
};

/**
 * Get current tenant subscription and usage statistics
 */
async function getTenantUsage(tenantId = 1) {
  const [dealCount, userCount, pipelineCount, tenant] = await Promise.all([
    prisma.deal.count().catch(() => 0),
    prisma.user.count({ where: { isActive: true } }).catch(() => 0),
    (prisma.tenant && typeof prisma.tenant.findFirst === 'function') 
      ? prisma.tenant.findFirst({ where: { id: tenantId } }).catch(() => null)
      : Promise.resolve(null)
  ]);

  const planId = tenant?.plan || 'pro';
  const planConfig = PLANS[planId] || PLANS.pro;

  return {
    tenant: {
      id: tenantId,
      name: tenant?.name || 'DESCO CRM Organization',
      slug: tenant?.slug || 'default',
      plan: planId,
      status: tenant?.status || 'active'
    },
    plan: planConfig,
    usage: {
      deals: {
        current: dealCount,
        limit: planConfig.limits.maxDeals,
        percentage: Math.min(100, Math.round((dealCount / planConfig.limits.maxDeals) * 100))
      },
      users: {
        current: userCount,
        limit: planConfig.limits.maxUsers,
        percentage: Math.min(100, Math.round((userCount / planConfig.limits.maxUsers) * 100))
      },
      pipelines: {
        current: pipelineCount,
        limit: planConfig.limits.maxPipelines,
        percentage: Math.min(100, Math.round((pipelineCount / planConfig.limits.maxPipelines) * 100))
      }
    }
  };
}

module.exports = {
  PLANS,
  getTenantUsage
};
