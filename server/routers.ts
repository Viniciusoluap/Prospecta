import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";import { z } from "zod";
import { stripe } from "./_core/stripe";
import { ENV } from "./_core/env";
import QRCode from "qrcode";
import * as db from "./db";
import { TRPCError } from "@trpc/server";

// Helper para gerar número de bilhete único
function generateTicketNumber(): string {
  return `TKT${Date.now()}${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
}

// Helper para gerar código PIX (BR Code)
function generatePixBRCode(amount: number, pixKey: string, merchantName: string, merchantCity: string, txid: string): string {
  const amountStr = (amount / 100).toFixed(2);
  
  // Formato PIX BR Code simplificado
  const payload = [
    { id: '00', value: '01' }, // Payload Format Indicator
    { id: '26', value: `0014br.gov.bcb.pix01${pixKey.length.toString().padStart(2, '0')}${pixKey}` }, // Merchant Account Information
    { id: '52', value: '0000' }, // Merchant Category Code
    { id: '53', value: '986' }, // Transaction Currency (BRL)
    { id: '54', value: amountStr }, // Transaction Amount
    { id: '58', value: 'BR' }, // Country Code
    { id: '59', value: merchantName.substring(0, 25) }, // Merchant Name
    { id: '60', value: merchantCity.substring(0, 15) }, // Merchant City
    { id: '62', value: `05${txid.length.toString().padStart(2, '0')}${txid}` }, // Additional Data Field
  ];
  
  let brcode = '';
  for (const item of payload) {
    brcode += item.id + item.value.length.toString().padStart(2, '0') + item.value;
  }
  
  // CRC16 simplificado (para produção, usar biblioteca adequada)
  brcode += '6304';
  const crc = calculateCRC16(brcode);
  brcode += crc;
  
  return brcode;
}

// CRC16 CCITT-FALSE para PIX
function calculateCRC16(str: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

// Helper para gerar PIX completo
async function generatePixCode(amount: number, ticketNumber: string): Promise<{ pixCopyPaste: string; pixQrCode: string }> {
  const pixKey = "contato@grupoefficaz.com.br";
  const merchantName = "EFFICAZ PROMOCAO DE VENDAS";
  const merchantCity = "IMPERATRIZ";
  
  const pixCopyPaste = generatePixBRCode(amount, pixKey, merchantName, merchantCity, ticketNumber);
  const pixQrCode = await QRCode.toDataURL(pixCopyPaste);
  
  return { pixCopyPaste, pixQrCode };
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // ========== DRAWS (SORTEIOS) ==========
  draws: router({
    list: publicProcedure.query(async () => {
      return db.getActiveDraws();
    }),
    
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const draw = await db.getDrawById(input.id);
        if (!draw) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Sorteio não encontrado" });
        }
        return draw;
      }),

    create: protectedProcedure
      .input(z.object({
        title: z.string(),
        description: z.string().optional(),
        prizeAmount: z.number(),
        ticketPrice: z.number(),
        targetAmount: z.number(),
        drawDate: z.date().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Apenas admin pode criar sorteios
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        return db.createDraw(input);
      }),

    performDraw: protectedProcedure
      .input(z.object({
        drawId: z.number(),
        lotteryResult: z.string(), // Resultado da Loteria Federal
      }))
      .mutation(async ({ input, ctx }) => {
        // Apenas admin pode realizar sorteio
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }

        const draw = await db.getDrawById(input.drawId);
        if (!draw) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Sorteio não encontrado" });
        }

        if (draw.status !== "closed") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Sorteio ainda não foi fechado" });
        }

        // Buscar todos os bilhetes confirmados
        const allTickets = await db.getTicketsByDrawId(input.drawId);
        const confirmedTickets = allTickets.filter(t => t.paymentStatus === "confirmed");

        if (confirmedTickets.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Nenhum bilhete confirmado para sorteio" });
        }

        // Selecionar ganhador aleatório (simulação baseada no resultado da loteria)
        const winnerIndex = parseInt(input.lotteryResult.slice(-2)) % confirmedTickets.length;
        const winner = confirmedTickets[winnerIndex];

        // Atualizar sorteio com ganhador
        await db.updateDraw(input.drawId, {
          status: "drawn",
          winnerUserId: winner.userId,
          lotteryResult: input.lotteryResult,
        });

        // Creditar UTEFs ao ganhador
        await db.createOrUpdateUtefBalance(winner.userId, draw.prizeAmount);
        await db.createUtefTransaction({
          userId: winner.userId,
          amount: draw.prizeAmount,
          type: "prize",
          description: `Prêmio do sorteio: ${draw.title}`,
          relatedId: input.drawId,
        });

        return { success: true, winnerId: winner.userId, winnerTicket: winner.ticketNumber };
      }),
  }),

  // ========== TICKETS (BILHETES) ==========
  tickets: router({
    myTickets: protectedProcedure.query(async ({ ctx }) => {
      return db.getTicketsByUserId(ctx.user.id);
    }),

    purchase: protectedProcedure
      .input(z.object({
        drawId: z.number(),
        quantity: z.number().min(1).max(100),
        paymentMethod: z.enum(["pix", "stripe"]).default("stripe"),
      }))
      .mutation(async ({ input, ctx }) => {
        const draw = await db.getDrawById(input.drawId);
        if (!draw) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Sorteio não encontrado" });
        }

        if (draw.status !== "active") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Sorteio não está ativo" });
        }

        const totalPaid = draw.ticketPrice * input.quantity;
        const ticketNumber = generateTicketNumber();
        
        // Se pagamento via Stripe
        if (input.paymentMethod === "stripe") {
          const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [
              {
                price_data: {
                  currency: "brl",
                  product_data: {
                    name: `Bilhete(s) - ${draw.title}`,
                    description: `${input.quantity} bilhete(s) para o sorteio ${draw.title}`,
                  },
                  unit_amount: draw.ticketPrice,
                },
                quantity: input.quantity,
              },
            ],
            mode: "payment",
            success_url: `${ctx.req.headers.origin}/meus-bilhetes?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${ctx.req.headers.origin}/sorteios`,
            client_reference_id: ctx.user.id.toString(),
            customer_email: ctx.user.email || undefined,
            metadata: {
              user_id: ctx.user.id.toString(),
              draw_id: input.drawId.toString(),
              quantity: input.quantity.toString(),
              ticket_number: ticketNumber,
            },
            allow_promotion_codes: true,
          });

          const ticket = await db.createTicket({
            drawId: input.drawId,
            userId: ctx.user.id,
            ticketNumber,
            quantity: input.quantity,
            totalPaid,
            paymentStatus: "pending",
            paymentMethod: "stripe",
            stripeCheckoutSessionId: session.id,
          });

          return {
            ticket,
            checkoutUrl: session.url,
            totalPaid,
          };
        }
        
        // Se pagamento via PIX
        const { pixCopyPaste, pixQrCode } = await generatePixCode(totalPaid, ticketNumber);

        const ticket = await db.createTicket({
          drawId: input.drawId,
          userId: ctx.user.id,
          ticketNumber,
          quantity: input.quantity,
          totalPaid,
          paymentStatus: "pending",
          paymentMethod: "pix",
          pixCopyPaste,
          pixQrCode,
        });

        return {
          ticket,
          pixCopyPaste,
          pixQrCode,
          totalPaid,
        };
      }),

    confirmPayment: protectedProcedure
      .input(z.object({
        ticketId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Simulação de confirmação de pagamento
        // Em produção, integrar com webhook do gateway de pagamento
        await db.updateTicket(input.ticketId, {
          paymentStatus: "confirmed",
        });

        // Atualizar estatísticas do sorteio
        const ticket = (await db.getTicketsByUserId(ctx.user.id)).find(t => t.id === input.ticketId);
        if (ticket) {
          const draw = await db.getDrawById(ticket.drawId);
          if (draw) {
            await db.updateDraw(ticket.drawId, {
              ticketsSold: draw.ticketsSold + ticket.quantity,
              currentAmount: draw.currentAmount + ticket.totalPaid,
            });
          }
        }

        return { success: true };
      }),
  }),

  // ========== UTEF ==========
  utef: router({
    balance: protectedProcedure.query(async ({ ctx }) => {
      const balance = await db.getUtefBalance(ctx.user.id);
      return balance?.balance || 0;
    }),

    transactions: protectedProcedure.query(async ({ ctx }) => {
      return db.getUtefTransactionsByUserId(ctx.user.id);
    }),
  }),

  // ========== PRODUCTS (PRODUTOS) ==========
  products: router({
    list: publicProcedure
      .input(z.object({
        category: z.enum(["real_estate", "financial", "nautical"]).optional(),
      }))
      .query(async ({ input }) => {
        return db.getProducts(input.category);
      }),

    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const product = await db.getProductById(input.id);
        if (!product) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado" });
        }
        return product;
      }),

    create: protectedProcedure
      .input(z.object({
        category: z.enum(["real_estate", "financial", "nautical"]),
        title: z.string(),
        description: z.string().optional(),
        priceUtef: z.number(),
        imageUrl: z.string().optional(),
        details: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Apenas admin pode criar produtos
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        return db.createProduct(input);
      }),

    convert: protectedProcedure
      .input(z.object({
        productId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        const product = await db.getProductById(input.productId);
        if (!product) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado" });
        }

        const balance = await db.getUtefBalance(ctx.user.id);
        if (!balance || balance.balance < product.priceUtef) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Saldo insuficiente de UTEF" });
        }

        // Debitar UTEFs
        await db.createOrUpdateUtefBalance(ctx.user.id, -product.priceUtef);
        await db.createUtefTransaction({
          userId: ctx.user.id,
          amount: -product.priceUtef,
          type: "conversion",
          description: `Conversão em: ${product.title}`,
          relatedId: product.id,
        });

        // Criar registro de conversão
        const conversion = await db.createProductConversion({
          userId: ctx.user.id,
          productId: product.id,
          utefAmount: product.priceUtef,
          status: "pending",
        });

        return { success: true, conversion };
      }),

    myConversions: protectedProcedure.query(async ({ ctx }) => {
      return db.getConversionsByUserId(ctx.user.id);
    }),
  }),
});

export type AppRouter = typeof appRouter;
