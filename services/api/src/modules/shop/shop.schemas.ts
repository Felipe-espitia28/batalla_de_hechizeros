/**
 * Validación de forma de las rutas de tienda. Aquí solo se revisa que el JSON tenga la estructura
 * correcta (VALIDATION_ERROR); las reglas de negocio del grimorio van en grimoire.ts
 * (INVALID_GRIMOIRE), porque necesitan el inventario del jugador.
 */
import { z } from "zod";

export const purchaseSchema = z.object({
  spellId: z.string().trim().min(1, "Indica qué hechizo quieres comprar").max(40),
});

export const grimoireSchema = z.object({
  // Cualquier texto o null: un id desconocido es un error de grimorio, no de formato.
  slots: z.array(z.string().max(40).nullable(), { error: "slots debe ser una lista" }),
  ultimateId: z.string().max(40, "ultimateId inválido"),
});

/** El id llega en la URL: si no es un UUID se trata como "no existe" sin consultar la base. */
export const loadoutParamsSchema = z.object({
  id: z.uuid(),
});
