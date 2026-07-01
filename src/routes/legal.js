const express = require('express');
const router = express.Router();
const path = require('path');
const ejs = require('ejs');
const fs = require('fs');

/**
 * Legal sahifalarni renderlovchi yordamchi funksiya.
 * Layout va content EJS fayllarini birlashtirib, to'liq HTML qaytaradi.
 */
function renderLegalPage(res, pageName, options) {
  const layoutPath = path.join(__dirname, '../../views/legal/layout.ejs');
  const contentPath = path.join(__dirname, `../../views/legal/${pageName}.ejs`);

  try {
    const contentHtml = ejs.render(fs.readFileSync(contentPath, 'utf8'), options);
    const fullHtml = ejs.render(fs.readFileSync(layoutPath, 'utf8'), {
      ...options,
      body: contentHtml
    });
    res.status(200).send(fullHtml);
  } catch (error) {
    console.error(`[Legal] ${pageName} sahifasini renderda xato:`, error.message);
    res.status(500).send('Internal Server Error');
  }
}

// ── Privacy Policy ──
router.get('/privacy', (req, res) => {
  renderLegalPage(res, 'privacy', {
    pageTitle: 'Privacy Policy',
    pageSubtitle: 'How we collect, use, and protect your information',
    pageDescription: 'Desco Lead CRM Privacy Policy — Learn how we handle your data from Facebook and Instagram Lead Ads.',
    activePage: 'privacy',
    lastUpdated: 'July 1, 2026'
  });
});

// ── Terms of Service ──
router.get('/terms', (req, res) => {
  renderLegalPage(res, 'terms', {
    pageTitle: 'Terms of Service',
    pageSubtitle: 'Rules and guidelines for using Desco Lead CRM',
    pageDescription: 'Desco Lead CRM Terms of Service — Terms and conditions for using our platform.',
    activePage: 'terms',
    lastUpdated: 'July 1, 2026'
  });
});

// ── Cookie Policy ──
router.get('/cookies', (req, res) => {
  renderLegalPage(res, 'cookies', {
    pageTitle: 'Cookie Policy',
    pageSubtitle: 'Information about cookies used on our platform',
    pageDescription: 'Desco Lead CRM Cookie Policy — We only use essential session cookies.',
    activePage: 'cookies',
    lastUpdated: 'July 1, 2026'
  });
});

// ── Data Deletion Instructions ──
router.get('/data-deletion', (req, res) => {
  renderLegalPage(res, 'data-deletion', {
    pageTitle: 'Data Deletion Request',
    pageSubtitle: 'How to request the deletion of your personal data',
    pageDescription: 'Desco Lead CRM Data Deletion — Request the removal of your personal data from our systems.',
    activePage: 'data-deletion',
    lastUpdated: 'July 1, 2026'
  });
});

// ── Contact Us ──
router.get('/contact', (req, res) => {
  renderLegalPage(res, 'contact', {
    pageTitle: 'Contact Us',
    pageSubtitle: 'Get in touch with our team',
    pageDescription: 'Contact Desco Lead CRM — Reach us for support, privacy inquiries, or general questions.',
    activePage: 'contact',
    lastUpdated: null
  });
});

// ── About Us ──
router.get('/about', (req, res) => {
  renderLegalPage(res, 'about', {
    pageTitle: 'About Desco Lead CRM',
    pageSubtitle: 'Professional Meta Lead Ads Management Platform',
    pageDescription: 'About Desco Lead CRM — Learn about our platform, features, and technology.',
    activePage: 'about',
    lastUpdated: null
  });
});

module.exports = router;
