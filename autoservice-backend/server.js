// server.js

const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');
require('dotenv').config({ path: './api.env' });

const app = express();
app.use(express.json());

const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: process.env.DB_PASSWORD,
    database: 'autoservice_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Обработка текстовой команды
app.post('/api/process-command', async (req, res) => {
    const { command } = req.body;

    console.log("Processing text command:", command);

    const prompt = `
Преобразуй следующую команду на русском языке в структурированный JSON в указанном формате. Используй **только** информацию из команды. Не добавляй никаких дополнительных данных или вымышленных элементов.

Команда: "${command}"

Требования:

1. Разбери команду на отдельные действия, если их несколько.
2. Для каждой команды верни объект в следующем формате:

{
  "manufacturer": "<производитель>",
  "part": "<деталь>",
  "model": "<модель или кузов>",
  "quantity": <количество>,
  "action": "<add или remove>"
}

3. Используй русский язык для всех полей и значений.
4. **Не придумывай данные**, отсутствующие в команде.
5. Ответ должен быть строго в формате JSON, без дополнительного текста или комментариев.

Пример ответа:

{
  "changes": [
    {
      "manufacturer": "BMW",
      "part": "заднее крыло",
      "model": "",
      "quantity": 1,
      "action": "add"
    }
  ]
}
`;

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 500,
                temperature: 0,
                n: 1
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                }
            }
        );

        const rawResponse = response.data.choices[0].message.content;
        console.log("OpenAI API Response (text command):", rawResponse);

        let structuredResponse;
        try {
            structuredResponse = JSON.parse(rawResponse.trim());
        } catch (parseError) {
            console.error("Ошибка парсинга JSON:", parseError);
            res.status(500).json({ error: "Ошибка парсинга ответа OpenAI" });
            return;
        }

        if (structuredResponse && structuredResponse.changes) {
            res.json({ changes: structuredResponse.changes });
        } else {
            console.error("Поле 'changes' не найдено в ответе OpenAI");
            res.status(500).json({ error: "Поле 'changes' не найдено в ответе OpenAI" });
        }
    } catch (error) {
        console.error("Ошибка при обращении к OpenAI:", error.message);
        res.status(500).json({ error: "Ошибка обработки команды" });
    }
});

// Обработка голосовой команды
app.post('/api/voice-command', upload.single('audio'), async (req, res) => {
    const originalFilePath = req.file.path;

    try {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(originalFilePath));
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'json');
        formData.append('language', 'ru');

        const whisperResponse = await axios.post(
            'https://api.openai.com/v1/audio/transcriptions',
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            }
        );

        console.log("Full Whisper API response:", whisperResponse.data);

        const commandText = whisperResponse.data.text?.trim();
        if (!commandText) {
            console.error("Whisper API не вернул ожидаемый текст.");
            res.status(500).json({ error: "Ошибка при распознавании речи: отсутствует текст" });
            return;
        }

        console.log("Extracted commandText from Whisper:", commandText);

        const prompt = `
Преобразуй следующую команду на русском языке в структурированный JSON в указанном формате. Используй **только** информацию из команды. Не добавляй никаких дополнительных данных или вымышленных элементов.

Команда: "${commandText}"

Требования:

1. Разбери команду на отдельные действия, если их несколько.
2. Для каждой команды верни объект в следующем формате:

{
  "manufacturer": "<производитель>",
  "part": "<деталь>",
  "model": "<модель или кузов>",
  "quantity": <количество>,
  "action": "<add или remove>"
}

3. Используй русский язык для всех полей и значений.
4. **Не придумывай данные**, отсутствующие в команде.
5. Ответ должен быть строго в формате JSON, без дополнительного текста или комментариев.

Пример ответа:

{
  "changes": [
    {
      "manufacturer": "BMW",
      "part": "заднее крыло",
      "model": "",
      "quantity": 1,
      "action": "add"
    }
  ]
}
`;

        console.log("Generated prompt for OpenAI (voice command):", prompt);

        const openAIResponse = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 500,
                temperature: 0,
                n: 1
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                }
            }
        );

        const rawResponse = openAIResponse.data.choices[0].message.content;
        console.log("OpenAI API Response (voice command):", rawResponse);

        let structuredResponse;
        try {
            structuredResponse = JSON.parse(rawResponse.trim());
        } catch (parseError) {
            console.error("Ошибка парсинга JSON:", parseError);
            res.status(500).json({ error: "Ошибка парсинга ответа OpenAI" });
            return;
        }

        if (structuredResponse && structuredResponse.changes) {
            res.json({ changes: structuredResponse.changes, commandText });
        } else {
            console.error("Поле 'changes' не найдено в ответе OpenAI");
            res.status(500).json({ error: "Поле 'changes' не найдено в ответе OpenAI" });
        }

    } catch (error) {
        console.error("Ошибка при обработке команды:", error.message);
        res.status(500).json({ error: "Ошибка при обработке команды" });
    } finally {
        if (fs.existsSync(originalFilePath)) fs.unlinkSync(originalFilePath);
    }
});

