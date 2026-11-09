// Pruebas unitarias (sin base de datos) del JWT y del middleware de errores.
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { HttpError } from "../src/lib/http-error.js";
import { signAccessToken, verifyAccessToken } from "../src/lib/jwt.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { getAuth, requireAuth } from "../src/middleware/require-auth.js";
import { requireInternalKey } from "../src/middleware/require-internal-key.js";

const SECRET = "secreto-de-prueba-con-al-menos-32-caracteres";
const user = { id: "6f1c2a8e-0000-4000-8000-000000000001", username: "felipe" };

describe("jwt", () => {
  it("firma y verifica con los claims del contrato", () => {
    const claims = verifyAccessToken(signAccessToken(user, SECRET), SECRET);
    expect(claims.sub).toBe(user.id);
    expect(claims.username).toBe("felipe");
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it("rechaza un token firmado con otro secreto", () => {
    const token = signAccessToken(user, "otro-secreto-distinto-de-32-caracteres!!");
    expect(() => verifyAccessToken(token, SECRET)).toThrowError(
      expect.objectContaining({ status: 401, code: "UNAUTHORIZED" }),
    );
  });

  it("distingue el token expirado", () => {
    const expired = jwt.sign({ username: "felipe", exp: Math.floor(Date.now() / 1000) - 10 }, SECRET, {
      algorithm: "HS256",
      subject: user.id,
    });
    expect(() => verifyAccessToken(expired, SECRET)).toThrowError(
      expect.objectContaining({ status: 401, code: "TOKEN_EXPIRED" }),
    );
  });

  it("rechaza el algoritmo 'none'", () => {
    const unsigned = jwt.sign({ username: "felipe" }, "", { algorithm: "none", subject: user.id });
    expect(() => verifyAccessToken(unsigned, SECRET)).toThrowError(HttpError);
  });
});

describe("middlewares", () => {
  const app = express();
  app.get("/privado", requireAuth(SECRET), (req, res) => {
    res.json({ userId: getAuth(req).userId });
  });
  app.get("/internal/ping", requireInternalKey("clave-interna-de-prueba"), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);

  it("requireAuth deja pasar un Bearer válido", async () => {
    const res = await request(app)
      .get("/privado")
      .set("Authorization", `Bearer ${signAccessToken(user, SECRET)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: user.id });
  });

  it("requireAuth responde 401 con ApiErrorBody sin cabecera", async () => {
    const res = await request(app).get("/privado");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("requireInternalKey exige x-internal-key", async () => {
    expect((await request(app).get("/internal/ping")).status).toBe(403);
    const ok = await request(app).get("/internal/ping").set("x-internal-key", "clave-interna-de-prueba");
    expect(ok.status).toBe(200);
  });
});
