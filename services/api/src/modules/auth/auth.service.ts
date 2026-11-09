/**
 * Lógica de cuentas: registro, login y perfil. Las rutas solo validan y llaman aquí.
 */
import bcrypt from "bcryptjs";
import type { AuthResponse, LoginRequest, MeResponse, RegisterRequest, UltimateId } from "@duelo/contracts";
import { getRankForRating } from "@duelo/game-rules";
import { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { HttpError, unauthorized } from "../../lib/http-error.js";
import { signAccessToken } from "../../lib/jwt.js";

// Costo 10: ~70 ms por hash en el plan gratuito de Render; suficiente y no frena el login.
const BCRYPT_COST = 10;

/** Lo que recibe una cuenta nueva (sección 6, Economía, y sección 8, Registro). */
const STARTER_SPELL_IDS = ["lightning", "shield", "meteor"] as const;
const STARTER_GRIMOIRE = [
  { slot: 1, spellId: "lightning" },
  { slot: 2, spellId: "shield" },
] as const;

// Hash de una contraseña cualquiera para comparar cuando el usuario no existe: así el login
// tarda lo mismo exista o no la cuenta, y no se puede averiguar qué usuarios hay midiendo tiempos.
const DUMMY_HASH = bcrypt.hashSync("usuario-inexistente", BCRYPT_COST);

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly jwtSecret: string,
  ) {}

  async register(input: RegisterRequest): Promise<AuthResponse> {
    await this.assertAvailable(input.username, input.email);
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

    try {
      // Un solo create anidado = una transacción: o queda la cuenta completa o no queda nada.
      const user = await this.prisma.user.create({
        data: {
          username: input.username,
          email: input.email,
          passwordHash,
          spells: { create: STARTER_SPELL_IDS.map((spellId) => ({ spellId, pricePaid: 0 })) },
          grimoireSlots: { create: STARTER_GRIMOIRE.map((slot) => ({ ...slot })) },
        },
        select: { id: true, username: true },
      });
      return { token: signAccessToken(user, this.jwtSecret), user };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // Dos registros simultáneos con el mismo nombre: el chequeo previo no los ve, la restricción sí.
        if (error.code === "P2002") {
          await this.assertAvailable(input.username, input.email);
        }
        // FK rota = la tabla spells está vacía. Mensaje explícito para no perder tiempo depurando.
        if (error.code === "P2003") {
          throw new HttpError(
            500,
            "INTERNAL_ERROR",
            "Faltan los hechizos iniciales en la base (ejecuta: pnpm --filter @duelo/api db:seed)",
          );
        }
      }
      throw error;
    }
  }

  async login(input: LoginRequest): Promise<AuthResponse> {
    const identifier = input.identifier.trim();
    const user = identifier.includes("@")
      ? await this.prisma.user.findUnique({ where: { email: identifier.toLowerCase() } })
      : await this.prisma.user.findFirst({
          where: { username: { equals: identifier, mode: "insensitive" } },
        });

    const passwordOk = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordOk) {
      // Mismo mensaje en ambos casos: no se revela si el usuario existe.
      throw new HttpError(401, "INVALID_CREDENTIALS", "Usuario o contraseña incorrectos");
    }

    const sessionUser = { id: user.id, username: user.username };
    return { token: signAccessToken(sessionUser, this.jwtSecret), user: sessionUser };
  }

  async getProfile(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      // Token válido de una cuenta borrada: se trata como sesión inválida para que el shell vuelva al login.
      throw unauthorized("La cuenta ya no existe");
    }
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      rating: user.rating,
      rank: getRankForRating(user.rating),
      gold: user.gold,
      wins: user.wins,
      losses: user.losses,
      draws: user.draws,
      equippedUltimateId: user.equippedUltimateId as UltimateId,
      createdAt: user.createdAt.toISOString(),
    };
  }

  /** Lanza 409 si el usuario (sin distinguir mayúsculas) o el correo ya están en uso. */
  private async assertAvailable(username: string, email: string): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: { equals: username, mode: "insensitive" } }, { email }],
      },
      select: { username: true, email: true },
    });
    if (!existing) return;
    if (existing.email === email) {
      throw new HttpError(409, "EMAIL_TAKEN", "Ese correo ya está registrado");
    }
    throw new HttpError(409, "USERNAME_TAKEN", "Ese nombre de usuario ya está en uso");
  }
}
