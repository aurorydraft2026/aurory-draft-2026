import React, { useState, useEffect, useRef } from 'react';
import { db, functions } from '../firebase';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import './RunieChatBot.css';

const RUNIE_AVATAR = '/runie-avatar.png';

export const DEFAULT_KNOWLEDGE = [
  { 
    id: 'about', 
    label: 'What is Asgard?', 
    keywords: ['about', 'asgard', 'what is', 'purpose'],
    showAsBadge: true,
    response: "Asgard is the premier platform for Amiko Legends enthusiasts! You can join tournaments, play epic mini-games like the Drakkar Race, and earn Valcoins to climb the ranks of Midgard." 
  },
  { 
    id: 'amiko_legends', 
    label: 'What is Amiko Legends?', 
    keywords: ['amiko legends', 'legends', 'amiko'],
    showAsBadge: true,
    response: "Amiko Legends is a strategic world of mythic creatures and epic battles. Here in Asgard, you can collect Amikos, enter tournaments, and compete for glory with your team!" 
  },
  { 
    id: 'valcoins', 
    label: 'How to get Valcoins?', 
    keywords: ['valcoins', 'coins', 'earn', 'get points', 'money'],
    showAsBadge: true,
    response: "You can earn Valcoins by participating in mini-games, claiming rewards, or winning tournaments. Check out the Asgard Trials (Arcade) to get started!" 
  },
  { 
    id: 'drakkar', 
    label: 'Drakkar Race?', 
    keywords: ['drakkar', 'race', 'bet', 'ship'],
    showAsBadge: true,
    response: "The Drakkar Race is a real-time parimutuel betting game. Choose your ship, place your bet, and if your ship wins, you split the total pool with other winners!" 
  },
  { 
    id: 'aurory_link', 
    label: 'Linking Aurory?', 
    keywords: ['link', 'connect', 'sync'],
    showAsBadge: true,
    response: "Linking your Aurory account allows you to enter official tournaments. You can find the linking option in your Profile menu at the top right." 
  },
  { 
    id: 'discord', 
    label: 'Is there a Discord?', 
    keywords: ['discord', 'guild', 'community', 'social'],
    showAsBadge: true,
    response: "Yes! Our community is active on Discord. You can find the link in the footer at the bottom of the page or in the welcome section above. Come say hi!" 
  },
  { 
    id: 'hidden_knowledge', 
    label: '',
    keywords: ['hidden', 'without badges', 'invisible', 'secret'],
    showAsBadge: false,
    response: "Yes! I just updated the system for you. You can now leave the 'Button Label' empty in the Admin Panel or toggle the 'Show as Button' switch to NO. Runie will still learn the keywords and answer those questions when typed in the chat, but no button will appear." 
  }
];

const ELEMENTS = ['Fire', 'Water', 'Wind', 'Lightning', 'Plant', 'Earth'];

const ELEMENTAL_CHART = {
  Fire: { Fire: 1, Water: 0.8, Wind: 1.2, Lightning: 1, Plant: 1.4, Earth: 0.9 },
  Water: { Fire: 1.4, Water: 1, Wind: 1, Lightning: 0.9, Plant: 0.8, Earth: 1.2 },
  Wind: { Fire: 0.9, Water: 1, Wind: 1, Lightning: 0.8, Plant: 1.2, Earth: 1.4 },
  Lightning: { Fire: 1, Water: 1.2, Wind: 1.4, Lightning: 1, Plant: 0.9, Earth: 0.8 },
  Plant: { Fire: 0.8, Water: 1.4, Wind: 0.9, Lightning: 1.2, Plant: 1, Earth: 1 },
  Earth: { Fire: 1.2, Water: 0.9, Wind: 0.8, Lightning: 1.4, Plant: 1, Earth: 1 }
};

