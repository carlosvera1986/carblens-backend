const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

app.get('/', (req, res) => {
    res.json({ 
        status: 'ok',
        message: 'CarbLens API v1.1',
        timestamp: new Date().toISOString()
    });
});

app.post('/api/analyze', async (req, res) => {
    try {
        const { image, userSettings, currentGlucose } = req.body;

        if (!image) {
            return res.status(400).json({ error: 'No image provided' });
        }

        console.log('📸 Analyzing food...');

        const base64Data = image.includes('base64,') ? image.split(',')[1] : image;

        const glucoseInfo = currentGlucose ? `Glucosa actual: ${currentGlucose} mg/dL` : 'Glucosa actual: No proporcionada';
        const needsCorrection = currentGlucose && parseInt(currentGlucose) > userSettings.targetGlucose;

        const prompt = `Eres un endocrinólogo experto en conteo de carbohidratos para diabetes tipo 1.

CONTEXTO DEL USUARIO:
- Ratio de insulina: 1u cada ${userSettings.insulinRatio}g HC
- Factor de sensibilidad: 1u baja ${userSettings.sensitivityFactor} mg/dL
- Objetivo de glucosa: ${userSettings.targetGlucose} mg/dL
- ${glucoseInfo}

REGLAS CRÍTICAS:
1. SOLO identifica alimentos CLARAMENTE visibles
2. Si hay DUDA → NO incluyas el alimento
3. Estimaciones CONSERVADORAS (prefiere menos HC)
4. NUNCA inventes alimentos
5. Si imagen borrosa → indica advertencia
6. Sé REALISTA con porciones
7. PREFIERE SUBESTIMAR que SOBREESTIMAR
8. Solo carbohidratos >1g

REFERENCIAS:
- Pan: 15g HC/rebanada
- Arroz cocido: 45g HC/taza
- Pasta cocida: 25g HC/100g
- Papa mediana: 30g HC
- Banana: 27g HC
- Manzana: 25g HC
- Tortilla maíz: 12g HC
- Tortilla harina: 20g HC

RESPONDE EN JSON (sin markdown):

{
  "greeting": "Lo que ves brevemente",
  "imageQuality": "clara/aceptable/poco_clara",
  "confidence": "alta/media/baja",
  "foods": [
    {
      "name": "nombre exacto",
      "amount": "cantidad",
      "carbs": numero,
      "confidence": "alta/media/baja"
    }
  ],
  "totalCarbs": numero_total,
  "mealInsulin": {
    "calculation": "Explicación del cálculo",
    "units": numero_redondeado_arriba
  },
  "correction": {
    "needed": ${needsCorrection},
    "calculation": "Explicación si aplica",
    "units": numero
  },
  "recommendation": {
    "conservative": numero_menor,
    "standard": numero_normal,
    "note": "Control en 60-90 min"
  },
  "warnings": ["advertencias si existen"]
}

RECUERDA: Mejor quedarse corto que pasarse. Analiza con máxima precisión.`;

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

        const responseText = message.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('');

        console.log('🤖 Response received');

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
            console.error('❌ Parse error:', parseError);
            throw new Error('Invalid response format');
        }

        if (!analysis.foods || !analysis.totalCarbs || !analysis.mealInsulin) {
            throw new Error('Incomplete response');
        }

        analysis.mealInsulin.units = Math.ceil(analysis.totalCarbs / userSettings.insulinRatio);

        if (!analysis.recommendation.conservative) {
            const total = analysis.mealInsulin.units + (analysis.correction?.units || 0);
            analysis.recommendation.conservative = Math.max(0, total - 0.5);
            analysis.recommendation.standard = total;
        }

        console.log('✅ Success:', {
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

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🔍 CARBLENS API v1.1 - RUNNING     ║
╚═══════════════════════════════════════╝
Port: ${PORT}
API Key: ${process.env.ANTHROPIC_API_KEY ? '✅' : '❌'}
Ready!
    `);
});

module.exports = app;
