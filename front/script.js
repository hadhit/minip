let currentChatId = null;
const username = localStorage.getItem("username");
const APIURL = "http://localhost:3000/query";
const APIURL_TRANSLATE = "http://localhost:3000/translate";
const chatWindow = document.getElementById('chat-window');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const languageSelect = document.getElementById('language-select');
const LANGUAGE_KEY = 'translationLanguage';

// --- Translation Feature Setup ---
// Initialize language selector from localStorage
let selectedLanguage = localStorage.getItem(LANGUAGE_KEY) || 'English';
languageSelect.value = selectedLanguage;

// Helper function to reset and update the state of a single translation button/message box
function updateMessageButtonState(messageBox) {
    const button = messageBox.querySelector('.translate-btn');
    const messageBody = messageBox.querySelector('.message-body');
    const originalTextEncoded = messageBox.getAttribute('data-original-text');
    const originalText = decodeURIComponent(originalTextEncoded);
    const targetLang = localStorage.getItem(LANGUAGE_KEY) || 'English';
    const isTranslationEnabled = targetLang !== 'English';
    
    // 1. Reset text to original (if currently translated) and reset the translated state
    if (button.dataset.translated === 'true') {
        messageBody.innerHTML = formatMarkdown(originalText);
    }
    
    // 2. Clear old translation cache and set initial state
    button.dataset.translated = 'false';
    button.disabled = !isTranslationEnabled;
    messageBox.removeAttribute('data-translated-text'); // Clear old translation cache
    messageBox.removeAttribute('data-translated-lang'); // Clear old language tag
    
    if (!isTranslationEnabled) {
        button.textContent = 'Translation Off';
        button.style.color = '#9ca3af'; 
        button.style.backgroundColor = '#f3fafd';
        button.title = "Select a target language to enable translation";
    } else {
        button.textContent = `Translate to ${targetLang}`;
        button.style.color = '#1976a7'; 
        button.style.backgroundColor = '#e0f5ff';
        button.title = `Click to translate to ${targetLang}`;
    }
}

// Event listener to save new language selection AND reset existing messages
languageSelect.addEventListener('change', (e) => {
    selectedLanguage = e.target.value;
    localStorage.setItem(LANGUAGE_KEY, selectedLanguage);
    
    // Crucial fix: Update all existing message buttons' state and clear cache
    document.querySelectorAll('.message-box.assistant').forEach(updateMessageButtonState);
});

async function toggleTranslation(button) {
    const messageBox = button.closest('.message-box.assistant');
    const messageBody = messageBox.querySelector('.message-body');
    // FIX: Ensure we are fetching the encoded data attribute correctly
    const originalTextEncoded = messageBox.getAttribute('data-original-text'); 
    const originalText = decodeURIComponent(originalTextEncoded); // Decode the stored original text
    const targetLanguage = localStorage.getItem(LANGUAGE_KEY) || 'English';
    
    if (targetLanguage === 'English') return;

    if (button.dataset.translated === 'true') {
        // --- Show Original ---
        messageBody.innerHTML = formatMarkdown(originalText);
        button.textContent = `Translate to ${targetLanguage}`;
        button.dataset.translated = 'false';
        button.style.backgroundColor = '#e0f5ff';
        button.style.color = '#1976a7';
    } else {
        // --- Translate ---
        const cachedText = messageBox.getAttribute('data-translated-text');
        const cachedLang = messageBox.getAttribute('data-translated-lang');

        // Check if we have a valid translation in the current target language
        if (cachedText && cachedLang === targetLanguage) {
            // Use cached translation
            messageBody.innerHTML = formatMarkdown(decodeURIComponent(cachedText));
            button.textContent = 'Show Original';
            button.dataset.translated = 'true';
            button.style.backgroundColor = '#1976a7';
            button.style.color = '#fff';
            return;
        }

        // --- Cache Miss or Wrong Language Cache: Fetch New Translation ---
        button.textContent = 'Translating...';
        button.disabled = true;
        button.style.backgroundColor = '#ffa500'; // Temporary color for loading
        button.style.color = '#fff';

        try {
            const response = await fetch(APIURL_TRANSLATE, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: originalText, targetLanguage: targetLanguage })
            });

            const data = await response.json();

            if (data.translatedText) {
                // Store translation in dataset for caching (overwrite old cache)
                messageBox.setAttribute('data-translated-text', encodeURIComponent(data.translatedText));
                messageBox.setAttribute('data-translated-lang', targetLanguage);
                
                messageBody.innerHTML = formatMarkdown(data.translatedText);
                button.textContent = 'Show Original';
                button.dataset.translated = 'true';
                button.style.backgroundColor = '#1976a7';
                button.style.color = '#fff';
            } else {
                button.textContent = `Translation Error`;
                console.error("Translation API failed:", data.error || 'Unknown error');
                // Restore original state if failed
                button.disabled = false;
                button.style.backgroundColor = '#e0f5ff';
                button.style.color = '#1976a7';
            }
        } catch (error) {
            console.error("Translation network error:", error);
            button.textContent = 'Network Error';
            // Restore original state if failed
            button.disabled = false;
            button.style.backgroundColor = '#e0f5ff';
            button.style.color = '#1976a7';
        }
    }
}

