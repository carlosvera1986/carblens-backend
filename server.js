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
        message: 'CarbLens API v1.1 - Running',
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

        console.log('📸 Analyzing food with enhanced medical prompt...');

        // Extract base64 data
        const base64Data = image.includes('base64,') ? image.split(',')[1] : image;

        // Enhanced medical prompt
        const prompt = `Eres un endocrinólogo experto especializado en conteo de carbohidratos para personas con diabetes tipo 1. Tu análisis es CRÍTICO para la seguridad del paciente.

CONTEXTO DEL USUARIO:
- Nombre: ${userSettings.name || 'Usuario'}
- Ratio de insulina: 1 unidad cada ${userSettings.insulinRatio}g de HC
- Factor de sensibilidad: 1 unidad baja ${userSettings.sensitivityFactor} mg/dL
- Objetivo de glucosa: ${userSettings.targetGlucose} mg/dL
${currentGlucose ? `- Glucosa actual: ${currentGlucose} mg/dL` : '- Glucosa actual: No proporcionada'}

REGLAS CRÍTICAS DE SEGURIDAD:

1. ✅ SOLO identifica alimentos CLARAMENTE VISIBLES
2. ✅ Si hay DUDA sobre un alimento → NO lo incluyas
3. ✅ Si la porción NO es clara → estima CONSERVADORAMENTE (menos HC)
4. ✅ NUNCA inventes alimentos no visibles
5. ✅ Si la imagen es borrosa → indícalo como advertencia
6. ✅ Sé REALISTA con porciones - no exageres
7. ✅ PREFIERE SUBESTIMAR que SOBREESTIMAR (más seguro)
8. ✅ Entre dos cantidades → elige la MENOR
9. ✅ Solo incluye carbohidratos significativos (>1g HC)
10. ✅ Vegetales sin almidón → máximo 5g HC

REFERENCIA DE PORCIONES ESTÁNDAR:
- Pan blanco/integral: 15g HC por rebanada
- Arroz blanco cocido: 45g HC por taza (200g)
- Pasta cocida: 25g HC por 100g
- Papa mediana: 30g HC
- Banana mediana: 27g HC
- Manzana mediana: 25g HC
- Tortilla de maíz: 12g HC
- Tortilla de harina: 20g HC
- Yogurt natural: 12g HC por 200ml
- Leche: 12g HC por taza

FORMATO DE RESPUESTA (JSON válido, sin markdown):

{
  "greeting": "Confirmación breve de lo que ves",
  "imageQuality": "clara/aceptable/poco_clara",
  "confidence": "alta/media/baja",
  "foods": [
    {
      "name": "nombre exacto",
      "amount": "cantidad específica",
      "carbs": número_conservador,
      "confidence": "alta/media/baja"
    }
  ],
  "totalCarbs": suma_total_conservadora,
  "mealInsulin": {
    "calculation": "Con tu ratio 1u/${userSettings.insulinRatio}g → X unidades",
    "units": ${Math.ceil(45 / userSettings.insulinRatio)}
  },
  "correction": {
    "needed": ${currentGlucose && parseInt(currentGlucose) > userSettings.targetGlucose ? 'true' : 'false'},
    "calculation": "${currentGlucose && parseInt(currentGlucose) > userSettings.targetGlucose ? 'Glucemia ' + currentGlucose + ' por encima de objetivo ' + userSettings.targetGlucose : currentGlucose ? 'Glucemia ' + currentGlucose + ' en rango' : 'Sin dato de glucemia'}",
    "units": ${currentGlucose && parseInt(currentGlucose) > userSettings.targetGlucose ? Math.round((parseInt(currentGlucose) - userSettings.targetGlucose) / userSettings.sensitivityFactor * 10) / 10 : 0}
  },
  "recommendation": {
    "conservative": número_menor,
    "standard": número_estándar,
    "note": "Control en 60-90 min. Si >180 y estable → +0.5-1u. Si baja → no agregar."
  },
  "warnings": ["Lista de advertencias si existen"]
}

EJEMPLOS:

✅ CORRECTO:
- "Pan: 2 rebanadas visibles → 30g HC" 
- "Arroz: aproximadamente 1/2 taza → 22g HC"
- "Banana: 1 mediana completa → 27g HC"

❌ INCORRECTO:
- Agregar "mayonesa" si no se ve
- "2 tazas de arroz" cuando parece menos
- Incluir alimentos fuera de la imagen

PRINCIPIO FUNDAMENTAL: Más vale quedarse corto que pasarse. El paciente puede corregir, pero exceso de insulina es peligroso.

Analiza la imagen CON MÁXIMA PRECISIÓN Y CAUTELA:`;

        // Call Claude API with Sonnet 4 (stable and accurate)
        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 3000,
            temperature: 0.3,
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

        console.log('🤖 Response received from Claude');

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
            console.error('Received:', cleanText.substring(0, 500));
            throw new Error('Invalid AI response format');
        }

        // Validate response
        if (!analysis.foods || !analysis.totalCarbs || !analysis.mealInsulin) {
            throw new Error('Incomplete AI response');
        }

        // Ensure proper rounding (ALWAYS round UP for safety)
        analysis.mealInsulin.units = Math.ceil(analysis.totalCarbs / userSettings.insulinRatio);

        // Ensure conservative and standard recommendations exist
        if (!analysis.recommendation.conservative) {
            analysis.recommendation.conservative = Math.max(0, analysis.mealInsulin.units + (analysis.correction?.units || 0) - 0.5);
        }
        if (!analysis.recommendation.standard) {
            analysis.recommendation.standard = analysis.mealInsulin.units + (analysis.correction?.units || 0);
        }

        console.log('✅ Analysis complete:', {
            foods: analysis.foods.length,
            totalCarbs: analysis.totalCarbs,
            confidence: analysis.confidence
        });

        res.json({
            success: true,
            analysis: analysis,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
        
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
║         🔍 CARBLENS API v1.1 - RUNNING               ║
║              Enhanced Medical Accuracy                ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝

📡 Port: ${PORT}
🔑 API Key: ${process.env.ANTHROPIC_API_KEY ? '✅ Configured' : '❌ Missing'}
🤖 Model: Claude Sonnet 4 (Medical Grade)
🌍 Endpoints:
   - GET  /
   - POST /api/analyze

💡 Ready for medical-grade food analysis
    `);
});

module.exports = app;
