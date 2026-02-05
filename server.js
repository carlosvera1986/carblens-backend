const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Initialize Anthropic
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok',
        message: 'CarbLens API v1.0 - Running',
        timestamp: new Date().toISOString()
    });
});

// Analyze food endpoint
app.post('/api/analyze', async (req, res) => {
    try {
        const { image, userSettings, currentGlucose } = req.body;

        if (!image) {
            return res.status(400).json({ error: 'No image provided' });
        }

        console.log('📸 Analyzing food...');

        // Extract base64 data
        const base64Data = image.includes('base64,') ? image.split(',')[1] : image;

        // Build prompt
        const prompt = `Eres un endocrinólogo experto especializado en conteo de carbohidratos para personas con diabetes tipo 1. Tu trabajo es CRÍTICO para la salud del paciente.

CONTEXTO DEL USUARIO:
- Nombre: ${userSettings.name || 'Usuario'}
- Ratio de insulina: 1 unidad cada ${userSettings.insulinRatio}g de HC
- Factor de sensibilidad: 1 unidad baja ${userSettings.sensitivityFactor} mg/dL
- Objetivo de glucosa: ${userSettings.targetGlucose} mg/dL
${currentGlucose ? `- Glucosa actual: ${currentGlucose} mg/dL` : '- Glucosa actual: No proporcionada'}

REGLAS ESTRICTAS - SEGURIDAD DEL PACIENTE:

1. SOLO identifica alimentos que puedas ver CLARAMENTE en la imagen
2. Si NO estás seguro de un alimento → NO lo incluyas
3. Si NO puedes ver la porción claramente → estima de forma CONSERVADORA (menos HC)
4. NUNCA inventes alimentos que no están visibles
5. Si la imagen es borrosa o poco clara → indícalo en el mensaje
6. Sé REALISTA con las porciones - no exageres
7. Prefiere SUBESTIMAR carbohidratos que SOBREESTIMAR (más seguro)
8. Si hay duda entre 2 cantidades → elige la MENOR
9. Solo incluye carbohidratos significativos (>1g)

ESTIMACIÓN DE PORCIONES:
- 1 rebanada de pan: 15g HC
- 1 taza de arroz cocido: 45g HC
- 1 papa mediana: 30g HC
- 1 banana mediana: 27g HC
- 1 manzana mediana: 25g HC
- 100g pasta cocida: 25g HC
- Vegetales sin almidón: 0-5g HC

FORMATO DE RESPUESTA:
Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin backticks):

{
  "greeting": "Mensaje breve confirmando lo que ves",
  "imageQuality": "clara/aceptable/poco_clara",
  "confidence": "alta/media/baja",
  "foods": [
    {
      "name": "nombre exacto del alimento visible",
      "amount": "cantidad estimada (ej: 1 rebanada, 1/2 taza, 80g)",
      "carbs": número_conservador,
      "confidence": "alta/media/baja"
    }
  ],
  "totalCarbs": número_total_CONSERVADOR,
  "mealInsulin": {
    "calculation": "Con tu ratio 1u/${userSettings.insulinRatio}g → X unidades (redondeado arriba)",
    "units": número_redondeado_arriba
  },
  "correction": {
    "needed": ${currentGlucose && parseInt(currentGlucose) > userSettings.targetGlucose ? 'true' : 'false'},
    "calculation": "${currentGlucose && parseInt(currentGlucose) > userSettings.targetGlucose ? 'Glucemia actual ' + currentGlucose + ' mg/dL está por encima del objetivo ' + userSettings.targetGlucose + ' mg/dL' : currentGlucose ? 'Glucemia ' + currentGlucose + ' mg/dL dentro del rango objetivo' : 'No se proporcionó glucemia actual'}",
    "units": ${currentGlucose && parseInt(currentGlucose) > userSettings.targetGlucose ? 'número_de_corrección' : '0'}
  },
  "recommendation": {
    "conservative": número_total_menos_05u,
    "standard": número_total_completo,
    "note": "Control en 60-90 min. Si >180 y estable/subiendo → considerar +0.5-1u. Si tendencia a la baja, no agregar."
  },
  "warnings": ["Lista de advertencias si las hay, ej: 'Porción de pasta difícil de estimar', 'Imagen poco clara'"]
}

EJEMPLOS DE RESPUESTAS CORRECTAS:

BUENO ✅:
- "Pan integral: 2 rebanadas → 30g HC" (visible y claro)
- "Banana: 1 mediana → 25g HC" (porción estándar)
- "Arroz: aprox. 1/2 taza → 22g HC" (estimación conservadora)

MALO ❌:
- Incluir "salsa de tomate" si no se ve claramente
- Estimar "2 tazas de pasta" cuando parece menos
- Agregar alimentos no visibles en la imagen

RECUERDA: Es MEJOR subestimar que sobreestimar. El paciente puede corregir después, pero demasiada insulina es peligroso.

Analiza la imagen ahora con MÁXIMA PRECISIÓN y CAUTELA.`;

        // Call Claude API - Using Opus for maximum accuracy
        const message = await anthropic.messages.create({
            model: 'claude-opus-4-20250514',
            max_tokens: 3000,
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/jpeg',
                            data: base64Data,
                        },
                    },
                    {
                        type: 'text',
                        text: prompt
                    }
                ]
            }]
        });

        // Extract response
        const responseText = message.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('');

        console.log('🤖 Claude response received');

        // Clean and parse JSON
        let cleanText = responseText.trim();
        cleanText = cleanText.replace(/```json/g, '').replace(/```/g, '').trim();

        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            cleanText = jsonMatch[0];
        }

        let analysis;
        try {
            analysis = JSON.parse(cleanText);
        } catch (parseError) {
            console.error('❌ JSON parse error:', parseError);
            console.error('Received text:', cleanText.substring(0, 500));
            throw new Error('Invalid AI response format');
        }

        // Validate response
        if (!analysis.foods || !analysis.totalCarbs || !analysis.mealInsulin) {
            throw new Error('Incomplete AI response');
        }

        // Ensure proper rounding
        analysis.mealInsulin.units = Math.ceil(analysis.totalCarbs / userSettings.insulinRatio);

        console.log('✅ Analysis complete');

        res.json({
            success: true,
            analysis: analysis,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error:', error);
        
        res.status(500).json({ 
            error: 'Error analyzing image',
            message: error.message 
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║         🔍 CARBLENS API - SERVER RUNNING             ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝

📡 Port: ${PORT}
🔑 API Key: ${process.env.ANTHROPIC_API_KEY ? '✅ Configured' : '❌ Missing'}
🌍 Endpoints:
   - GET  /
   - POST /api/analyze

💡 Ready to receive requests
    `);
});

module.exports = app;