// --- FIX: Rewritten formatMarkdown for stability when reverting ---
function formatMarkdown(text) {
    let html = '';
    const lines = text.split('\n');
    let inList = false;
    const listRegex = /^([\-\*]|\d+\.)\s+(.*)/;

    lines.forEach(line => {
        const match = line.match(listRegex);
        
        if (match) {
            // If it's a list item
            const listType = match[1].match(/\d/) ? 'ol' : 'ul';
            const listItem = `<li>${match[2].trim()}</li>`;

            if (!inList) {
                // Start a new list block
                html += `<${listType}>${listItem}`;
                inList = listType;
            } else if (inList === listType) {
                // Continue the current list block
                html += listItem;
            } else {
                // End previous list, start new one
                html += `</${inList}>`;
                html += `<${listType}>${listItem}`;
                inList = listType;
            }
        } else {
            // If it's not a list item
            if (inList) {
                // Close the previous list
                html += `</${inList}>`;
                inList = false;
            }
            if (line.trim() !== '') {
                // Add content as a paragraph with a line break
                html += `<span>${line}</span><br>`;
            } else {
                // Add a simple line break
                html += '<br>';
            }
        }
    });

    // Close any unclosed list at the end of the text
    if (inList) {
        html += `</${inList}>`;
    }

    // Clean up empty breaks that may have been generated
    return html.replace(/<br><br>/g, '<br>').replace(/<br><ul>/g, '<ul>').replace(/<\/ul><br>/g, '</ul>');
}
// --- END FIX: Rewritten formatMarkdown ---