const RunieChatBot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [knowledge, setKnowledge] = useState(DEFAULT_KNOWLEDGE);
  const [messages, setMessages] = useState([
    { id: 1, type: 'bot', text: "Hail, Warrior! I am Runie, your guide through Asgard. How can I help you today?", timestamp: Date.now() }
  ]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  
  // Floating Greetings state
  const [greetings, setGreetings] = useState([]);
  const [currentGreeting, setCurrentGreeting] = useState("Welcome, how can I help you?");
  const [showGreeting, setShowGreeting] = useState(false);
  
  // Damage Calculation Flow State
  const [calcState, setCalcState] = useState(null); // 'STATS', 'ATTACKER', 'DEFENDER'
  const [calcData, setCalcData] = useState({ sbd: 0, atk: 0, def: 0, attackerElement: '', defenderElement: '' });
  
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Fetch dynamic knowledge from Firestore
  useEffect(() => {
    const q = query(collection(db, 'chatbot_knowledge'), orderBy('order', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const customKnowledge = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setKnowledge(customKnowledge);
      } else {
        setKnowledge(DEFAULT_KNOWLEDGE);
      }
    });

    return () => unsubscribe();
  }, []);

  // Fetch Greetings
  useEffect(() => {
    const q = query(collection(db, 'chatbot_greetings'), orderBy('order', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const customGreetings = snapshot.docs.map(doc => doc.data().text);
        setGreetings(customGreetings);
      }
    });

    return () => unsubscribe();
  }, []);

  // Bubble Logic: Show a random greeting then disappear after 3s
  useEffect(() => {
    if (isOpen) {
      setShowGreeting(false);
      return;
    }

    const triggerGreeting = (force = false) => {
      // "Seldom" Logic: 
      // 1. Only if forced (e.g. interval) or random chance + cooldown
      if (!force) {
        const lastShownStr = localStorage.getItem('runie_last_greeting_time');
        const now = Date.now();
        const cooldown = 10 * 60 * 1000; // 10 minutes cooldown
        
        // If shown recently, don't show again
        if (lastShownStr && (now - parseInt(lastShownStr)) < cooldown) return;
        
        // Even if cooldown passed, add a random chance (40% to show)
        if (Math.random() > 0.4) return;
      }

      if (greetings.length > 0) {
        const randomIndex = Math.floor(Math.random() * greetings.length);
        setCurrentGreeting(greetings[randomIndex]);
      } else {
        setCurrentGreeting("Welcome, how can I help you?");
      }
      
      setShowGreeting(true);
      localStorage.setItem('runie_last_greeting_time', Date.now().toString());
      
      // Automatically disappear after 3s
      setTimeout(() => {
        setShowGreeting(false);
      }, 3000);
    };

    // Initial trigger on mount or closure (with seldom check)
    triggerGreeting(false);

    // Re-trigger periodically (every 2 minutes check)
    // The interval will also respect the "seldom" logic unless I pass true
    const interval = setInterval(() => triggerGreeting(false), 120000);

    return () => {
      clearInterval(interval);
    };
  }, [isOpen, greetings]);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen, isTyping]);

  const processResponse = async (userText) => {
    setIsTyping(true);
    
    const lowerText = userText.toLowerCase().trim();
    
    // ── DAMAGE CALCULATION FLOW HANDLER ──
    if (calcState) {
      if (calcState === 'STATS') {
        const parts = lowerText.split(/\s+/).filter(Boolean);
        if (parts.length === 3) {
          const [sbd, atk, def] = parts.map(Number);
          if (!isNaN(sbd) && !isNaN(atk) && !isNaN(def)) {
            setCalcData(prev => ({ ...prev, sbd, atk, def }));
            setCalcState('ATTACKER');
            const botMsg = { 
              id: Date.now() + 1, 
              type: 'bot', 
              text: "Got it! Now, please choose the **Attacker Element**:", 
              timestamp: Date.now() 
            };
            setMessages(prev => [...prev, botMsg]);
            setIsTyping(false);
            return;
          }
        }
        // Fallback if numbers are invalid
        const botMsg = { id: Date.now() + 1, type: 'bot', text: "Hmm, those don't look like three numbers. Please input:\nSkill Base Damage\nE/Atk Stat of Attacker\nE/Def Stat of Defender\n(Example: 60 152 115)", timestamp: Date.now() };
        setMessages(prev => [...prev, botMsg]);
        setIsTyping(false);
        return;
      }
      
      if (calcState === 'ATTACKER') {
        const element = ELEMENTS.find(e => e.toLowerCase() === lowerText);
        if (element) {
          setCalcData(prev => ({ ...prev, attackerElement: element }));
          setCalcState('DEFENDER');
          const botMsg = { 
            id: Date.now() + 1, 
            type: 'bot', 
            text: `Attacker is **${element}**! Now, choose the **Defender Element**:`, 
            timestamp: Date.now() 
          };
          setMessages(prev => [...prev, botMsg]);
          setIsTyping(false);
          return;
        }
      }

      if (calcState === 'DEFENDER') {
        const element = ELEMENTS.find(e => e.toLowerCase() === lowerText);
        if (element) {
          const defElem = element;
          const attElem = calcData.attackerElement;
          const { sbd, atk, def } = calcData;
          
          // Calculation Logic
          const em = ELEMENTAL_CHART[attElem][defElem] || 1;
          const statRatio = atk / def;
          const baseDamage = ((sbd * em) * statRatio) * 0.42;
          
          const estDamage = Math.round(baseDamage);
          const unlucky = Math.round(baseDamage * 0.95);
          const lucky = Math.round(baseDamage * 1.05);

          const responseText = `**Amiko Damage Results:**\n\n🎯 **Estimated Damage:** ${estDamage}\n📉 **Unlucky Hit:** ${unlucky}\n📈 **Lucky Hit:** ${lucky}\n\n*Applied Multiplier (${attElem} vs ${defElem}): x${em}*`;
          
          const botMsg = { id: Date.now() + 1, type: 'bot', text: responseText, timestamp: Date.now() };
          setMessages(prev => [...prev, botMsg]);
          setCalcState(null); // Reset flow
          setIsTyping(false);
          return;
        }
      }
      // If we are in elements state but user typed something else
      const botMsg = { id: Date.now() + 1, type: 'bot', text: "Please select an element from the buttons below or reset the chat.", timestamp: Date.now() };
      setMessages(prev => [...prev, botMsg]);
      setIsTyping(false);
      return;
    }

    // 1. Enhanced Weighted Matching System (Manual Knowledge First)
    let bestMatch = null;
    let highestScore = 0;

    knowledge.forEach(item => {
      if (!item.keywords) return;
      
      item.keywords.forEach(k => {
        const kw = k.toLowerCase().trim();
        if (lowerText.includes(kw)) {
          let score = kw.length;
          if (lowerText === kw) score += 20;
          const isStandalone = new RegExp(`\\b${kw}\\b`, 'i').test(lowerText);
          if (isStandalone) score += 5;

          if (score > highestScore) {
            highestScore = score;
            bestMatch = item;
          }
        }
      });
    });

    let finalResponse = "";

    // Threshold: Only use manual match if it's reasonably specific (score >= 4)
    if (bestMatch && highestScore >= 4) {
      // Artificial delay for manual responses to feel natural
      await new Promise(resolve => setTimeout(resolve, 800));
      finalResponse = bestMatch.response;
      setIsTyping(false);
    } else {
      // 2. AI Fallback (Call Gemini)
      try {
        const chatWithRunie = httpsCallable(functions, 'chatWithRunie');
        const result = await chatWithRunie({ message: userText });
        finalResponse = result.data.reply;
      } catch (error) {
        console.error("AI Error:", error);
        
        // Log unanswered queries so admins can 'teach' Runie later
        if (userText.length > 3) {
          try {
            addDoc(collection(db, 'chatbot_unanswered'), {
              query: userText,
              timestamp: serverTimestamp(),
              count: 1
            });
          } catch (e) {
            console.error("Failed to log unknown query:", e);
          }
        }
        
        finalResponse = "I am still learning the ways of Midgard! I can help you with Amiko Legends, Aurory, Valcoins, or the Drakkar Race. Try one of the topics below!";
      }
      setIsTyping(false);
    }

    const botMsg = { id: Date.now() + 1, type: 'bot', text: finalResponse, timestamp: Date.now() };
    setMessages(prev => [...prev, botMsg]);
  };

  const handleQuickReply = (reply) => {
    const userMsg = { id: Date.now(), type: 'user', text: reply.label, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    
    if (reply.label === "Amiko Legends Damage Calculation") {
      setCalcState('STATS');
      const botMsg = { 
        id: Date.now() + 1, 
        type: 'bot', 
        text: "Please input:\nSkill Base Damage\nE/Atk Stat of Attacker\nE/Def Stat of Defender", 
        timestamp: Date.now() 
      };
      setMessages(prev => [...prev, botMsg]);
      return;
    }
    
    processResponse(reply.label);
  };

  const handleSendMessage = (e, overrideText) => {
    if (e && e.preventDefault) e.preventDefault();
    const textToUse = overrideText || inputText;
    if (!textToUse.trim() || isTyping) return;

    const userMsg = { id: Date.now(), type: 'user', text: textToUse, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    
    processResponse(textToUse);
  };

  const handleReset = () => {
    setMessages([{ id: 1, type: 'bot', text: "Hail, Warrior! I am Runie, your guide through Asgard. How can I help you today?", timestamp: Date.now() }]);
    setCalcState(null);
    setCalcData({ sbd: 0, atk: 0, def: 0, attackerElement: '', defenderElement: '' });
  };

  const renderMessageContent = (text) => {
    if (!text) return null;

    // Detect YouTube
    const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/g;
    // Detect Links [text](url)
    const linkRegex = /\[(.*?)\]\((.*?)\)/g;
    // Detect Images ![alt](url)
    const imageRegex = /!\[(.*?)\]\((.*?)\)/g;
    // Detect Direct Video (mp4)
    const videoRegex = /https?:\/\/[^\s]+?\.(?:mp4|webm|ogg)/g;

    const parts = [];
    let lastIndex = 0;
    
    // This is a simplified parser. For more complex needs, a markdown library is better, 
    // but this avoids adding dependencies.
    
    // We'll process by searching for all tokens and sorting them by index
    const tokens = [];
    let match;

    // Direct Video matches
    while ((match = videoRegex.exec(text)) !== null) {
      tokens.push({ type: 'video', index: match.index, length: match[0].length, url: match[0] });
    }
    // YouTube matches
    while ((match = youtubeRegex.exec(text)) !== null) {
      tokens.push({ type: 'youtube', index: match.index, length: match[0].length, id: match[1] });
    }
    // Image matches
    while ((match = imageRegex.exec(text)) !== null) {
      tokens.push({ type: 'image', index: match.index, length: match[0].length, alt: match[1], url: match[2] });
    }
    // Link matches (avoid matching images)
    while ((match = linkRegex.exec(text)) !== null) {
      if (text[match.index - 1] !== '!') {
        tokens.push({ type: 'link', index: match.index, length: match[0].length, text: match[1], url: match[2] });
      }
    }

    // Sort tokens by index
    tokens.sort((a, b) => a.index - b.index);

    // Filter out overlapping tokens (if any)
    const cleanTokens = [];
    let currentPos = 0;
    for (const token of tokens) {
      if (token.index >= currentPos) {
        cleanTokens.push(token);
        currentPos = token.index + token.length;
      }
    }

    lastIndex = 0;
    cleanTokens.forEach((token, i) => {
      // Add text before token
      if (token.index > lastIndex) {
        parts.push(text.substring(lastIndex, token.index));
      }

      // Add token component
      if (token.type === 'link') {
        parts.push(<a key={`l-${i}`} href={token.url} target="_blank" rel="noopener noreferrer" className="runie-link">{token.text}</a>);
      } else if (token.type === 'image') {
        parts.push(
          <div key={`img-${i}`} className="runie-media image">
            <img src={token.url} alt={token.alt} referrerPolicy="no-referrer" />
          </div>
        );
      } else if (token.type === 'youtube') {
        parts.push(
          <div key={`yt-${i}`} className="runie-media youtube">
            <iframe 
              src={`https://www.youtube.com/embed/${token.id}`}
              title="YouTube video player"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            ></iframe>
          </div>
        );
      } else if (token.type === 'video') {
        parts.push(
          <div key={`vid-${i}`} className="runie-media video">
            <video controls playsInline>
              <source src={token.url} type={`video/${token.url.split('.').pop()}`} />
              Your browser does not support the video tag.
            </video>
          </div>
        );
      }

      lastIndex = token.index + token.length;
    });

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  return (
    <div className={`runie-bot-container ${isOpen ? 'is-open' : ''}`}>
      {/* Welcome Bubble */}
      {!isOpen && showGreeting && (
        <div className="runie-welcome-bubble">
          <span>{currentGreeting}</span>
        </div>
      )}

      {/* Floating Launcher */}
      <button 
        className="runie-launcher" 
        onClick={() => setIsOpen(!isOpen)}
        title="Chat with Runie"
      >
        <img src={RUNIE_AVATAR} alt="Runie" className="runie-launcher-img" />
        {!isOpen && <div className="runie-ping"></div>}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="runie-window">
          <div className="runie-header">
            <div className="runie-header-info">
              <img src={RUNIE_AVATAR} alt="Runie" className="runie-header-img" />
              <div>
                <h4>Runie</h4>
                <span>Online Guide</span>
              </div>
            </div>
            <div className="runie-header-actions">
              <button className="runie-reset-btn" onClick={handleReset} title="Reset Chat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
              </button>
              <button className="runie-close-btn" onClick={() => setIsOpen(false)}>✕</button>
            </div>
          </div>

          <div className="runie-messages">
            {messages.map((msg) => (
              <div key={msg.id} className={`runie-message ${msg.type}`}>
                <div className="runie-message-content">
                  {renderMessageContent(msg.text)}
                </div>
                <div className="runie-message-time">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="runie-message bot typing">
                <div className="typing-indicator">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="runie-footer">
            <div className="runie-quick-replies">
              {calcState === 'ATTACKER' || calcState === 'DEFENDER' ? (
                ELEMENTS.map(elem => (
                  <button 
                    key={elem} 
                    className="quick-reply-btn"
                    onClick={() => handleSendMessage({ preventDefault: () => {}, target: { value: elem } }, elem)}
                  >
                    {elem}
                  </button>
                ))
              ) : (
                [...knowledge, { id: 'calc', label: 'Amiko Legends Damage Calculation', showAsBadge: true }]
                .filter(item => item.label && item.showAsBadge !== false)
                .slice(0, 9)
                .map((reply) => (
                  <button 
                    key={reply.id} 
                    className="quick-reply-btn"
                    onClick={() => handleQuickReply(reply)}
                  >
                    {reply.label}
                  </button>
                ))
              )}
            </div>
            
            <form className="runie-input-area" onSubmit={handleSendMessage}>
              <input 
                type="text" 
                placeholder="Ask Runie anything..." 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                autoFocus
              />
              <button type="submit" className="runie-send-btn" disabled={!inputText.trim() || isTyping}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polyline points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RunieChatBot;
