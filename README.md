# IRON NITRO — Orbital Foundry

Demo web de ação em rolagem lateral inspirado em *Metal Warriors* (SNES). Mechs low-poly em Three.js renderizados em baixa resolução com paleta de 16 bits, dithering e contornos, câmera lateral.

## Rodar

```bash
npm install
npm run dev        # http://127.0.0.1:5188
npm run build      # typecheck + bundle em dist/
npm run preview    # http://127.0.0.1:4188
```

Requer Node 20.19+ ou 22.x (Vite 6).

## Controles

| Ação | Teclado | Gamepad | Toque |
| --- | --- | --- | --- |
| Mover / mirar | Setas ou WASD | Analógico / D-pad | Direcional |
| Pular / jetpack (segure no ar) | Z, K, Espaço | A | B (amarelo) |
| Atirar | X, J | X ou RT | Y (verde) |
| Sabre (rebate tiros) | C, L | B ou Y | A (vermelho) |
| Escudo | V, I, Shift | LB, RB ou LT | X (azul) |
| Pausa | Esc, P | Select / Start | Botão ❚❚ |

Baixo + pular desce das passarelas. O jetpack e o escudo compartilham a barra de energia.

## Debug e testes

- `http://127.0.0.1:5188/?debug` abre o painel lil-gui (somente em dev).
- `window.__THREE_GAME_TEST_HOOKS__` / `window.__THREE_GAME_DIAGNOSTICS__` expõem estados de teste e métricas.
- `npm test` roda `tests/visual.spec.ts` e `tests/bot-playtest.spec.ts` (Playwright, precisa de Chromium instalado: `npx playwright install --no-shell chromium`).
- `npm run inspect:canvas -- --manifest artifacts/evidence.json --url http://127.0.0.1:5188 --seed 42` gera capturas e relatórios em `artifacts/<runId>/`.
