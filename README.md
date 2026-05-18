# NFC GO — Pilot

Sistema de caza del tesoro urbana con etiquetas NFC. Un negocio recibe 30 etiquetas con códigos de descuento únicos que se esconden por la ciudad. Los usuarios las escanean, reclaman su premio y lo canjean en el local.

---

## Requisitos

- Node.js ≥ 18
- npm

---

## Instalación local

```bash
# 1. Clonar / descomprimir el repositorio
cd nfc-go-pilot

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Edita .env y cambia ADMIN_PASSWORD

# 4. (Opcional) Cargar datos de ejemplo — La Toscana con 30 etiquetas
npm run seed

# 5. Arrancar el servidor
npm start
# → http://localhost:3000
```

El archivo SQLite (`nfcgo.db`) se crea automáticamente la primera vez.

---

## Variables de entorno (`.env`)

| Variable        | Descripción                                              | Ejemplo                    |
|-----------------|----------------------------------------------------------|----------------------------|
| `PORT`          | Puerto del servidor                                      | `3000`                     |
| `ADMIN_PASSWORD`| Contraseña del panel de administración                   | `mi_clave_segura`          |
| `DATABASE_PATH` | Ruta al archivo SQLite                                   | `./nfcgo.db`               |
| `BASE_URL`      | Dominio público (se usa en URLs del CSV y panel de admin) | `https://nfcgo.app`       |

---

## Uso

### Panel de administración

1. Abre `/admin` → introduce la contraseña.
2. Crea un negocio con nombre, slug, URL de logo y texto de recompensa.
3. Desde la página del negocio, genera N etiquetas con el prefijo que quieras (ej. `TOSC`, cantidad `30`).
4. Descarga o anota los tag UUIDs para programar las etiquetas físicas.
5. Comparte la lista de códigos de descuento con el negocio para que la tenga en mostrador.

### Flujo del usuario

1. Usuario escanea una etiqueta NFC con su móvil.
2. Se abre `https://tudominio.com/c/<tag_uuid>`.
3. Pulsa **Reclamar premio** → aparece el código de descuento (ej. `TOSC-007`).
4. Va al negocio, dice el código, y el negocio lo tacha de su lista.

---

## Despliegue en Render

1. Sube el repositorio a GitHub.
2. En [Render](https://render.com) → **New → Web Service** → conecta el repo.
3. Configuración:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Environment:** Node
4. En la sección **Environment Variables** añade:
   - `ADMIN_PASSWORD` = tu contraseña
   - `DATABASE_PATH` = `./nfcgo.db`
5. En **Disks** (plan pago) o usa el disco efímero del plan gratuito.

> **Importante:** Render borra el sistema de archivos en cada deploy en el plan gratuito.  
> Para persistencia real usa el add-on **Render Disk** o cambia a Railway (ver abajo).

---

## Despliegue en Railway

1. Sube el repositorio a GitHub.
2. En [Railway](https://railway.app) → **New Project → Deploy from GitHub repo**.
3. Railway detecta Node.js automáticamente y usa `npm start`.
4. En **Variables** añade `ADMIN_PASSWORD` y `DATABASE_PATH=./nfcgo.db`.
5. En **Volumes** → añade un volumen montado en `/app` para que `nfcgo.db` persista entre deploys.

---

## Programar las etiquetas NFC físicas

Usa la app **NFC Tools** (Android/iOS):

1. Abre NFC Tools → **Write** → **Add a record** → **URL**.
2. Introduce: `https://tudominio.com/c/<tag_uuid>`  
   (el UUID lo ves en el panel de admin en la columna "Tag UUID").
3. Acerca el teléfono a la etiqueta NFC → escribe.
4. Repite para cada una de las 30 etiquetas.

---

## Estructura de archivos

```
nfc-go-pilot/
├── server.js          # Servidor Express + rutas
├── database.js        # Inicialización SQLite
├── seed.js            # Datos de ejemplo (La Toscana)
├── package.json
├── .env.example
├── views/
│   ├── landing.ejs    # Página pública de la etiqueta
│   ├── admin.ejs      # Panel de administración
│   └── admin-login.ejs
└── public/
    ├── style.css
    └── admin.js       # JS del panel de admin (bulk, filtro, copy, toast)
```

---

## API resumida

| Método | Ruta                                        | Descripción                                          |
|--------|---------------------------------------------|------------------------------------------------------|
| GET    | `/c/:tag_code`                              | Landing pública de la etiqueta                       |
| POST   | `/claim/:tag_code`                          | Reclamar premio (devuelve JSON)                      |
| GET    | `/admin`                                    | Dashboard (requiere auth)                            |
| POST   | `/admin/businesses`                         | Crear negocio                                        |
| POST   | `/admin/businesses/:id/delete`              | **Eliminar negocio y todas sus etiquetas**           |
| GET    | `/admin/businesses/:id`                     | Detalle y etiquetas de un negocio                    |
| POST   | `/admin/businesses/:id/edit`                | Editar negocio                                       |
| POST   | `/admin/businesses/:id/generate`            | Generar N etiquetas                                  |
| POST   | `/admin/businesses/:id/reset-all`           | **Resetear todas las etiquetas a "disponible"**      |
| GET    | `/admin/businesses/:id/export.csv`          | **Exportar etiquetas como CSV**                      |
| POST   | `/admin/businesses/:id/tags/bulk-delete`    | **Eliminar etiquetas seleccionadas (JSON)**          |
| POST   | `/admin/businesses/:id/tags/bulk-reset`     | **Resetear etiquetas seleccionadas (JSON)**          |
| POST   | `/admin/tags/:id/disable`                   | Desactivar etiqueta                                  |
| POST   | `/admin/tags/:id/enable`                    | Activar / resetear etiqueta individual               |
| GET    | `/admin/login`                              | Login                                                |
| GET    | `/admin/logout`                             | Logout                                               |

### Endpoints JSON (bulk actions)

Los endpoints de bulk actions reciben y devuelven JSON:

```js
// Request body
{ "ids": [1, 2, 3] }

// Response — bulk-delete
{ "ok": true, "deleted": 3 }

// Response — bulk-reset
{ "ok": true, "reset": 2 }

// Response — error
{ "error": "Mensaje de error" }
```
