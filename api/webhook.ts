import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { GoogleGenAI } from '@google/genai';

// 1. Configuración de Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// 2. Inicializar Firebase
const apps = getApps();
const app = apps.length === 0 ? initializeApp(firebaseConfig) : apps[0];

// FORZAMOS el uso de la configuración explícita (firebaseConfig) 
// y usamos la base de datos por defecto si la variable FIREBASE_DATABASE_ID está vacía
const db = getFirestore(app, process.env.FIREBASE_DATABASE_ID || undefined);

// 3. Instancia de Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 4. Lógica de Gemini para extraer datos
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
    "amountSource": number | null,
    "amountSourceCurrency": "BRL" | "UNKNOWN",
    "amountDest": number | null
  }
  
  Reglas:
  - "clásica", "dólares" o "usd" es USD. "cup", "pesos" o "mn" es CUP. "mlc" es MLC.
  - Si menciona reales, amountSource es ese número y amountSourceCurrency es BRL.
  - Si el cliente solo pregunta la tasa de cambio en general, ambos falsos.
  - IMPORTANTE: Para COTIZAR (isQuote=true), isOrder debe ser false. Devuelve JSON.`;

  const response = await ai.models.generateContent({
    model: 'gemini-1.5-flash',
    contents: prompt,
  });

  const text = response.text?.replace(/```json/g, '').replace(/```/g, '').trim() || '{}';
  return JSON.parse(text);
};

// 5. Función Serverless de Vercel (webhook)
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).send("✅ Webhook funcionando.");
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { message, sender } = req.body || {};
    if (!message) {
      return res.json({ replies: [] });
    }

    const orderData = await parseClientWhatsAppOrder(message);

    if (!orderData.isQuote) {
      return res.json({ replies: [] });
    }

    // Consultar tasas en Firebase
    const settingsDoc = await getDoc(doc(db, 'settings', 'global'));
    const rates = settingsDoc.exists() ? settingsDoc.data().rates || { CUP: 49, MLC: 0.17, USD: 0.17 } : { CUP: 49, MLC: 0.17, USD: 0.17 };

    const destCurrency = orderData.destinationCurrency === 'UNKNOWN' ? 'CUP' : orderData.destinationCurrency;
    
    let amountBRL = 0;
    let amountDest = 0;
    const isSourceBRL = orderData.amountSourceCurrency === 'BRL' && orderData.amountSource !== null;

    if (isSourceBRL) {
      amountBRL = orderData.amountSource || 0;
      amountDest = amountBRL * (rates[destCurrency] || 1);
      return res.json({ replies: [{ message: `✅ Esos ${amountBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} reales serían: *${amountDest.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${destCurrency}*` }] });
    } else {
      amountDest = orderData.amountDest || 0;
      amountBRL = amountDest / (rates[destCurrency] || 1);
      return res.json({ replies: [{ message: `✅ Esos ${amountDest.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${destCurrency} serían: *R$ ${amountBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} reales*` }] });
    }

  } catch (error: any) {
    console.error("Vercel Webhook Error:", error);
    return res.status(200).json({ 
      replies: [{ message: `❌ Error en el servidor: ${error.message}` }] 
    });
  }
}
