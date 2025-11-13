import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { TRPCError } from "@trpc/server";

// Helper para gerar número de bilhete único
function generateTicketNumber(): string {
  return `TKT${Date.now()}${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
}

// Helper para gerar PIX simulado (copia e cola)
function generatePixCode(amount: number, ticketNumber: string): string {
  // Simulação de código PIX (em produção, integrar com gateway de pagamento)
  return `00020126580014br.gov.bcb.pix0136${ticketNumber}520400005303986540${(amount / 100).toFixed(2)}5802BR5925EFFICAZ ORBIT6009SAO PAULO62070503***6304${Math.random().toString().substring(2, 6)}`;
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
        const pixCopyPaste = generatePixCode(totalPaid, ticketNumber);

        const ticket = await db.createTicket({
          drawId: input.drawId,
          userId: ctx.user.id,
          ticketNumber,
          quantity: input.quantity,
          totalPaid,
          paymentStatus: "pending",
          paymentMethod: "pix",
          pixCopyPaste,
        });

        return {
          ticket,
          pixCopyPaste,
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
