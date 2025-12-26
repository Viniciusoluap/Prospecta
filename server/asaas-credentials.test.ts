import { describe, it, expect } from 'vitest';
import { validateAsaasApiKey } from './_core/asaas';

describe('Asaas Credentials Validation', () => {
  it('should validate Asaas API key by making a test request', async () => {
    console.log('✅ Testing Asaas API integration...');
    
    // Validate API key by making a real request
    const isValid = await validateAsaasApiKey();
    
    expect(isValid).toBe(true);
    
    console.log('✅ Asaas API key is valid and functional');
  }, 30000); // 30 second timeout for API call
});
