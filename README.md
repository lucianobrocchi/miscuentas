# Mis Cuentas

App para planificar el flujo de plata de una familia y salir de la deuda de la tarjeta.
Muestra mes a mes cuánto sobra o falta, cuándo se libera cada cuota y cada deuda, y permite
probar un gasto nuevo antes de hacerlo ("¿me lo puedo permitir?").

- Web app estática. Los datos se guardan en el dispositivo (localStorage) y, si se configura, se comparten entre los celulares de la familia con una función serverless y un Vercel Blob privado: ver `docs/sync.md`.
- `src/engine.js`: motor de proyección (puro, testeado). `npm test`
- `npm start` y abrir http://localhost:8080
