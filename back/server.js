const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const usersFile = path.join(__dirname, 'users.json');
const chatsFile = path.join(__dirname, 'chats.json');
function getNowISO() { return new Date().toISOString(); }

// USERS
function loadUsers() {
    if (!fs.existsSync(usersFile)) return [];
    return JSON.parse(fs.readFileSync(usersFile, 'utf8'));
}
function saveUsers(users) {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}
// CHATS
function loadChats() {
    if (!fs.existsSync(chatsFile)) return [];
    return JSON.parse(fs.readFileSync(chatsFile, 'utf8'));
}
function saveChats(chats) {
    fs.writeFileSync(chatsFile, JSON.stringify(chats, null, 2));
}

// --- Auth Endpoints ---
app.post('/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
        return res.status(400).json({ error: 'Username and password required.' });
    let users = loadUsers();
    if (users.find(u => u.username === username))
        return res.status(409).json({ error: 'Username already exists.' });
    users.push({ username, password });
    saveUsers(users);
    res.json({ success: true, message: 'Account created. Please login.' });
});
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    let users = loadUsers();
    let user = users.find(u => u.username === username && u.password === password);
    if (!user)
        return res.status(401).json({ error: 'Invalid username or password.' });
    res.json({ success: true, token: `user-${username}-token`, username });
});

// --- Chat Sessions ---
app.get('/chats', (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Username required.' });
    const chats = loadChats();
    const userChats = chats.filter(chat => chat.username === username)
        .map(chat => ({
            id: chat.id,
            startTime: chat.startTime,
            title: chat.messages.length > 0 ? chat.messages[0].text.slice(0, 40) : "Empty chat"
        }));
    res.json(userChats);
});
app.get('/chats/:id', (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Username required.' });
    const chats = loadChats();
    const chat = chats.find(c => c.id === req.params.id && c.username === username);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat);
});
app.post('/chats/new', (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required.' });
    const chats = loadChats();
    const newChat = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        username,
        startTime: getNowISO(),
        messages: []
    };
    chats.unshift(newChat);
    saveChats(chats);
    res.json(newChat);
});
// --- Delete chat ---
app.delete('/chats/:id', (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Username required.' });
    let chats = loadChats();
    const initialLength = chats.length;
    chats = chats.filter(c => !(c.id === req.params.id && c.username === username));
    saveChats(chats);
    const deleted = chats.length !== initialLength;
    res.json({ success: deleted });
});

// --- GEMINI API SETUP ---
const apiKey = "AIzaSyABts0kPk9bLVVv1MraJxD_0N4rzs-2jSc"; // Existing API key from original server.js
const geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

async function fetchWithExponentialBackoff(model, payload, maxRetries = 3) {
    const headers = { 'Content-Type': 'application/json' };
    const url = `${geminiBaseUrl}/${model}:generateContent?key=${apiKey}`;
    let delay = 1000;
    let errorMsg = null;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });
            if (response.ok) {
                return await response.json();
            }
            errorMsg = await response.text();
            if (response.status === 429 || response.status >= 500) {
            } else {
                throw new Error(`API failed with status ${response.status}: ${errorMsg}`);
            }
        } catch (error) {
            errorMsg = error.message;
            if (i === maxRetries - 1) throw error;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
    }
    throw new Error(errorMsg || 'Gemini API request failed after multiple retries.');
}

const systemPrompt = "You are a specialized 'Know-Your-Rights' legal awareness assistant focused only on Indian law and legal procedures. Always refuse non-legal questions.";
const chatModel = "gemini-2.5-flash-preview-05-20";

app.post('/query', async (req, res) => {
    const { question, username, chatId } = req.body;
    if (!question) {
        return res.status(400).json({ error: "Missing 'question' in request body." });
    }
    try {
        const payload = {
            contents: [{ parts: [{ text: question }] }],
            tools: [{ "google_search": {} }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };
        const result = await fetchWithExponentialBackoff(chatModel, payload);
        const candidate = result.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;
        let sources = [];
        const groundingMetadata = candidate?.groundingMetadata;
        if (groundingMetadata?.groundingAttributions) {
            sources = groundingMetadata.groundingAttributions
              .map(attribution => ({
                uri: attribution.web?.uri,
                title: attribution.web?.title,
              }))
              .filter(source => source.uri && source.title);
        }
        if (chatId && username) {
            const chats = loadChats();
            const chat = chats.find(c => c.id === chatId && c.username === username);
            if (chat) {
                chat.messages.push({
                    time: getNowISO(),
                    text: question,
                    sender: "user"
                });
                chat.messages.push({
                    time: getNowISO(),
                    text: text,
                    sender: "assistant",
                    sources
                });
                saveChats(chats);
            }
        }
        res.json({ text, sources });
    } catch (error) {
        console.error("Gemini API error detail:", error);
        res.status(500).json({
            error: "Failed to communicate with the AI service.",
            details: error.message
        });
    }
});

// --- NEW TRANSLATION ENDPOINT ---
async function translateText(text, targetLanguage) {
    // We explicitly tell the model to translate
    const translationPrompt = `Translate the following text into ${targetLanguage} while maintaining the original meaning and tone:\n\nTEXT: "${text}"`;
    const payload = {
        contents: [{ parts: [{ text: translationPrompt }] }],
        // No system instruction or search grounding needed for simple translation
    };
    // Use the same model for translation
    const result = await fetchWithExponentialBackoff(chatModel, payload);
    return result.candidates?.[0]?.content?.parts?.[0]?.text || "Translation failed.";
}

app.post('/translate', async (req, res) => {
    const { text, targetLanguage } = req.body;
    if (!text || !targetLanguage) {
        return res.status(400).json({ error: "Missing text or targetLanguage." });
    }
    try {
        const translatedText = await translateText(text, targetLanguage);
        res.json({ translatedText });
    } catch (error) {
        console.error("Translation API error detail:", error);
        res.status(500).json({
            error: "Failed to perform translation.",
            details: error.message
        });
    }
});

app.listen(port, () => {
    console.log(`Backend API listening at http://localhost:${port}`);
});
