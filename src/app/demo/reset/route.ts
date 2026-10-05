import { NextResponse, type NextRequest } from "next/server";
import { CURRENCY_COOKIE, LANG_COOKIE, PRIVACY_COOKIE, THEME_COOKIE } from "@/lib/prefs-shared";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  for (const name of [CURRENCY_COOKIE, LANG_COOKIE, PRIVACY_COOKIE, THEME_COOKIE]) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return response;
}
