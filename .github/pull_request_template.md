## Qué cambia

<!-- Resumen en 1–3 líneas. -->

## Área y requisito

- Área: <!-- shell / arena / tienda / ranking / api / game-server / contracts / game-rules / spell-engine / ui / infra -->
- Requisito(s) R1–R7 que toca: <!-- p. ej. R3 sockets -->
- Prioridad: <!-- P0 / P1 / P2 -->

## Cómo probarlo

1. <!-- pnpm --filter ... dev -->
2.

## Checklist

- [ ] `pnpm build` y `pnpm typecheck` pasan en local
- [ ] Sin URLs escritas en el código (todo por variables de entorno)
- [ ] Sin secretos en el diff; `.env.example` actualizado solo con nombres
- [ ] Si toca `packages/contracts` o `packages/game-rules`: avisé al equipo y listé a quién afecta
- [ ] No envía video ni audio crudo al servidor
- [ ] Commits con Conventional Commits (`feat(area): ...`)

## Capturas o evidencia

<!-- Opcional: capturas, GIF, salida de tests. -->
