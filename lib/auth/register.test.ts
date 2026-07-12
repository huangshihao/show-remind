import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import * as mailer from "@/lib/notifier/mailer";
import { registerUser, RegistrationError } from "./register";

const uid = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
afterEach(() => vi.restoreAllMocks());

describe("registerUser", () => {
  it("creates an unverified user, a token, and sends a verify email", async () => {
    const sendSpy = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    const email = `reg_${uid()}@e.com`;
    const { userId } = await registerUser({ email, password: "password123" });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.emailVerified).toBeNull();
    const token = await prisma.verificationToken.findFirst({ where: { userId } });
    expect(token).not.toBeNull();
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0][2]).toContain("/verify?token=");
  });

  it("rejects duplicate email", async () => {
    vi.spyOn(mailer, "sendMail").mockResolvedValue();
    const email = `dup_${uid()}@e.com`;
    await registerUser({ email, password: "password123" });
    await expect(registerUser({ email, password: "password123" })).rejects.toBeInstanceOf(
      RegistrationError,
    );
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
