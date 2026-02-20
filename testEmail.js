// testEmail.js
require('dotenv').config({ path: '/Users/macintoshhd/Documents/ollanpharmacy/backend/.env' });
const nodemailer = require('nodemailer');

async function testEmail() {
  console.log('Environment variables:', {
    EMAIL_HOST: process.env.EMAIL_HOST,
    EMAIL_PORT: process.env.EMAIL_PORT,
    EMAIL_SECURE: process.env.EMAIL_SECURE,
    EMAIL_USER: process.env.EMAIL_USER,
    EMAIL_PASS: process.env.EMAIL_PASS ? '****' : 'undefined',
    EMAIL_FROM: process.env.EMAIL_FROM,
  });

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('Error: EMAIL_USER or EMAIL_PASS is missing');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtppro.zoho.com',
    port: parseInt(process.env.EMAIL_PORT, 10) || 465,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    logger: true,
    debug: true,
  });

  try {
    await transporter.verify();
    console.log('SMTP connection successful');
  } catch (error) {
    console.error('SMTP connection failed:', error);
  }
}

testEmail();