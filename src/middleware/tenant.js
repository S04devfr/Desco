const prisma = require('../config/database');

/**
 * Multi-Tenancy Resolution Middleware
 * Resolves tenant via:
 * 1. Subdomain (e.g. `client.desco.uz` -> `client`)
 * 2. `X-Tenant-ID` or `X-Tenant-Slug` header
 * 3. Authenticated User's `tenantId` from session/JWT
 * 4. Fallback to default system tenant
 */
async function resolveTenant(req, res, next) {
  try {
    let tenantIdentifier = null;

    // 1. Check custom Header
    if (req.headers['x-tenant-id']) {
      tenantIdentifier = { id: parseInt(req.headers['x-tenant-id'], 10) };
    } else if (req.headers['x-tenant-slug']) {
      tenantIdentifier = { slug: req.headers['x-tenant-slug'].toString().toLowerCase().trim() };
    }

    // 2. Check Subdomain (if on custom host, ignoring railway/render/vercel/localhost/desco)
    if (!tenantIdentifier && req.hostname) {
      const host = req.hostname.toLowerCase();
      const isPlatformHost = host.includes('railway.app') || 
                             host.includes('render.com') || 
                             host.includes('vercel.app') || 
                             host.includes('localhost') || 
                             host === 'desco.uz' || 
                             host === 'www.desco.uz';

      if (!isPlatformHost) {
        const parts = host.split('.');
        if (parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'api') {
          tenantIdentifier = { slug: parts[0] };
        }
      }
    }

    // 3. Check Session / User tenantId
    if (!tenantIdentifier && req.user && req.user.tenantId) {
      tenantIdentifier = { id: req.user.tenantId };
    } else if (!tenantIdentifier && req.session && req.session.user && req.session.user.tenantId) {
      tenantIdentifier = { id: req.session.user.tenantId };
    }

    let tenant = null;
    if (tenantIdentifier && prisma.tenant && typeof prisma.tenant.findFirst === 'function') {
      try {
        tenant = await prisma.tenant.findFirst({
          where: tenantIdentifier
        });
      } catch (dbErr) {
        // Fallback safely if table doesn't exist yet
        tenant = null;
      }
    }

    // 4. Default System Tenant Fallback (ensures backward compatibility)
    if (!tenant) {
      req.tenant = {
        id: 1,
        name: 'DESCO Default Organization',
        slug: 'default',
        plan: 'enterprise',
        status: 'active',
        currency: 'UZS'
      };
    } else {
      req.tenant = tenant;
    }

    res.locals.currentTenant = req.tenant;
    next();
  } catch (err) {
    console.warn('[Tenant Middleware Warning]', err.message);
    // Continue with default fallback so app never crashes
    req.tenant = { id: 1, name: 'DESCO', slug: 'default', plan: 'enterprise', status: 'active', currency: 'UZS' };
    res.locals.currentTenant = req.tenant;
    next();
  }
}

/**
 * Guard to require an active tenant subscription
 */
function requireActiveTenant(req, res, next) {
  if (!req.tenant) {
    return res.status(400).json({ success: false, error: 'Tenant context is missing.' });
  }

  if (req.tenant.status === 'suspended' || req.tenant.status === 'past_due') {
    return res.status(403).json({
      success: false,
      error: 'Tashkilot hisobi to\'xtatilgan yoki to\'lov muddati o\'tgan. Iltimos, ma\'muriyatga murojaat qiling.'
    });
  }

  next();
}

module.exports = {
  resolveTenant,
  requireActiveTenant
};
