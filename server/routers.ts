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
  // Código PIX fixo fornecido pelo usuário
  const pixCopyPaste = '00020101021126490014br.gov.bcb.pix0127contato@grupoefficaz.com.br5204000053039865802BR5925EFFICAZ PROMOCAO DE VENDA6009SAO PAULO622905251KA59P2H5DDDDBZ38HJZQA2GV63043C89';
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
        quantity: z.number().min(1),
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

    purchase: protectedProcedure
      .input(z.object({
        amount: z.number().min(1),
        paymentMethod: z.enum(["pix", "stripe"]).default("pix"),
      }))
      .mutation(async ({ input, ctx }) => {
        // 1 UTEF = R$ 1,00 = 100 centavos
        const totalPrice = input.amount * 100;
        const txId = `UTEF${Date.now()}${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
        
        // Se pagamento via Stripe
        if (input.paymentMethod === "stripe") {
          const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [
              {
                price_data: {
                  currency: "brl",
                  product_data: {
                    name: `Compra de UTEFs`,
                    description: `${input.amount.toLocaleString("pt-BR")} UTEFs (créditos internos Efficaz)`,
                  },
                  unit_amount: 100, // R$ 1,00 por UTEF
                },
                quantity: input.amount,
              },
            ],
            mode: "payment",
            success_url: `${ctx.req.headers.origin}/dashboard?utef_purchase=success`,
            cancel_url: `${ctx.req.headers.origin}/comprar-utef`,
            client_reference_id: ctx.user.id.toString(),
            customer_email: ctx.user.email || undefined,
            metadata: {
              user_id: ctx.user.id.toString(),
              utef_amount: input.amount.toString(),
              transaction_type: "utef_purchase",
              tx_id: txId,
            },
            allow_promotion_codes: true,
          });

          return {
            checkoutUrl: session.url,
            totalPrice,
          };
        }
        
        // Se pagamento via PIX
        const { pixCopyPaste, pixQrCode } = await generatePixCode(totalPrice, txId);

        return {
          pixCopyPaste,
          pixQrCode,
          totalPrice,
        };
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

  // ========== CONSTRUCTION (OBRAS) ==========
  construction: router({
    // Listar obras do usuário
    myProjects: protectedProcedure.query(async ({ ctx }) => {
      return db.getProjectsByUserId(ctx.user.id);
    }),

    // Listar TODAS as obras (apenas admin)
    allProjects: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
      }
      return db.getAllProjects();
    }),

    // Obter detalhes completos de uma obra (com etapas e fotos)
    getProjectDetails: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input, ctx }) => {
        const project = await db.getProjectWithDetails(input.projectId);
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
        }
        // Verificar se o usuário é o proprietário ou admin
        if (project.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        return project;
      }),

    // Criar nova obra
    createProject: protectedProcedure
      .input(z.object({
        title: z.string().min(1),
        address: z.string().optional(),
        projectType: z.string().optional(),
        totalArea: z.number().optional(),
        estimatedCost: z.number().optional(),
        startDate: z.date().optional(),
        estimatedEndDate: z.date().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const project = await db.createProject({
          ...input,
          userId: ctx.user.id,
          status: "planning",
          progress: 0,
        });
        return project;
      }),

    // Atualizar obra
    updateProject: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        title: z.string().optional(),
        address: z.string().optional(),
        projectType: z.string().optional(),
        totalArea: z.number().optional(),
        estimatedCost: z.number().optional(),
        actualCost: z.number().optional(),
        // Campos financeiros detalhados
        contractValue: z.number().optional(),
        contractType: z.string().optional(),
        contractorPayment: z.number().optional(),
        materialCost: z.number().optional(),
        lotCost: z.number().optional(),
        commissionCost: z.number().optional(),
        extrasCost: z.number().optional(),
        maintenanceCost: z.number().optional(),
        insuranceCost: z.number().optional(),
        balanceAmount: z.number().optional(),
        // Datas e status
        startDate: z.date().optional(),
        estimatedEndDate: z.date().optional(),
        actualEndDate: z.date().optional(),
        status: z.enum(["planning", "in_progress", "paused", "completed", "cancelled"]).optional(),
        progress: z.number().min(0).max(100).optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { projectId, ...updates } = input;
        const project = await db.getProjectById(projectId);
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
        }
        if (project.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        await db.updateProject(projectId, updates);
        return { success: true };
      }),

    // Deletar obra
    deleteProject: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const project = await db.getProjectById(input.projectId);
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
        }
        if (project.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        await db.deleteProject(input.projectId);
        return { success: true };
      }),

    // ========== ETAPAS ==========

    // Criar etapa
    createStage: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        name: z.string().min(1),
        description: z.string().optional(),
        orderIndex: z.number(),
        estimatedCost: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const project = await db.getProjectById(input.projectId);
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
        }
        if (project.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        const stage = await db.createStage(input);
        return stage;
      }),

    // Atualizar etapa
    updateStage: protectedProcedure
      .input(z.object({
        stageId: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(["pending", "in_progress", "completed"]).optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        actualCost: z.number().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { stageId, ...updates } = input;
        const stage = await db.getStageById(stageId);
        if (!stage) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Etapa não encontrada" });
        }
        const project = await db.getProjectById(stage.projectId);
        if (!project || (project.userId !== ctx.user.id && ctx.user.role !== "admin")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        await db.updateStage(stageId, updates);
        return { success: true };
      }),

    // Deletar etapa
    deleteStage: protectedProcedure
      .input(z.object({ stageId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const stage = await db.getStageById(input.stageId);
        if (!stage) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Etapa não encontrada" });
        }
        const project = await db.getProjectById(stage.projectId);
        if (!project || (project.userId !== ctx.user.id && ctx.user.role !== "admin")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        await db.deleteStage(input.stageId);
        return { success: true };
      }),

    // ========== FOTOS ==========

    // Upload de foto (retorna URL para upload no S3)
    uploadPhoto: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        stageId: z.number().optional(),
        caption: z.string().optional(),
        takenAt: z.date(),
        imageUrl: z.string(), // URL da imagem já no S3
      }))
      .mutation(async ({ input, ctx }) => {
        const project = await db.getProjectById(input.projectId);
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
        }
        if (project.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        const photo = await db.createPhoto({
          ...input,
          uploadedBy: ctx.user.id,
        });
        return photo;
      }),

    // Deletar foto
    deletePhoto: protectedProcedure
      .input(z.object({ photoId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        // Buscar foto para verificar permissões
        const photos = await db.getPhotosByProjectId(0); // Workaround: buscar todas e filtrar
        const photo = photos.find(p => p.id === input.photoId);
        if (!photo) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Foto não encontrada" });
        }
        const project = await db.getProjectById(photo.projectId);
        if (!project || (project.userId !== ctx.user.id && ctx.user.role !== "admin")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        await db.deletePhoto(input.photoId);
        return { success: true };
      }),
  }),

  // ========== PROJECT BUDGET REQUESTS (ORÇAMENTOS) ==========
  budgetRequests: router({
    // Criar solicitação de orçamento (pública)
    create: publicProcedure
      .input(z.object({
        userId: z.number().optional(),
        name: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
        city: z.string().optional(),
        projectType: z.string().optional(),
        hasLot: z.enum(["yes", "no", "not_sure"]).optional(),
        message: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const request = await db.createBudgetRequest({
          ...input,
          status: "pending",
        });
        
        // Notificar admin sobre novo orçamento
        // TODO: Implementar notificação
        
        return request;
      }),

    // Listar TODOS os orçamentos (apenas admin)
    getAll: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
      }
      return db.getAllBudgetRequests();
    }),

    // Obter orçamento por ID (apenas admin)
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        const request = await db.getBudgetRequestById(input.id);
        if (!request) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
        }
        return request;
      }),

    // Atualizar orçamento (apenas admin)
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pending", "contacted", "in_negotiation", "converted", "cancelled"]).optional(),
        adminNotes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        const { id, ...updates } = input;
        await db.updateBudgetRequest(id, updates);
        return { success: true };
      }),

    // Deletar orçamento (apenas admin)
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        await db.deleteBudgetRequest(input.id);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
