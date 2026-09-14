# Prompt para Claude Code — auditoría de un repo antes de activar Serverless

Uso: abre el repo en Claude Code y pega el bloque de abajo. Uno por repo, empezando
por `flujo-personal` o `Linum` (los dos pilotos baratos). No lo corras en `biosteel`
todavía: ese tiene su propio prompt al final.

---

## Prompt A — Diagnóstico (no modifica nada)

```
Este repositorio está desplegado en Railway con PostgreSQL. Quiero activar la opción
Serverless (app-sleeping) de Railway en este servicio, y necesito saber si el proceso
es capaz de quedarse completamente callado.

Dato clave que determina todo el análisis: Railway NO duerme un servicio por falta de
visitas. Lo duerme tras ~5 minutos sin que el proceso EMITA tráfico saliente. Cualquier
paquete que salga —una consulta a la base, un ping de telemetría, un keepalive, una
llamada a otro servicio— reinicia el contador y el servicio nunca duerme.

Analiza el repositorio y entrégame un diagnóstico. NO modifiques nada todavía.

1. FRAMEWORK Y ARRANQUE
   - Framework, versión, comando de arranque real (package.json scripts, Procfile,
     railway.json/toml, Dockerfile).
   - ¿Corre en modo desarrollo o producción? ¿Cuántos workers/procesos levanta?
   - Qué se carga en memoria durante el arranque: datasets, JSON grandes, plantillas,
     modelos, cachés precalentadas.

2. FUENTES DE TRÁFICO SALIENTE PERIÓDICO — esto es lo que impide dormir
   Busca y lista con archivo y línea:
   - setInterval / setTimeout recursivos / node-cron / cron / croner / agenda /
     bree / APScheduler / celery beat
   - Pools de base de datos: pg, Prisma, TypeORM, Sequelize, Drizzle. Reporta la
     configuración exacta: tamaño del pool, idleTimeoutMillis, keepAlive,
     allowExitOnIdle, connection_limit y pool_timeout en la URL de Prisma.
   - Clientes de Redis / BullMQ / colas que hacen polling o BLPOP.
   - WebSockets, Server-Sent Events, suscripciones abiertas.
   - Telemetría y APM: Sentry, PostHog, OpenTelemetry, New Relic, LogRocket,
     heartbeats propios.
   - Cualquier fetch/axios dentro de un intervalo, watcher de archivos o healthcheck
     que el propio proceso se haga a sí mismo.

3. CRON INTERNOS
   Para cada tarea programada que viva dentro del proceso web:
   - archivo y función, expresión horaria, zona horaria, duración estimada
   - tablas que toca y si el efecto es idempotente
   - qué pasa si falla a la mitad, y si hay bloqueo contra doble ejecución

4. MEMORIA EN REPOSO
   Qué mantiene el proceso ocupado cuando nadie lo usa: cachés en memoria,
   resultados de consultas acumulados, librerías pesadas cargadas siempre
   (puppeteer, playwright, chromium, sharp, canvas, pandas, xlsx completos),
   conexiones sin cerrar.

5. VEREDICTO
   Responde explícitamente: ¿este servicio puede quedarse 5 minutos sin emitir un
   solo paquete? Si la respuesta es no, lista en orden qué habría que cambiar para
   que sí, marcando cuáles son reversibles en un commit y cuáles requieren rediseño.

Entrega el diagnóstico en markdown. No toques el código en este paso.
```

---

## Prompt B — Cambios (después de leer el diagnóstico)

```
Con base en el diagnóstico anterior, crea la rama `opt/serverless` y aplica los
cambios en commits separados, uno por tema, en este orden:

1. Cerrar las conexiones ociosas de PostgreSQL. El pool debe soltar las conexiones
   tras un periodo corto de inactividad y volver a abrirlas cuando llegue la
   siguiente petición.
2. Quitar o condicionar por variable de entorno la telemetría, el polling y los
   heartbeats que no sean imprescindibles en producción.
3. Convertir cada cron interno en un endpoint HTTP protegido:
   - ruta `POST /api/cron/<nombre>`
   - valida `Authorization: Bearer <CRON_TOKEN>` contra una variable de entorno,
     comparando con comparación de tiempo constante
   - devuelve 409 si ya hay una ejecución en curso (bloqueo por fila en base de
     datos, no por variable en memoria: con Serverless el proceso muere)
   - loguea inicio, fin y duración
   - responde 200 con un resumen en JSON de lo que hizo
   El cron interno se queda en el código, desactivado por variable de entorno, hasta
   que el reemplazo esté probado.
4. Añade una línea de log al arrancar con el RSS del proceso, para poder comparar
   la línea base antes y después.

Reglas: un cambio por commit, sin tocar la lógica de negocio, sin exponer secretos
en el código ni en los logs. Al final documenta en `OPTIMIZACION.md` qué cambió,
qué variables de entorno nuevas hacen falta y cómo revertir cada commit.
```

---

## Prompt C — Solo para `biosteel`

```
Este servicio consume 796 MB de memoria residente en reposo, un fin de semana
completo sin despliegues ni usuarios, con un uso de CPU de 0,13 vCPU. La mediana del
mes fue 576 MB y el percentil 95 llegó a 2.937 MB, con un pico de 6.811 MB.

El objetivo es entender de dónde salen esos 796 MB fijos. No es tráfico: es algo que
se carga y no se suelta.

Revisa en este orden y reporta con archivo y línea:
1. Qué se ejecuta entre el arranque del proceso y el momento en que queda escuchando:
   lecturas de archivos, consultas que traen tablas completas, cachés precalentadas,
   índices en memoria, plantillas compiladas.
2. Librerías pesadas cargadas al importar en vez de bajo demanda: chromium/puppeteer,
   playwright, sharp, canvas, pdfkit, exceljs, motores de reportes.
3. Si está corriendo en modo desarrollo, con source maps, o con más de un worker.
4. Estructuras que crecen sin techo: mapas de caché sin TTL ni límite de tamaño,
   arreglos de logs, sesiones en memoria, resultados de consultas acumulados.
5. Los picos diurnos de 2 a 7 GB: qué operación los produce y si esa operación puede
   procesarse por lotes o en streaming en vez de cargar todo en memoria.

Entrega primero el diagnóstico con una estimación de cuántos MB aporta cada causa.
No modifiques nada todavía. La meta es bajar la línea base a 250 MB.
```

---

## Orden de trabajo

1. `flujo-personal` — piloto. Prompt A, luego B. Activar Serverless. Medir 72 horas.
2. Si el piloto funciona, replicar en las demás apps internas, de a una.
3. `biosteel` — Prompt C, aparte y sin prisa. Es el 16% de la factura.

## Cómo medir si funcionó

En Railway, servicio → pestaña **Metrics**, ventana de 7 días:

- **Memoria**: debe aparecer serrucho —cae a cero en las horas sin uso— en vez de una
  línea plana 24/7. Una línea plana significa que el servicio no está durmiendo y que
  algo sigue emitiendo tráfico saliente.
- **Confirmación de que duerme**: pasados 10 minutos sin tocar la app, el primer
  request debe tardar unos segundos o devolver 502 y funcionar al reintentar. Si
  responde instantáneo siempre, nunca se durmió.
- **Cron**: revisar en GitHub que el workflow terminó en verde y en los logs de Railway
  que la tarea se ejecutó una sola vez.
