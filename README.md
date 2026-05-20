# Price Tracker · MCO55762680

Monitorea el precio de `mercadolibre.com.co/p/MCO55762680` cada **6 horas**
y envía una alerta de WhatsApp cada vez que el precio cambia.

---

## Deploy en Render (paso a paso)

### Paso 1 — Levanta OpenWA

Ya tienes una instancia disponible:

- URL: `https://openwa-vd0n.onrender.com/`
- API Key: `dev-admin-key`
- Sesión: `default`

Si necesitas abrir o reconectar la sesión, entra al dashboard de OpenWA, inicia `default` y escanea el QR con tu WhatsApp.

### Paso 2 — Levanta este price tracker

1. Sube esta carpeta a un repo tuyo en GitHub
2. En Render → **New + → Web Service** → conecta tu repo
3. Configura:

```
Node Version: 20
Build Command: npm install
Start Command: npm start
```

4. Agrega estas variables de entorno:

```
OPENWA_URL      = https://openwa-vd0n.onrender.com
OPENWA_API_KEY  = dev-admin-key
OPENWA_SESSION  = default
PORT            = 3000
```

5. Opcional pero recomendado: crea un **Persistent Disk** y usa una ruta para la base SQLite, por ejemplo:

```
DB_PATH=/var/data/tracker.db
```

Sin disco persistente, Render puede reiniciar la app y perder el historial y el número configurado.

6. Abre el dominio público del servicio cuando termine el deploy

### Si Render falla al compilar

Si en los logs ves que Render intenta usar Node 26, la compilación de `better-sqlite3` puede fallar. Este repo debe correr con **Node 20**.

- Verifica que Render tome el `engines.node` del `package.json`
- Si tu servicio ya estaba creado, fuerza en Settings la versión `20`
- Usa `npm install` como build command en lugar del valor automático

### Paso 3 — Configura tu número

En el dashboard web del tracker, ingresa tu número de WhatsApp colombiano:
- Formato: `+57 300 123 4567`
- Haz clic en **Guardar**

Listo. El tracker revisa el precio al arrancar y luego cada 6 horas.
Cada vez que el precio cambia, te llega un mensaje de WhatsApp.

---

## Comportamiento

- **Al iniciar**: hace una revisión inmediata del precio
- **Cada 6 horas**: revisa automáticamente (`cron: 0 */6 * * *`)
- **Alerta**: se envía solo cuando el precio **cambia** respecto al chequeo anterior
- **Botón "Revisar ahora"**: fuerza una revisión manual desde el dashboard

---

## Estructura

```
price-tracker/
├── src/server.js      ← backend: scraper + cron + API
├── public/index.html  ← dashboard web
├── package.json
└── .env.example
```
