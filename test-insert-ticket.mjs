import { drizzle } from "drizzle-orm/mysql2";

const db = drizzle(process.env.DATABASE_URL);

// Teste de inserção simples
const testInsert = async () => {
  try {
    const result = await db.execute(`
      INSERT INTO tickets (draw_id, user_id, ticket_number, quantity, total_paid, payment_status, payment_method, pix_qr_code, pix_copy_paste, stripe_payment_intent_id, stripe_checkout_session_id)
      VALUES (1, 1, 'TEST123456', 5, 1000, 'pending', 'pix', 'test_qr_code', 'test_copy_paste', 'asaas_123', NULL)
    `);
    console.log("SUCCESS:", result);
  } catch (error) {
    console.error("ERROR:", error.message);
    console.error("FULL ERROR:", error);
  }
  process.exit(0);
};

testInsert();
