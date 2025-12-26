import mysql from "mysql2/promise";

// QR Code de teste (base64 pequeno)
const testQrCode = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const testCopyPaste = "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426614174000520400005303986540510.005802BR5913Fulano de Tal6008BRASILIA62070503***6304ABCD";

// Teste de inserção com QR Code usando mysql2 diretamente
const testInsert = async () => {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  
  try {
    const [result] = await connection.execute(
      `INSERT INTO tickets (draw_id, user_id, ticket_number, quantity, total_paid, payment_status, payment_method, pix_qr_code, pix_copy_paste, stripe_payment_intent_id, stripe_checkout_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [1, 1, `TEST_PIX_${Date.now()}`, 5, 1000, 'pending', 'pix', testQrCode, testCopyPaste, 'asaas_test_123', null]
    );
    console.log("SUCCESS:", result);
  } catch (error) {
    console.error("ERROR:", error.message);
  }
  
  await connection.end();
  process.exit(0);
};

testInsert();
