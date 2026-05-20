# Price Tracker · MCO55762680

Monitorea el precio de `mercadolibre.com.co/p/MCO55762680` cada **6 horas**
y envía una alerta de WhatsApp cada vez que el precio cambia.

---

## Deploy en Railway (paso a paso)

### Paso 1 — Levanta OpenWA

1. En Railway → **New Project → Deploy from GitHub Repo**
2. Repo: `https://github.com/rmyndharis/OpenWA`
3. Una vez desplegado, abre el dashboard de OpenWA en el puerto `2886`
4. Crea una sesión llamada `default`, haz clic en **Start** y escanea el QR con tu WhatsApp
5. Ve a **Settings → API Keys** → crea una key y cópiala

### Paso 2 — Levanta este price tracker

1. Sube esta carpeta a un repo tuyo en GitHub
2. En Railway → **New Project → Deploy from GitHub Repo** → tu repo
3. Agrega estas variables de entorno en **Variables**:

```
OPENWA_URL      = https://tu-openwa.up.railway.app
OPENWA_API_KEY  = la_key_del_paso_1
OPENWA_SESSION  = default
```

4. Railway detecta el `package.json` y corre `npm start` solo
5. En **Settings → Networking** genera un dominio público y ábrelo

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
