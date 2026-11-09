/**
 * Pruebas de integración de auth contra un PostgreSQL real.
 * Requieren TEST_DATABASE_URL apuntando a una base con las migraciones y el seed aplicados;
 * sin esa variable se omiten (y lo dicen) en vez de fallar.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.warn("[test] TEST_DATABASE_URL no está definida: se omiten las pruebas de integración de auth.");
}

describe.skipIf(!databaseUrl)("auth (integración)", () => {
  // Sufijo único por ejecución: las pruebas no chocan con datos de corridas anteriores.
  const suffix = Date.now().toString(36);
  const username = `t_${suffix}`;
  const email = `t_${suffix}@duelo.test`;
  const password = "contrasena-segura-1";

  let prisma: PrismaClient;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "secreto-de-prueba-con-al-menos-32-caracteres",
      INTERNAL_API_KEY: "clave-interna-de-prueba",
      ALLOWED_ORIGINS: "http://localhost:5173",
    });
    prisma = createPrismaClient(env.DATABASE_URL);
    app = createApp({ env, prisma });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: `t_${suffix}` } } });
    await prisma.$disconnect();
  });

  it("registra con los hechizos y el grimorio iniciales", async () => {
    const res = await request(app).post("/auth/register").send({ username, email, password });
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe(username);
    expect(typeof res.body.token).toBe("string");

    const userId: string = res.body.user.id;
    const spells = await prisma.userSpell.findMany({ where: { userId }, orderBy: { spellId: "asc" } });
    expect(spells.map((s) => s.spellId)).toEqual(["lightning", "meteor", "shield"]);
    const slots = await prisma.grimoireSlot.findMany({ where: { userId }, orderBy: { slot: "asc" } });
    expect(slots.map((s) => [s.slot, s.spellId])).toEqual([
      [1, "lightning"],
      [2, "shield"],
    ]);
  });

  it("rechaza usuario repetido (sin distinguir mayúsculas) y correo repetido", async () => {
    const sameName = await request(app)
      .post("/auth/register")
      .send({ username: username.toUpperCase(), email: `otro_${email}`, password });
    expect(sameName.status).toBe(409);
    expect(sameName.body.error.code).toBe("USERNAME_TAKEN");

    const sameEmail = await request(app)
      .post("/auth/register")
      .send({ username: `${username}_2`, email: email.toUpperCase(), password });
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("valida los campos del registro", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ username: "a", email: "no-es-correo", password: "123" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(3);
  });

  it("inicia sesión con usuario o con correo", async () => {
    const byName = await request(app).post("/auth/login").send({ identifier: username, password });
    expect(byName.status).toBe(200);
    const byEmail = await request(app).post("/auth/login").send({ identifier: email, password });
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.user.id).toBe(byName.body.user.id);
  });

  it("responde lo mismo con contraseña incorrecta y con usuario inexistente", async () => {
    const wrongPassword = await request(app)
      .post("/auth/login")
      .send({ identifier: username, password: "otra-contrasena" });
    const unknownUser = await request(app)
      .post("/auth/login")
      .send({ identifier: `nadie_${suffix}`, password });
    for (const res of [wrongPassword, unknownUser]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    }
    expect(wrongPassword.body.error.message).toBe(unknownUser.body.error.message);
  });

  it("GET /me devuelve el perfil con el rango calculado", async () => {
    const login = await request(app).post("/auth/login").send({ identifier: username, password });
    const res = await request(app).get("/me").set("Authorization", `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      username,
      email,
      rating: 0,
      rank: "Grado 4",
      gold: 0,
      equippedUltimateId: "meteor",
    });
    expect(res.body).not.toHaveProperty("passwordHash");
  });

  it("GET /me sin token o con token basura responde 401", async () => {
    expect((await request(app).get("/me")).status).toBe(401);
    const res = await request(app).get("/me").set("Authorization", "Bearer basura");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("responde 400 ante JSON mal formado y 404 en rutas inexistentes", async () => {
    const badJson = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send("{ esto no es json");
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.code).toBe("VALIDATION_ERROR");

    const missing = await request(app).get("/no-existe");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
  });

  it("CORS solo autoriza los orígenes configurados", async () => {
    const allowed = await request(app).get("/health").set("Origin", "http://localhost:5173");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const blocked = await request(app).get("/health").set("Origin", "https://malicioso.example");
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("la base impide oro negativo (CHECK)", async () => {
    await expect(
      prisma.user.update({ where: { username }, data: { gold: -1 } }),
    ).rejects.toThrow();
  });
});