function addMessage(text, sender, sources = null) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add("mb-4","chat-bubble");
    let messageContent;
    
    if (sender === "user") {
        messageDiv.className = "chat-bubble flex justify-end mb-4";
        messageContent = `<div class="message-box user p-3 bg-indigo-100 rounded-2xl max-w-lg text-lg shadow-sm">${text}</div>`;
    } else if (sender === "assistant") {
        const formatted = formatMarkdown(text);
        const targetLang = localStorage.getItem(LANGUAGE_KEY) || 'English';
        const isTranslationEnabled = targetLang !== 'English';
        const buttonText = isTranslationEnabled ? `Translate to ${targetLang}` : 'Translation Off';
        const buttonStyle = `color: ${isTranslationEnabled ? '#1976a7' : '#9ca3af'}; background-color: ${isTranslationEnabled ? '#e0f5ff' : '#f3fafd'};`;
        const buttonDisabled = isTranslationEnabled ? '' : 'disabled title="Select a target language to enable translation"';

        messageDiv.className = "chat-bubble flex justify-start mb-4";
        messageContent = `
            <div class="message-box assistant p-3 bg-gradient-to-br from-pink-100 via-indigo-50 to-white border border-indigo-200 rounded-2xl max-w-lg shadow" 
                 data-original-text="${encodeURIComponent(text)}" data-translated="false">
                <p class="font-bold text-indigo-700 font-playfair text-base mb-2">Assistant 🤖</p>
                <div class="message-body">${formatted}</div>
                
                <!-- Translation Controls -->
                <div class="translation-controls mt-2 flex justify-end">
                    <button 
                        onclick="toggleTranslation(this)" 
                        class="translate-btn text-xs font-semibold py-1 px-2 rounded-full transition duration-150 ease-in-out hover:shadow-lg" 
                        style="${buttonStyle}"
                        ${buttonDisabled}
                        data-translated="false"
                    >
                        ${buttonText}
                    </button>
                </div>
                <!-- End Translation Controls -->
            `;

        if (Array.isArray(sources) && sources.length > 0) {
            messageContent += `<div class="mt-3 pt-2 border-t border-gray-300">
                <p class="text-xs font-bold text-indigo-500 mb-2">Sources:</p>`;
            sources.forEach(s => {
                messageContent += `<div class="text-xs text-indigo-700 mb-1">${s.title}: <a href="${s.uri}" target="_blank" class="hover:underline">${s.uri}</a></div>`;
            });
            messageContent += "</div>";
        }
        messageContent += "</div>";
    }
    messageDiv.innerHTML = messageContent;
    chatWindow.appendChild(messageDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function loadChatList() {
    const chatListDiv = document.getElementById('chat-list');
    chatListDiv.innerHTML = "<i>Loading...</i>";
    const res = await fetch(`http://localhost:3000/chats?username=${encodeURIComponent(username)}`);
    const chats = await res.json();
    chatListDiv.innerHTML = "";
    chats.forEach(chat => {
        const item = document.createElement("div");
        item.className = "sidebar-item group flex items-center justify-between p-2 mb-2 bg-white border rounded-xl cursor-pointer hover:bg-indigo-100 transition";
        const dt = new Date(chat.startTime);

        const infoDiv = document.createElement("div");
        infoDiv.className = "flex-1 overflow-hidden truncate";
        infoDiv.innerHTML = `<b>${dt.toLocaleDateString()}<br>${dt.toLocaleTimeString()}</b><br><span class="truncate">${chat.title}</span>`;
        infoDiv.onclick = async () => {
            currentChatId = chat.id;
            chatWindow.innerHTML = "";
            await loadChatHistory(chat.id);
        };

        const crossBtn = document.createElement("button");
        crossBtn.innerHTML = "❌";
        crossBtn.title = "Delete chat";
        crossBtn.className = "ml-3 text-xl text-red-400 font-bold opacity-60 hover:opacity-100 transition";
        crossBtn.onclick = async (e) => {
            e.stopPropagation();
            await fetch(`http://localhost:3000/chats/${chat.id}?username=${encodeURIComponent(username)}`, {method:"DELETE"});
            if (currentChatId === chat.id) {
                chatWindow.innerHTML = "";
                currentChatId = null;
            }
            await loadChatList();
        };

        item.appendChild(infoDiv);
        item.appendChild(crossBtn);
        chatListDiv.appendChild(item);
    });
}
async function loadChatHistory(chatId) {
    chatWindow.innerHTML = "<i>Loading...</i>";
    const res = await fetch(`http://localhost:3000/chats/${chatId}?username=${encodeURIComponent(username)}`);
    const chat = await res.json();
    chatWindow.innerHTML = "";
    
    // We iterate through all messages and use addMessage to render them
    // addMessage handles setting the correct initial translation button state.
    chat.messages.forEach(msg => {
        addMessage(
            msg.text,
            msg.sender,
            msg.sources
        );
    });
}
async function startNewChat() {
    const res = await fetch("http://localhost:3000/chats/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username })
    });
    const chat = await res.json();
    currentChatId = chat.id;
    chatWindow.innerHTML = "";
    await loadChatList();
}

document.getElementById('new-chat-btn').onclick = startNewChat;
sendButton.addEventListener('click', sendQuery);
userInput.addEventListener('keydown',function(e){if(e.key==="Enter")sendQuery();});

async function sendQuery() {
    const question = userInput.value.trim();
    if (!question || !currentChatId) return;
    addMessage(question, "user");
    userInput.value = "";
    sendButton.disabled = true;
    try {
        const response = await fetch(APIURL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question, username, chatId: currentChatId })
        });
        const data = await response.json();
        if (data.error) {
            addMessage(data.error, "assistant");
        }
        else {
            addMessage(data.text || "No response.", "assistant", data.sources || null);
        }
    } catch (error) {
        addMessage("Error connecting to server. Please try again.", "assistant");
    } finally {
        sendButton.disabled = false;
    }
    await loadChatList(); // Refresh chat list to update the title
}
window.onload = async ()=>{await loadChatList();await startNewChat();}
