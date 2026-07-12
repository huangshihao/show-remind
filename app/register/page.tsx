import { registerUser, RegistrationError } from "@/lib/auth/register";
import { redirect } from "next/navigation";

async function action(formData: FormData) {
  "use server";
  try {
    await registerUser({
      email: String(formData.get("email")),
      password: String(formData.get("password")),
    });
  } catch (e) {
    if (e instanceof RegistrationError) redirect(`/register?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/register?sent=1");
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main style={{ maxWidth: 420, margin: "40px auto" }}>
      <h1>注册</h1>
      {sp.sent && <p>验证邮件已发送,请查收(开发环境见 MailHog http://localhost:8025)。</p>}
      {sp.error && <p style={{ color: "crimson" }}>{sp.error}</p>}
      <form action={action}>
        <input name="email" type="email" placeholder="邮箱" required /><br />
        <input name="password" type="password" placeholder="密码(≥8位)" required /><br />
        <button type="submit">注册</button>
      </form>
      <p><a href="/login">已有账号,登录</a></p>
    </main>
  );
}
