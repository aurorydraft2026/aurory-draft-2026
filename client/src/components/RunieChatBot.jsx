import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
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

const RunieChatBot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [knowledge, setKnowledge] = useState(DEFAULT_KNOWLEDGE);
  const [messages, setMessages] = useState([
    { id: 1, type: 'bot', text: "Hail, Warrior! I am Runie, your guide through Asgard. How can I help you today?", timestamp: Date.now() }
  ]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
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

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen, isTyping]);

  const processResponse = (userText) => {
    setIsTyping(true);
    
    setTimeout(() => {
      setIsTyping(false);
      
      const lowerText = userText.toLowerCase();
      const foundMatch = knowledge.find(item => 
        item.keywords?.some(k => lowerText.includes(k.toLowerCase()))
      );

      const responseText = foundMatch 
        ? foundMatch.response 
        : "I am still learning the ways of Midgard! I can help you with Amiko Legends, Aurory, Valcoins, or the Drakkar Race. Try one of the topics below!";

      const botMsg = { id: Date.now() + 1, type: 'bot', text: responseText, timestamp: Date.now() };
      setMessages(prev => [...prev, botMsg]);
    }, 1000);
  };

  const handleQuickReply = (reply) => {
    const userMsg = { id: Date.now(), type: 'user', text: reply.label, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    processResponse(reply.label);
  };

  const handleSendMessage = (e) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isTyping) return;

    const userMsg = { id: Date.now(), type: 'user', text: inputText, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    const textToProcess = inputText;
    setInputText('');
    
    processResponse(textToProcess);
  };

  const handleReset = () => {
    setMessages([{ id: 1, type: 'bot', text: "Hail, Warrior! I am Runie, your guide through Asgard. How can I help you today?", timestamp: Date.now() }]);
  };

  return (
    <div className={`runie-bot-container ${isOpen ? 'is-open' : ''}`}>
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
                  {msg.text}
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
              {knowledge
                .filter(item => item.label && item.showAsBadge !== false)
                .slice(0, 8)
                .map((reply) => (
                <button 
                  key={reply.id} 
                  className="quick-reply-btn"
                  onClick={() => handleQuickReply(reply)}
                >
                  {reply.label}
                </button>
              ))}
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
