/**
 * Pruebas de integración de la tienda contra un PostgreSQL real (la compra atómica solo se puede
 * probar de verdad con transacciones y bloqueos reales, no con un mock).
 * Requieren TEST_DATABASE_URL con las migraciones y el seed aplicados; sin ella se omiten.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SPELL_CATALOG } from "@duelo/game-rules";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.warn("[test] TEST_DATABASE_URL no está definida: se omiten las pruebas de integración de tienda.");
}

const INTERNAL_KEY = "clave-interna-de-prueba";

describe.skipIf(!databaseUrl)("tienda (integración)", () => {
  // Prefijo único por ejecución para no chocar con datos de corridas anteriores ni con auth.test.
  const prefix = `s_${Date.now().toString(36)}`;
  let counter = 0;

  let prisma: PrismaClient;
  let app: ReturnType<typeof createApp>;

  /** Registra una cuenta nueva (con el grimorio inicial) y le da el oro pedido. */
  async function createPlayer(gold = 0): Promise<{ id: string; token: string }> {
    counter += 1;
    const username = `${prefix}_${counter}`;
    const res = await request(app)
      .post("/auth/register")
      .send({ username, email: `${username}@duelo.test`, password: "contrasena-segura-1" });
    expect(res.status).toBe(201);
    const id: string = res.body.user.id;
    if (gold > 0) {
      await prisma.user.update({ where: { id }, data: { gold } });
    }
    return { id, token: res.body.token };
  }

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(() => {
    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "secreto-de-prueba-con-al-menos-32-caracteres",
      INTERNAL_API_KEY: INTERNAL_KEY,
      ALLOWED_ORIGINS: "http://localhost:5173",
    });
    prisma = createPrismaClient(env.DATABASE_URL);
    app = createApp({ env, prisma });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  describe("GET /spells", () => {
    it("devuelve el catálogo completo de game-rules ordenado (el seed está aplicado)", async () => {
      const res = await request(app).get("/spells");
      expect(res.status).toBe(200);
      expect(res.body.spells).toEqual(SPELL_CATALOG);
    });
  });

  describe("GET /internal/users/:id/loadout", () => {
    it("exige la clave interna", async () => {
      const player = await createPlayer();
      const sinClave = await request(app).get(`/internal/users/${player.id}/loadout`);
      expect(sinClave.status).toBe(403);
      const claveMala = await request(app)
        .get(`/internal/users/${player.id}/loadout`)
        .set("x-internal-key", "otra-clave-del-mismo-largo-xx");
      expect(claveMala.status).toBe(403);
    });

    it("responde 404 si el usuario no existe o el id no es un UUID", async () => {
      for (const id of ["00000000-0000-4000-8000-000000000000", "no-es-uuid"]) {
        const res = await request(app).get(`/internal/users/${id}/loadout`).set("x-internal-key", INTERNAL_KEY);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("NOT_FOUND");
      }
    });

    it("devuelve el grimorio inicial de una cuenta nueva", async () => {
      const player = await createPlayer();
      const res = await request(app).get(`/internal/users/${player.id}/loadout`).set("x-internal-key", INTERNAL_KEY);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        userId: player.id,
        rating: 0,
        rank: "Grado 4",
        spells: ["lightning", "shield"],
        ultimateId: "meteor",
      });
    });
  });

  describe("POST /shop/purchase", () => {
    it("exige sesión", async () => {
      const res = await request(app).post("/shop/purchase").send({ spellId: "slash" });
      expect(res.status).toBe(401);
    });

    it("compra: descuenta el oro y agrega el hechizo al inventario", async () => {
      const player = await createPlayer(120);
      const res = await request(app).post("/shop/purchase").set(bearer(player.token)).send({ spellId: "fireball" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ spellId: "fireball", gold: 20 });

      const owned = await prisma.userSpell.findUnique({
        where: { userId_spellId: { userId: player.id, spellId: "fireball" } },
      });
      expect(owned?.pricePaid).toBe(100);
    });

    it("rechaza oro insuficiente sin tocar el oro ni el inventario", async () => {
      const player = await createPlayer(40);
      const res = await request(app).post("/shop/purchase").set(bearer(player.token)).send({ spellId: "slash" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("INSUFFICIENT_GOLD");
      expect(res.body.error.details).toEqual({ gold: 40, price: 50 });

      const user = await prisma.user.findUniqueOrThrow({ where: { id: player.id } });
      expect(user.gold).toBe(40);
      const owned = await prisma.userSpell.count({ where: { userId: player.id, spellId: "slash" } });
      expect(owned).toBe(0);
    });

    it("rechaza un hechizo ya comprado o inicial y uno que no existe", async () => {
      const player = await createPlayer(500);
      const starter = await request(app).post("/shop/purchase").set(bearer(player.token)).send({ spellId: "lightning" });
      expect(starter.status).toBe(409);
      expect(starter.body.error.code).toBe("ALREADY_OWNED");

      const missing = await request(app).post("/shop/purchase").set(bearer(player.token)).send({ spellId: "dragon" });
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe("SPELL_NOT_FOUND");

      const user = await prisma.user.findUniqueOrThrow({ where: { id: player.id } });
      expect(user.gold).toBe(500);
    });

    it("dos clics simultáneos compran una sola vez", async () => {
      const player = await createPlayer(300);
      const buy = () => request(app).post("/shop/purchase").set(bearer(player.token)).send({ spellId: "heal" });
      const results = await Promise.all([buy(), buy(), buy()]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: player.id } });
      expect(user.gold).toBe(150);
      const owned = await prisma.userSpell.count({ where: { userId: player.id, spellId: "heal" } });
      expect(owned).toBe(1);
    });

    it("compras simultáneas de hechizos distintos nunca dejan oro negativo", async () => {
      // 250 de oro alcanza para Veneno (200) o Congelar (250), pero no para los dos.
      const player = await createPlayer(250);
      const results = await Promise.all(
        ["poison", "freeze"].map((spellId) =>
          request(app).post("/shop/purchase").set(bearer(player.token)).send({ spellId }),
        ),
      );
      const ok = results.filter((r) => r.status === 200);
      expect(ok).toHaveLength(1);
      expect(results.find((r) => r.status !== 200)?.body.error.code).toBe("INSUFFICIENT_GOLD");

      const user = await prisma.user.findUniqueOrThrow({ where: { id: player.id } });
      expect(user.gold).toBeGreaterThanOrEqual(0);
      expect(user.gold).toBe(ok[0]?.body.gold);
      const owned = await prisma.userSpell.count({
        where: { userId: player.id, spellId: { in: ["poison", "freeze"] } },
      });
      expect(owned).toBe(1);
    });
  });

  describe("PUT /me/grimoire y GET /me/inventory", () => {
    it("guarda el grimorio y el loadout del game-server lo refleja", async () => {
      const player = await createPlayer(1_000);
      for (const spellId of ["slash", "fireball", "storm"]) {
        const res = await request(app).post("/shop/purchase").set(bearer(player.token)).send({ spellId });
        expect(res.status).toBe(200);
      }

      const grimoire = { slots: ["lightning", "shield", "fireball", "slash"], ultimateId: "storm" };
      const saved = await request(app).put("/me/grimoire").set(bearer(player.token)).send(grimoire);
      expect(saved.status).toBe(200);
      expect(saved.body).toEqual(grimoire);

      // Mover un hechizo de espacio no choca con el UNIQUE (user_id, spell_id).
      const swapped = { slots: ["lightning", "shield", "slash", null], ultimateId: "meteor" };
      const resaved = await request(app).put("/me/grimoire").set(bearer(player.token)).send(swapped);
      expect(resaved.status).toBe(200);

      const inventory = await request(app).get("/me/inventory").set(bearer(player.token));
      expect(inventory.status).toBe(200);
      expect(inventory.body.grimoire).toEqual(swapped);
      expect(inventory.body.items.map((i: { spellId: string }) => i.spellId).sort()).toEqual(
        ["fireball", "lightning", "meteor", "shield", "slash", "storm"],
      );

      const loadout = await request(app).get(`/internal/users/${player.id}/loadout`).set("x-internal-key", INTERNAL_KEY);
      expect(loadout.body.spells).toEqual(["lightning", "shield", "slash"]);
      expect(loadout.body.ultimateId).toBe("meteor");

      const user = await prisma.user.findUniqueOrThrow({ where: { id: player.id } });
      expect(user.equippedUltimateId).toBe("meteor");
    });

    it("rechaza un grimorio inválido sin cambiar el guardado", async () => {
      const player = await createPlayer();
      const res = await request(app)
        .put("/me/grimoire")
        .set(bearer(player.token))
        .send({ slots: ["lightning", "shield", "freeze", null], ultimateId: "meteor" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_GRIMOIRE");
      expect(res.body.error.details).toEqual([{ field: "slots.2", message: expect.any(String) }]);

      const formatoMalo = await request(app).put("/me/grimoire").set(bearer(player.token)).send({ slots: "x" });
      expect(formatoMalo.status).toBe(400);
      expect(formatoMalo.body.error.code).toBe("VALIDATION_ERROR");

      const inventory = await request(app).get("/me/inventory").set(bearer(player.token));
      expect(inventory.body.grimoire).toEqual({ slots: ["lightning", "shield", null, null], ultimateId: "meteor" });
    });

    it("exige sesión", async () => {
      expect((await request(app).get("/me/inventory")).status).toBe(401);
      expect((await request(app).put("/me/grimoire").send({})).status).toBe(401);
    });
  });
});
