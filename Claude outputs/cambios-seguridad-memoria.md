# Tres cambios de código — Ranch Texas y BioSteel

No pude crear las ramas desde aquí: el montaje del portátil no permite que git escriba
`.git/index.lock`, y además los dos repos tienen el árbol sucio (`main` con cambios sin
commitear en Ranch Texas, y 221 archivos marcados como modificados en BioSteel, que casi
seguro son finales de línea CRLF del montaje Windows→Linux, no ediciones tuyas).

Tocar git con el árbol así es como se pierde trabajo. Aquí va la especificación exacta.

---

## Antes de aplicar

En cada repo, con el árbol limpio:

```powershell
cd "D:\Proyectos IA\12 - Ranch Texas" ; git status
```

Si hay cambios tuyos sin commitear, primero commitéalos o guárdalos:

```powershell
cd "D:\Proyectos IA\12 - Ranch Texas" ; git stash push -m "wip antes de rama seguridad"
```

Y crea la rama:

```powershell
cd "D:\Proyectos IA\12 - Ranch Texas" ; git checkout -b opt/seguridad-auditoria
```

---

## Cambio A — Ranch Texas · `scripts/seed.ts`

**Por qué:** hoy el seed crea el administrador con credenciales escritas en el repositorio
si las variables de entorno faltan. En producción faltaban. Debe fallar, no improvisar.

Dentro de `seedUsuarios()`, reemplaza estas dos líneas:

```ts
const usuario = process.env.SEED_ADMIN_USUARIO ?? "admin";
const password = process.env.SEED_ADMIN_PASSWORD ?? "Ranch2026*";
```

por:

```ts
const usuario = process.env.SEED_ADMIN_USUARIO;
const password = process.env.SEED_ADMIN_PASSWORD;
if (!usuario || !password) {
  throw new Error(
    "Faltan SEED_ADMIN_USUARIO y/o SEED_ADMIN_PASSWORD. " +
      "El seed no crea administradores con credenciales por defecto."
  );
}
```

TypeScript estrecha ambos a `string` después del guard, así que `hashPassword(password)`
sigue compilando sin cambios.

**Efecto secundario que debes tener presente:** a partir de aquí, `npm run seed`,
`npm run seed:demo` y `npx prisma db seed` fallan si esas variables no están. Tu `.env`
local ya las tiene. Si algún día siembras una base nueva en Railway, defínelas primero.

---

## Cambio B — Ranch Texas · `lib/auth/actions.ts`

**Por qué:** hoy no queda rastro de quién entra ni de quién lo intenta. Cuando quisimos
saber si alguien había usado la cuenta `admin` expuesta, no hubo forma de responderlo.
Es una app que maneja efectivo y datos personales de visitantes.

**1. Agrega dos imports** al inicio del archivo, junto a los que ya están:

```ts
import { headers } from "next/headers";
import { registrarAuditoria } from "@/lib/audit";
```

**2. Reemplaza la función `login` completa** por esta:

```ts
export async function login(_prev: EstadoLogin | null, formData: FormData): Promise<EstadoLogin> {
  const usuario = String(formData.get("usuario") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!usuario || !password) return { error: "Ingresa usuario y contraseña." };

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;

  const u = await prisma.usuario.findUnique({ where: { usuario } });

  if (!u || !u.activo || !(await verificarPassword(password, u.hash_password))) {
    await registrarAuditoria({
      usuario_id: u?.id ?? null,
      entidad: "usuario",
      entidad_id: u?.id ?? usuario,
      accion: "login_fallido",
      datos_despues: {
        usuario,
        motivo: !u ? "no_existe" : !u.activo ? "inactivo" : "clave_incorrecta",
      },
      ip,
    });
    return { error: "Usuario o contraseña incorrectos." };
  }

  await prisma.usuario.update({
    where: { id: u.id },
    data: { ultimo_ingreso: new Date() },
  });

  await registrarAuditoria({
    usuario_id: u.id,
    entidad: "usuario",
    entidad_id: u.id,
    accion: "login",
    ip,
  });

  await guardarSesion({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol });
  redirect("/");
}
```

Notas de implementación:

- El patrón de la IP es el mismo que ya usas en
  `app/(publico)/consentimiento/[payload]/actions.ts`. No inventé uno nuevo.
- La auditoría va **antes** de `redirect()`. En Next.js `redirect()` lanza una excepción
  de control, así que cualquier cosa después de esa línea no se ejecuta.
- El intento fallido guarda el usuario tecleado y el motivo, **nunca la contraseña**.
- El mensaje devuelto al usuario sigue siendo el mismo para los tres casos, así que no se
  puede enumerar usuarios desde afuera. La distinción solo queda en la auditoría.
- Vale la pena que sepas: esto hace que un atacante pueda inflar `log_auditoria` a punta
  de intentos fallidos. Si algún día expones esta app a internet abierto, ponle un límite
  de intentos por IP — ya tienes `consumir()` en `src/lib/auth/rate-limit.ts` para eso.

**Consulta para usarlo después de desplegar:**

```sql
SELECT l.creado_en, l.accion, l.ip, l.datos_despues->>'usuario' AS usuario_intentado
FROM log_auditoria l
WHERE l.accion IN ('login', 'login_fallido')
ORDER BY l.creado_en DESC
LIMIT 100;
```

---

## Cambio C — BioSteel · `next.config.mjs`

**Por qué:** los picos de memoria de 2 a 7 GB salen de importar Excel dentro del proceso.
`xlsx` carga el libro completo y lo expande a objetos JS; un archivo de 50 MB se convierte
fácilmente en varios GB. Es el techo lo que hay que bajar, no la librería.

```diff
       bodySizeLimit: "50mb",
+      // Los archivos grandes (movimientos de inventario, ventas SIESA completas) se
+      // procesan por script: npm run db:inventario-osteo, db:ventas, db:pendientes.
+      // La vía web queda para archivos de trabajo normales.
-      bodySizeLimit: "50mb",
+      bodySizeLimit: "10mb",
```

Es decir, la línea queda:

```js
bodySizeLimit: "10mb",
```

**Verifica esto antes de mezclar:** el comentario que ya está en tu `next.config.mjs` dice
que los archivos de movimientos de inventario van por `npm run db:inventario-osteo`, pero
menciona que por la web suben "ventas SIESA por mes/año y balances de inventario".
Pregúntale a quien los sube cuánto pesan esos archivos. Si alguno pasa de 10 MB, sube el
límite a 20 MB en vez de 10, o pásalo también a script.

---

## Después de aplicar

```powershell
cd "D:\Proyectos IA\12 - Ranch Texas" ; npm run typecheck ; npm run test
```

```powershell
cd "D:\Proyectos IA\13 - BioSteel" ; npm run typecheck
```

Revisa el diff antes de mezclar:

```powershell
cd "D:\Proyectos IA\12 - Ranch Texas" ; git diff main
```

Y recuerda que el push a `main` dispara el despliegue en Railway. Ranch Texas es taquilla
de un parque: mézclalo fuera del horario de operación.

---

## Cómo revertir

Cada cambio es independiente y se revierte con un `git revert` del commit correspondiente.
El C además se puede deshacer sin desplegar código: no lo hagas por variable de entorno,
`bodySizeLimit` solo se lee del archivo de configuración en tiempo de build.
