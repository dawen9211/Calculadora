import { db } from '../firebase-config';
import { doc, getDoc } from 'firebase/firestore';
import { GoogleGenAI } from '@google/genai';

// Instancia de Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Misma lógica de Gemini que usamos en la app principal
const parseClientWhatsAppOrder = async (message: string) => {
  const prompt = `Actúa como un extractor de datos de pedidos o cotizaciones financieras.
  El cliente envió el siguiente mensaje por WhatsApp:
  "${message}"
  
  Extrae la siguiente información y devuélvela ÚNICAMENTE en formato JSON plano (sin formato markdown ni explicaciones extras).
  
  Estructura esperada:
  {
    "isOrder": boolean, // true si el mensaje indica que YA quiere hacer la transferencia, enviando datos o diciendo "voy a enviar X".
    "isQuote": boolean, // true si el mensaje es SOLO para preguntar "cuánto es" una cantidad dada de dinero (ej. "240 reales cuantos cup son").
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

// Función Serverless de Vercel (maneja la petición HTTP de AutoResponder)
export default async function handler(req: any, res: any) {
  // CORS provisional por si se llama del navegador
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { message, sender } = req.body;
    if (!message) {
      return res.json({ replies: [] }); // No respondemos nada
    }

    // 1. Entender el mensaje con Gemini
    const orderData = await parseClientWhatsAppOrder(message);

    // 2. Si no es una cotización ("cuanto es X en Y"), no respondemos. Omitimos 'orders' aquí según lo pedido.
    if (!orderData.isQuote) {
      return res.json({ replies: [] });
    }

    // 3. Consultar la tasa de cambio en vivo desde Firebase
    // Nota: El documento "settings/global" debe existir en tu Firebase o debes adaptar el ID a cómo lo tengas guardado.
    const settingsDoc = await getDoc(doc(db, 'settings', 'global'));
    const rates = settingsDoc.exists() ? settingsDoc.data().rates || { CUP: 49, MLC: 0.17, USD: 0.17 } : { CUP: 49, MLC: 0.17, USD: 0.17 };

    // 4. Hacer el cálculo matemático
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

    // 5. Preparar la respuesta para el AutoResponder
    let replyMessage = "";
    if (isSourceBRL) {
      replyMessage = `✅ Esos ${amountBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} reales serían: *${amountDest.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${destCurrency}*`;
    } else {
      replyMessage = `✅ Esos ${amountDest.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${destCurrency} serían: *R$ ${amountBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} reales*`;
    }

    // El formato JSON que espera el AutoResponder
    return res.json({
      replies: [
        { message: replyMessage }
      ]
    });

  } catch (error: any) {
    console.error("Vercel Webhook Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
