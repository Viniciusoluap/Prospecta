import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { canAccessAdminPath, getSessionRole } from "@/lib/auth/rbac";

export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  const role = getSessionRole(req.auth);

  if (pathname.startsWith("/admin") && !canAccessAdminPath(req.auth, pathname)) {
    return NextResponse.redirect(new URL(isLoggedIn ? "/portal" : "/login", req.nextUrl));
  }

  if (pathname === "/login" && isLoggedIn) {
    const legacyUserId = (req.auth?.user as { legacyUserId?: number } | undefined)?.legacyUserId;
    return NextResponse.redirect(new URL(legacyUserId ? "/utef" : role === "cliente" ? "/portal" : "/admin", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/auth).*)"],
};
