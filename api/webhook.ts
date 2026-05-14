import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { GoogleGenAI } from '@google/genai';

// Función Serverless de Vercel (maneja la petición HTTP de AutoResponder)
export default async function handler(req: any, res: any) {
  // CORS por si se llama desde otros dominios
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 🟢 IMPORTANTE: Para probar que funciona cuando entras desde el navegador del celular
  if (req.method === 'GET') {
    return res.status(200).send("✅ Webhook de Vercel funcionando correctamente online. Usa esta ruta en AutoResponder como método POST.");
  }

  // Muerte súbita a cualquier petición que no sea de AutoResponder (POST)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 1. Inicialización Segura (Evita crasheos al arrancar)
    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
    };

    let app;
    if (!getApps().length) {
      app = initializeApp(firebaseConfig);
    } else {
      app = getApp();
    }
    
    // Inicia Firebase con tu ID ('ai-studio-xxxx...'). 'default' es solo por si acaso
    const databaseId = process.env.FIREBASE_DATABASE_ID || '(default)';
    const db = getFirestore(app, databaseId);

    // 2. Cargar motor de IA
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Falta configurar la variable GEMINI_API_KEY en Vercel.");
    }
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // 3. Obtener el texto del cliente de WhatsApp
    const { message } = req.body || {};
    if (!message) {
      return res.json({ replies: [] }); // Si está vacío, no responde.
    }

    // 4. Analizar el WhatsApp inteligentemente
    const prompt = `Actúa como un extractor de datos de pedidos financieros.
    Cliente dijo: "${message}"
    Extrae ÚNICAMENTE JSON:
    {
      "isQuote": boolean, // true si SOLO pregunta "cuánto es" ej. "cuanto son 200 reales"
      "destinationCurrency": "CUP" | "MLC" | "USD" | "UNKNOWN",
      "amountSource": numero_o_null,
      "amountSourceCurrency": "BRL" | "UNKNOWN",
      "amountDest": numero_o_null
    }
    Reglas: 'clásica/usd'=USD, 'cup/mn/pesos'=CUP, 'mlc'=MLC. Reales=BRL. Devuelve solo el JSON válido sin markdown.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const text = response.text?.replace(/```json/g, '').replace(/```/g, '').trim() || '{}';
    const orderData = JSON.parse(text);

    // Si la máquina dictamina que NO es una cotización puntual, el bot se queda callado
    if (!orderData.isQuote) {
      return res.json({ replies: [] });
    }

    // 5. Ir a Firebase a buscar a cómo tienes el cambio hoy
    const settingsDoc = await getDoc(doc(db, 'settings', 'global'));
    const rates = settingsDoc.exists() ? settingsDoc.data().rates || { CUP: 49, MLC: 0.17, USD: 0.17 } : { CUP: 49, MLC: 0.17, USD: 0.17 };

    // 6. Hacer la matemática
    const destCurrency = orderData.destinationCurrency === 'UNKNOWN' ? 'CUP' : orderData.destinationCurrency;
    let amountBRL = 0;
    let amountDest = 0;
    const isSourceBRL = orderData.amountSourceCurrency === 'BRL' && orderData.amountSource !== null;

    if (isSourceBRL) {
      amountBRL = orderData.amountSource || 0;
      amountDest = amountBRL * (rates[destCurrency] || 1);
    } else {
      amountDest = orderData.amountDest || 0;
      amountBRL = amountDest / (rates[destCurrency] || 1);
    }

    // 7. Entregar mensaje al AutoResponder para que lo dispare
    let replyMessage = "";
    if (isSourceBRL) {
      replyMessage = `✅ Esos R$ ${amountBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} reales serían: *${amountDest.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${destCurrency}*`;
    } else {
      replyMessage = `✅ Esos ${amountDest.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${destCurrency} serían: *R$ ${amountBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} reales*`;
    }

    return res.json({
      replies: [
        { message: replyMessage }
      ]
    });

  } catch (error: any) {
    console.error("Vercel Webhook Error:", error);
    // Si algo falla, ahora escupirá el error para arreglarlo fácilmente
    return res.status(500).json({ error: error.message, status: "Fallo interno" });
  }
}
