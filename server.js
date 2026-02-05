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
    res.json({ status: 'ok', message: 'CarbLens API v1.2 - Enhanced Precision' });
});

app.post('/api/analyze', async (req, res) => {
    try {
        const { image, userSettings, currentGlucose } = req.body;

        if (!image) {
            return res.status(400).json({ error: 'No image' });
        }

        console.log('Analyzing with enhanced precision...');

        const base64Data = image.includes('base64,') ? image.split(',')[1] : image;
        
        const ratio = userSettings.insulinRatio;
        const target = userSettings.targetGlucose;
        const factor = userSettings.sensitivityFactor;
        const glucose = currentGlucose || 0;

        const promptText = 'Eres un endocrinologo experto en diabetes tipo 1. Analiza esta comida con PRECISION REALISTA. ' +
        'REGLAS: 1) Identifica SOLO lo visible, 2) Estima porciones observando el tamano del plato (plato estandar=23-25cm), ' +
        '3) Se PRECISO no conservador en exceso, 4) Usa valor MEDIO del rango esperado. ' +
        'REFERENCIAS: Pan 15g/rebanada, Arroz 45g/taza o 23g/media-taza, Pure de papa 35g/taza o 18g/media-taza, ' +
        'Pasta 25g/100g, Papa mediana 30g, Milanesa empanizada 15-20g. ' +
        'Usuario: ratio 1u cada ' + ratio + 'g HC, objetivo ' + target + ' mg/dL, factor ' + factor + ' mg/dL. ' +
        'Responde SOLO JSON sin markdown: ' +
        '{"greeting":"texto","imageQuality":"clara/aceptable/poco_clara","confidence":"alta/media/baja",' +
        '"foods":[{"name":"alimento","amount":"cantidad con unidad","carbs":numero_realista,"confidence":"alta/media/baja"}],' +
        '"totalCarbs":numero_total_realista,"mealInsulin":{"calculation":"explicacion","units":numero},' +
        '"correction":{"needed":false,"calculation":"","units":0},' +
        '"recommendation":{"conservative":numero,"standard":numero,"note":"Control en 60-90min"},' +
        '"warnings":[],"portionNotes":"como estimaste porciones"}';

        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2500,
            temperature: 0.2,
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
                        text: promptText
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
            analysis.correction.calculation = 'Glucemia ' + glucose + ' sobre objetivo ' + target + ' = ' + analysis.correction.units + 'u';
        }
        
        const totalUnits = analysis.mealInsulin.units + (analysis.correction.units || 0);
        analysis.recommendation.conservative = Math.max(0, totalUnits - 0.5);
        analysis.recommendation.standard = totalUnits;
        
        // Mark as editable
        analysis.editable = true;

        console.log('Success:', analysis.totalCarbs + 'g HC');

        res.json({ success: true, analysis: analysis });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log('CarbLens API v1.2 on port', PORT);
});

module.exports = app;
