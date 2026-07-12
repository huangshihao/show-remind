import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "./passwords";
import { sendMail } from "@/lib/notifier/mailer";

export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationError";
  }
}

export async function registerUser(input: {
  email: string;
  password: string;
}): Promise<{ userId: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new RegistrationError("邮箱格式无效");
  if (input.password.length < 8) throw new RegistrationError("密码至少 8 位");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new RegistrationError("该邮箱已注册");

  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(input.password) },
  });
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: { token, userId: user.id, expires: new Date(Date.now() + 24 * 3600 * 1000) },
  });
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/verify?token=${token}`;
  await sendMail(email, "验证你的 Show-Remind 邮箱", `<p>点击验证:<a href="${url}">${url}</a></p>`);
  return { userId: user.id };
}
