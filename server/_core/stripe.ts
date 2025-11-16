import Stripe from 'stripe';
import { ENV } from './env';

if (!ENV.stripeSecretKey) {
  throw new Error('STRIPE_SECRET_KEY is not configured');
}

export const stripe = new Stripe(ENV.stripeSecretKey, {
  apiVersion: '2025-10-29.clover',
  typescript: true,
});
