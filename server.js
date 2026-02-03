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
        const prompt = `Analiza esta imagen de comida como un endocrinólogo experto en diabetes.

Usuario: ${userSettings.name || 'Usuario'}
Ratio de insulina: 1u cada ${userSettings.insulinRatio}g HC
Factor de sensibilidad: 1u baja ${userSettings.sensitivityFactor} mg/dL
Objetivo de glucosa: ${userSettings.targetGlucose} mg/dL
${currentGlucose ? `Glucosa actual: ${currentGlucose} mg/dL` : 'Glucosa actual: No proporcionada'}

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin backticks) en este formato:

{
  "greeting": "mensaje breve y amigable",
  "foods": [
    {"name": "nombre del alimento", "amount": "cantidad estimada", "carbs": número}
  ],
  "totalCarbs": número_total,
  "mealInsulin": {
    "calculation": "Con tu ratio 1u/${userSettings.insulinRatio}g → X unidades",
    "units": número_redondeado_arriba
  },
  "correction": {
    "needed": ${currentGlucose && parseInt(currentGlucose) > userSettings.targetGlucose ? 'true' : 'false'},
    "calculation": "${currentGlucose ? 'Glucemia: ' + currentGlucose + ' mg/dL, Objetivo: ' + userSettings.targetGlucose + ' mg/dL' : ''}",
    "units": número_o_0
  },
  "recommendation": {
    "conservative": número,
    "standard": número,
    "note": "Control en 60-90 min. Si >180 y estable → +0.5-1u. Si flecha ↓, no agregar."
  }
}

IMPORTANTE:
- Identifica TODOS los alimentos visibles en la imagen
- Calcula carbohidratos de manera REALISTA y PRECISA
- SIEMPRE redondea la insulina por comida HACIA ARRIBA (Math.ceil)
- Si la glucosa actual está por encima del objetivo, calcula la corrección
- Sé preciso y profesional como un endocrinólogo experimentado`;

        // Call Claude API
        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2048,
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