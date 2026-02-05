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
    res.json({ status: 'ok', message: 'CarbLens API Running' });
});

app.post('/api/analyze', async (req, res) => {
    try {
        const { image, userSettings, currentGlucose } = req.body;

        if (!image) {
            return res.status(400).json({ error: 'No image' });
        }

        console.log('Analyzing...');

        const base64Data = image.includes('base64,') ? image.split(',')[1] : image;
        
        const ratio = userSettings.insulinRatio;
        const target = userSettings.targetGlucose;
        const factor = userSettings.sensitivityFactor;
        const glucose = currentGlucose || 0;

        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
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
                        text: 'Eres un experto en diabetes. Analiza esta comida. SOLO identifica lo que VEAS CLARAMENTE. NO inventes. Sé CONSERVADOR con las cantidades (mejor menos que más). Ratio insulina: 1u cada ' + ratio + 'g. Responde SOLO en JSON sin markdown: {"greeting":"texto","confidence":"alta/media/baja","foods":[{"name":"alimento","amount":"cantidad","carbs":numero}],"totalCarbs":numero,"mealInsulin":{"calculation":"explicacion","units":numero},"correction":{"needed":false,"calculation":"","units":0},"recommendation":{"conservative":numero,"standard":numero,"note":"Control en 60-90min"},"warnings":[]}'
                    }
                ]
            }]
        });

        const text = message.content.find(c => c.type === 'text').text;
        let clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const match = clean.match(/\{[\s\S]*\}/);
        if (match) clean = match[0];

        const analysis = JSON.parse(clean);
        
        analysis.mealInsulin.units = Math.ceil(analysis.totalCarbs / ratio);
        
        if (glucose > target) {
            analysis.correction.needed = true;
            const diff = glucose - target;
            analysis.correction.units = Math.round((diff / factor) * 10) / 10;
            analysis.correction.calculation = 'Glucemia ' + glucose + ' sobre objetivo ' + target;
        }
        
        const totalUnits = analysis.mealInsulin.units + (analysis.correction.units || 0);
        analysis.recommendation.conservative = Math.max(0, totalUnits - 0.5);
        analysis.recommendation.standard = totalUnits;

        console.log('Success');

        res.json({ success: true, analysis: analysis });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log('CarbLens API on port', PORT);
});

module.exports = app;
