import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { GoogleGenAI } from '@google/genai';

// 1. Configuración de Firebase (Se lee de Vercel Environment Variables)
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// 2. Inicializar Firebase de forma segura
const apps = getApps();
const app = apps.length === 0 ? initializeApp(firebaseConfig) : apps[0];
const db = getFirestore(app, process.env.FIREBASE_DATABASE_ID);

// 3. Instancia de Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 4. Lógica de IA para entender monedas
const parseClientWhatsAppOrder = async (message: string) => {
  const prompt = `Actúa como un extractor de datos de pedidos o cotizaciones financieras.
  El cliente envió el siguiente mensaje por WhatsApp:
  "${message}"
  
  Extrae la siguiente información y devuélvela ÚNICAMENTE en formato JSON plano (sin formato markdown ni explicaciones extras).
  
  Estructura esperada:
  {
    "isOrder": boolean,
    "isQuote": boolean,
    "destinationCurrency": "CUP" | "MLC" | "USD" | "UNKNOWN",
    "amountSource": numero_o_null,
    "amountSourceCurrency": "BRL" | "UNKNOWN",
    "amountDest": numero_o_null
  }
  
  Reglas:
  - Manejo de dicción: "clásica", "dólares" o "usd" es USD. "cup", "pesos" o "mn" es CUP. "mlc" es MLC.
  - Si el cliente menciona reales, amountSource es ese número y amountSourceCurrency es BRL, amountDest null. Si menciona destino, setea destinationCurrency.
  - Si el cliente dice XYZ cup/mlc/usd, entonces amountDest es XYZ, destinationCurrency es la respectiva, y amountSource es null.
  - Si el cliente solo pregunta la tasa de cambio en general, establece isOrder: false e isQuote: false.
  - IMPORTANTÍSIMO: Si el mensaje es para COTIZAR (isQuote=true), isOrder debe ser false. Si es saludo genérico, ambos falsos.
  - Devuelve exclusivamente el JSON.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  const text = response.text?.replace(/```json/g, '').replace(/```/g, '').trim() || '{}';
  return JSON.parse(text);
};

// 5. Función Serverless de Vercel
export default async function handler(req: any, res: any) {
  // CORS 
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Responder en navegador para confirmar
  if (req.method === 'GET') {
    return res.status(200).send("✅ Webhook de Vercel funcionando correctamente.");
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { message, sender } = req.body || {};
    if (!message) {
      return res.json({ replies: [] }); // No respondemos
    }

    // A. Entender el mensaje
    const orderData = await parseClientWhatsAppOrder(message);

    // B. Si no es cotización, callamos.
    if (!orderData.isQuote) {
      return res.json({ replies: [] });
    }

    // C. Ver datos en Fireabse
    const settingsDoc = await getDoc(doc(db, 'settings', 'global'));
    const rates = settingsDoc.exists() ? settingsDoc.data().rates || { CUP: 49, MLC: 0.17, USD: 0.17 } : { CUP: 49, MLC: 0.17, USD: 0.17 };

    // D. Calcular
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

    // E. Generar mensaje
    let replyMessage = "";
    if (isSourceBRL) {
      replyMessage = `✅ Esos ${amountBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} reales serían: *${amountDest.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${destCurrency}*`;
    } else {
      replyMessage = `✅ Esos ${amountDest.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${destCurrency} serían: *R$ ${amountBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} reales*`;
    }

    // Retorno al bot
    return res.json({
      replies: [
        { message: replyMessage }
      ]
    });

  } catch (error: any) {
    console.error("Webhook Error:", error);
    // IMPORTANTE: Devuelve error 200 para que se imprima textualmente en el chat
    return res.status(200).json({ 
      replies: [
        { message: `❌ Error en Vercel: ${error.message}` }
      ] 
    });
  }
}
