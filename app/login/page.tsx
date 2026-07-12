import { signIn } from "@/auth";
import { redirect } from "next/navigation";

async function action(formData: FormData) {
  "use server";
  try {
    await signIn("credentials", {
      email: String(formData.get("email")),
      password: String(formData.get("password")),
      redirectTo: "/playlists",
    });
  } catch (e) {
    // next-auth throws a redirect on success; rethrow those
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    redirect("/login?error=1");
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; verified?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main style={{ maxWidth: 420, margin: "40px auto" }}>
      <h1>登录</h1>
      {sp.verified && <p style={{ color: "green" }}>邮箱已验证,请登录。</p>}
      {sp.error && <p style={{ color: "crimson" }}>邮箱或密码错误,或邮箱未验证。</p>}
      <form action={action}>
        <input name="email" type="email" placeholder="邮箱" required /><br />
        <input name="password" type="password" placeholder="密码" required /><br />
        <button type="submit">登录</button>
      </form>
      <p><a href="/register">没有账号,注册</a></p>
    </main>
  );
}
