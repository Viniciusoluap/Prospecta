import { describe, it, expect } from 'vitest';
import Stripe from 'stripe';

describe('Stripe Credentials Validation', () => {
  it('should validate Stripe secret key by retrieving account info', async () => {
    const secretKey = process.env.STRIPE_SECRET_KEY_NEW || process.env.STRIPE_SECRET_KEY;
    
    expect(secretKey).toBeDefined();
    expect(secretKey).not.toBe('');
    expect(secretKey).toMatch(/^sk_(test|live)_/);
    
    // Initialize Stripe client
    const stripe = new Stripe(secretKey!, {
      apiVersion: '2025-10-29.clover',
    });
    
    // Validate by retrieving account information
    const account = await stripe.account.retrieve();
    
    expect(account).toBeDefined();
    expect(account.id).toBeDefined();
    expect(account.object).toBe('account');
    
    console.log('✅ Stripe account validated:', account.id);
    console.log('✅ Account email:', account.email);
    console.log('✅ Charges enabled:', account.charges_enabled);
    console.log('✅ Payouts enabled:', account.payouts_enabled);
  }, 15000); // 15 second timeout for API call
  
  it('should validate Stripe publishable key format', () => {
    const publishableKey = process.env.VITE_STRIPE_PUBLISHABLE_KEY_NEW || process.env.VITE_STRIPE_PUBLISHABLE_KEY;
    
    expect(publishableKey).toBeDefined();
    expect(publishableKey).not.toBe('');
    expect(publishableKey).toMatch(/^pk_(test|live)_/);
    
    console.log('✅ Publishable key format validated');
  });
});
