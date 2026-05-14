# AutoResponder Vercel Webhook

Esta es tu mini-aplicación ligera diseñada específicamente para subir a Vercel. 
Se conectará a tu base de datos Firebase existente y a la API de Gemini para responder automáticamente a los clientes que pregunten "¿Cuánto es X cantidad en Y moneda?".

## Cómo subirla a Vercel

1. **Descarga esta carpeta:**
   Puedes copiar los archivos de esta carpeta (`vercel-autoresponder`) a una carpeta en tu computadora, por ejemplo, `mi-webhook`.

2. **Inicia sesión en Vercel y crea un nuevo proyecto:**
   - Ve a [Vercel.com](https://vercel.com/) y entra con tu cuenta (o Github).
   - En tu Dashboad dale al botón de "Add New..." -> "Project".
   - Puedes subir el repositorio desde GitHub o usar la herramienta de línea de comandos de Vercel (CLI):
     - Abre tu terminal en la computadora en la carpeta `mi-webhook`
     - Escribe: `npm i -g vercel` (si no tienes Vercel CLI instalado)
     - Escribe: `vercel` y sigue los pasos (dale "Yes" a todo).

3. **Configura las Variables de Entorno (Environment Variables) en Vercel:**
   Es el paso más importante. En el panel de control de tu proyecto recién creado en Vercel, ve a **Settings -> Environment Variables** y añade las siguientes claves con sus correspondientes valores que puedes encontrar en el archivo `firebase-applet-config.json` inicial y de tu cuenta de Gemini:

   - `FIREBASE_API_KEY`: tu apiKey
   - `FIREBASE_AUTH_DOMAIN`: tu authDomain
   - `FIREBASE_PROJECT_ID`: tu projectId
   - `FIREBASE_STORAGE_BUCKET`: tu storageBucket
   - `FIREBASE_MESSAGING_SENDER_ID`: tu messagingSenderId
   - `FIREBASE_APP_ID`: tu appId
   - `GEMINI_API_KEY`: Tu clave privada de la API de Google Gemini.

4. **URL de despliegue:**
   Vercel te dará un link parecido a: `https://mi-webhook-app.vercel.app`.
   En tu aplicación AutoResponder en el teléfono, deberás poner esa misma URL en el apartado "Conectar con tu servidor web", quedando la URL así:
   `https://mi-webhook-app.vercel.app/api/webhook`

¡Listo! Eso es todo. Vercel se encargará de mantener la aplicación despierta de forma gratuita (tiene un límite de peticiones altísimo en su plan gratuito), calculando automáticamente todo y comunicándose con Firebase.