// Выполнение изменений
app.post('/api/execute-changes', async (req, res) => {
    const { changes } = req.body;

    try {
        for (const change of changes) {
            const { manufacturer, part, model, quantity, action } = change;
            const qtyChange = action === 'add' ? (quantity || 1) : -(quantity || 1);

            // Проверка существования детали в базе данных
            const [existingParts] = await db.execute(
                'SELECT id, quantity FROM parts WHERE manufacturer = ? AND part = ? AND model = ?',
                [manufacturer, part, model]
            );

            if (existingParts.length > 0) {
                // Если деталь найдена, обновляем количество
                const partId = existingParts[0].id;
                const newQuantity = existingParts[0].quantity + qtyChange;

                if (newQuantity >= 0) {
                    await db.execute(
                        'UPDATE parts SET quantity = ? WHERE id = ?',
                        [newQuantity, partId]
                    );
                } else {
                    console.error(`Недостаточно количества для удаления: ${manufacturer} ${part} ${model}`);
                }
            } else if (action === 'add') {
                // Добавляем новую деталь
                await db.execute(
                    'INSERT INTO parts (manufacturer, part, model, quantity) VALUES (?, ?, ?, ?)',
                    [manufacturer, part, model, quantity || 1]
                );
            } else {
                console.error(`Деталь не найдена в базе данных и невозможно удалить: ${manufacturer} ${part} ${model}`);
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Ошибка при выполнении изменений:", error.message);
        res.status(500).json({ error: "Ошибка при выполнении изменений" });
    }
});

// Получение всех деталей
app.get('/api/parts', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM parts');
        res.json(rows);
    } catch (error) {
        console.error("Ошибка при получении деталей:", error.message);
        res.status(500).json({ error: "Ошибка при получении деталей" });
    }
});

// Обновление детали
app.put('/api/parts/:id', async (req, res) => {
    const { id } = req.params;
    const { manufacturer, part, model, quantity } = req.body;

    try {
        await db.execute(
            'UPDATE parts SET manufacturer = ?, part = ?, model = ?, quantity = ? WHERE id = ?',
            [manufacturer, part, model, quantity, id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error("Ошибка при обновлении детали:", error.message);
        res.status(500).json({ error: "Ошибка при обновлении детали" });
    }
});

// Удаление деталей
app.delete('/api/parts', async (req, res) => {
    const { ids } = req.body;

    try {
        const placeholders = ids.map(() => '?').join(',');
        await db.execute(`DELETE FROM parts WHERE id IN (${placeholders})`, ids);
        res.json({ success: true });
    } catch (error) {
        console.error("Ошибка при удалении деталей:", error.message);
        res.status(500).json({ error: "Ошибка при удалении деталей" });
    }
});

const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
