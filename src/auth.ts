import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getUserByEmail } from "@/lib/legacy/repository";
import { verifyLegacyPassword } from "@/lib/legacy/password";

export type UserRole = "admin" | "corretor" | "colaborador" | "cliente";

interface AppUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  creci?: string;
  corretorId?: string;
  leadId?: string;
  legacyUserId?: number;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = (credentials.email as string).trim().toLowerCase();
        const password = credentials.password as string;
        let usuario = null;

        try {
          usuario = await prisma.usuario.findUnique({ where: { email } });
        } catch {
          // A implantação inicial pode ainda não ter recebido as tabelas ops_*.
          // O acesso legado permanece disponível enquanto a migração é aplicada.
        }

        if (usuario) {
          if (!usuario.ativo || !(await bcrypt.compare(password, usuario.senha))) {
            return null;
          }

          let corretorId: string | undefined;
          if (usuario.papel === "corretor") {
            const corretor = await prisma.corretor.findUnique({
              where: { email: usuario.email },
              select: { id: true },
            });
            corretorId = corretor?.id;
          }

          let leadId: string | undefined;
          if (usuario.papel === "cliente") {
            const lead = await prisma.lead.findFirst({
              where: { email: usuario.email },
              select: { id: true },
            });
            leadId = lead?.id;
          }

          return {
            id: usuario.id,
            name: usuario.nome,
            email: usuario.email,
            role: usuario.papel as UserRole,
            creci: usuario.creci ?? undefined,
            corretorId,
            leadId,
          };
        }

        const legacyUser = await getUserByEmail(email);
        if (
          !legacyUser?.passwordHash ||
          !verifyLegacyPassword(password, legacyUser.passwordHash)
        ) {
          return null;
        }

        return {
          id: `legacy:${legacyUser.id}`,
          name: legacyUser.name ?? legacyUser.email ?? "Cliente Prospecta",
          email: legacyUser.email ?? email,
          role: legacyUser.role === "admin" ? "admin" : "cliente",
          legacyUserId: legacyUser.id,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as AppUser).role;
        token.creci = (user as AppUser).creci;
        token.corretorId = (user as AppUser).corretorId;
        token.leadId = (user as AppUser).leadId;
        token.legacyUserId = (user as AppUser).legacyUserId;
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        (session.user as unknown as AppUser & { id: string }).role = token.role as UserRole;
        (session.user as unknown as AppUser).creci = token.creci as string | undefined;
        (session.user as unknown as AppUser).corretorId = token.corretorId as string | undefined;
        (session.user as unknown as AppUser).leadId = token.leadId as string | undefined;
        (session.user as unknown as AppUser).legacyUserId = token.legacyUserId as number | undefined;
        session.user.name = token.name as string;
        session.user.email = token.email as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
});
