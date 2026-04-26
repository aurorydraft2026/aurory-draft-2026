import React, { useState, useEffect, useRef } from 'react';
import { subscribeMiniGameChat, sendMiniGameChatMessage } from '../../services/miniGameService';
import './MiniGamesChat.css';

const MiniGamesChat = ({ user, channelId = 'hub', integrated = false }) => {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    const unsubscribe = subscribeMiniGameChat(channelId, (newMessages) => {
      setMessages(newMessages);
    });
    return () => unsubscribe();
  }, [channelId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isSending || !user) return;

    setIsSending(true);
    const result = await sendMiniGameChatMessage(channelId, user, inputText);
    if (result.success) {
      setInputText('');
    }
    setIsSending(false);
  };

  return (
    <div className={`mg-chat-container ${integrated ? 'mg-chat-integrated' : ''}`}>
      <div className="mg-chat-header">
        <span className="mg-chat-dot"></span>
        <h3>{channelId === 'hub' ? 'Global Chat' : `${channelId.charAt(0).toUpperCase() + channelId.slice(1)} Chat`}</h3>
      </div>

      <div className="mg-chat-messages">
        {messages.length === 0 ? (
          <div className="mg-chat-empty">No messages yet. Start the conversation!</div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`mg-chat-msg ${msg.uid === user?.uid ? 'mg-chat-msg-own' : ''}`}>
              <img 
                src={msg.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'} 
                alt="" 
                className="mg-chat-avatar"
                onError={(e) => { e.target.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }}
              />
              <div className="mg-chat-msg-content">
                <div className="mg-chat-msg-header">
                  <span className="mg-chat-name">{msg.name}</span>
                  <span className="mg-chat-time">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="mg-chat-text">{msg.text}</div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="mg-chat-input-area" onSubmit={handleSend}>
        <input
          type="text"
          placeholder={user ? "Type a message..." : "Login to chat"}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={!user || isSending}
          maxLength={200}
        />
        <button type="submit" disabled={!user || !inputText.trim() || isSending}>
          {isSending ? '...' : '➤'}
        </button>
      </form>
    </div>
  );
};

export default MiniGamesChat;
