import React, { useState, useEffect, useCallback } from 'react';
import { purchaseRuneShopItem, exchangeRunesService, getUserYggData } from '../../services/miniGameService';
import './RuneShop.css';

const SHOP_ITEMS = [
  {
    id: 'magnetism',
    name: 'Rune Magnetism',
    icon: '/icons/minigames/yggdrasil/magnet.png',
    description: 'Runes fly toward you from a distance. Upgrades increase the range.',
    maxLevel: 3,
    type: 'upgrade',
    levelLabels: ['100px range', '160px range', '240px range'],
    defaultCosts: [50, 150, 400]
  },
  {
    id: 'extraTurbo',
    name: 'Extra Turbo',
    icon: '/icons/minigames/yggdrasil/turbo.png',
    description: 'Start each run with +1 Turbo Boost charge. Max 3.',
    type: 'consumable',
    maxOwn: 3,
    defaultCost: 20
  },
  {
    id: 'extraJump',
    name: 'Extra High Jump',
    icon: '/icons/minigames/yggdrasil/double_jump.png',
    description: 'Start each run with +1 Double Jump charge. Max 5.',
    type: 'consumable',
    maxOwn: 5,
    defaultCost: 15
  },
  {
    id: 'idunApple',
    name: "Iðunn's Apple",
    icon: "/icons/minigames/yggdrasil/idunn's_apple.png",
    description: 'Auto-activates when you die. Get a 10s prompt to respawn at the highest platform. Max 1.',
    type: 'consumable',
    maxOwn: 1,
    defaultCost: 80
  }
];

const RuneShop = ({ user, config, onClose, onUpdate }) => {
  const [runeBalance, setRuneBalance] = useState(0);
  const [redRuneBalance, setRedRuneBalance] = useState(0);
  const [upgrades, setUpgrades] = useState({});
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(null);
  const [exchangeAmount, setExchangeAmount] = useState('');
  const [exchangeTarget, setExchangeTarget] = useState('Valcoins');
  const [exchangeLoading, setExchangeLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const loadData = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    const data = await getUserYggData(user.uid);
    setRuneBalance(data.runeBalance);
    setRedRuneBalance(data.redRuneBalance || 0);
    setUpgrades(data.upgrades);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handlePurchase = async (itemId) => {
    setPurchasing(itemId);
    setMessage(null);
    const result = await purchaseRuneShopItem(itemId);
    if (result.success) {
      setRuneBalance(result.newRuneBalance);
      setRedRuneBalance(result.newRedRuneBalance || 0);
      const isCustom = itemId.startsWith('custom_');
      setMessage({ 
        type: 'success', 
        text: isCustom ? `Purchased! Item sent to Warrior's Armory.` : `Purchased ${itemId}!` 
      });
      await loadData(); // Refresh upgrades
      onUpdate?.();
    } else {
      setMessage({ type: 'error', text: result.error });
    }
    setPurchasing(null);
  };

  const handleExchange = async () => {
    const amount = parseInt(exchangeAmount);
    if (!amount || amount <= 0) {
      setMessage({ type: 'error', text: 'Enter a valid amount.' });
      return;
    }
    setExchangeLoading(true);
    setMessage(null);
    const result = await exchangeRunesService(exchangeTarget, amount);
    if (result.success) {
      setRuneBalance(result.newRuneBalance);
      setMessage({ type: 'success', text: `Exchanged ${result.runesSpent} Runes for ${result.received} ${result.currency}!` });
      setExchangeAmount('');
      onUpdate?.();
    } else {
      setMessage({ type: 'error', text: result.error });
    }
    setExchangeLoading(false);
  };

  const getItemCost = (item) => {
    const shopCosts = config?.shopCosts || {};
    
    if (item.id === 'magnetism') {
      const level = upgrades.magnetismLevel || 0;
      if (level >= item.maxLevel) return null;
      const key = `magnetismLv${level + 1}`;
      return shopCosts[key] ?? item.defaultCosts[level];
    }
    
    if (item.id === 'extraTurbo') return shopCosts.extraTurbo ?? item.defaultCost;
    if (item.id === 'extraJump') return shopCosts.extraJump ?? item.defaultCost;
    if (item.id === 'idunApple') return shopCosts.idunApple ?? item.defaultCost;
    
    return item.defaultCost;
  };

  const getItemStatus = (item) => {
    if (item.id === 'magnetism') {
      const level = upgrades.magnetismLevel || 0;
      if (level >= item.maxLevel) return 'MAX';
      return `Lv.${level} → Lv.${level + 1}`;
    }
    if (item.id === 'extraTurbo') {
      const owned = upgrades.extraTurbo || 0;
      return owned >= 3 ? 'MAXED OUT' : `Owned: ${owned} / 3`;
    }
    if (item.id === 'extraJump') {
      const owned = upgrades.extraJump || 0;
      return owned >= 5 ? 'MAXED OUT' : `Owned: ${owned} / 5`;
    }
    if (item.id === 'idunApple') {
      return upgrades.hasIdunApple ? '🍎 In Inventory' : 'Not owned';
    }
    return '';
  };

  const isDisabled = (item) => {
    if (item.id === 'idunApple' && upgrades.hasIdunApple) return true;
    if (item.id === 'magnetism' && (upgrades.magnetismLevel || 0) >= item.maxLevel) return true;
    if (item.id === 'extraTurbo' && (upgrades.extraTurbo || 0) >= 3) return true;
    if (item.id === 'extraJump' && (upgrades.extraJump || 0) >= 5) return true;
    const cost = getItemCost(item);
    const currency = item.currency || 'runes';
    const balance = currency === 'redRunes' ? redRuneBalance : runeBalance;
    return cost === null || balance < cost;
  };

  const getExchangeRateDisplay = () => {
    const rate = config?.exchangeRates?.[exchangeTarget.toLowerCase()] || (exchangeTarget === 'Valcoins' ? 0.5 : 0.01);
    return `Rate: 1 Rune = ${rate} ${exchangeTarget}`;
  };

  if (loading) {
    return (
      <div className="ygg-shop-overlay">
        <div className="ygg-shop-modal">
          <div className="ygg-shop-loading-container">
            <div className="viking-spinner" />
            <span className="ygg-shop-loading-text">Loading Valhalla's Treasures...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ygg-shop-overlay">
      <div className="ygg-shop-modal">
        <div className="ygg-shop-header">
          <h2 className="ygg-shop-title">
            <img src="/icons/minigames/yggdrasil/rune.png" alt="rune" className="ygg-shop-header-title-rune-img" />
            Rune Shop
          </h2>
          <div className="ygg-shop-balance">
            <span className="ygg-shop-rune-label">Your Balance</span>
            <div className="ygg-shop-balance-container" style={{ display: 'flex', gap: '15px' }}>
              <div className="ygg-shop-balance-row">
                <img src="/icons/minigames/yggdrasil/rune.png" alt="rune" className="ygg-shop-header-rune-img" />
                <span className="ygg-shop-rune-count">{runeBalance.toLocaleString()}</span>
              </div>
              <div className="ygg-shop-balance-row" style={{ color: '#ef4444' }}>
                <img src="/icons/minigames/yggdrasil/red_rune.png" alt="red rune" className="ygg-shop-header-rune-img" />
                <span className="ygg-shop-rune-count">{redRuneBalance.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        {message && (
          <div className={`ygg-shop-message ${message.type}`}>
            {message.text}
          </div>
        )}

        <div className="ygg-shop-scroll custom-scrollbar">
          <div className="ygg-shop-main">
            <div className="ygg-shop-section-title">⚡ Upgrades & Consumables</div>
            <div className="ygg-shop-items">
              {[...SHOP_ITEMS, ...(config?.customShopItems || [])].map(item => {
                const isCustom = item.id.startsWith('custom_');
                const cost = isCustom ? item.price : getItemCost(item);
                const isRedRune = item.currency === 'redRunes';
                const balance = isRedRune ? redRuneBalance : runeBalance;
                const status = isCustom ? (item.stock > 0 ? `Stock: ${item.stock}` : 'SOLD OUT') : getItemStatus(item);
                const disabled = isCustom ? (item.stock <= 0 || balance < cost) : isDisabled(item);

                return (
                  <div key={item.id} className={`ygg-shop-item ${isCustom ? 'custom-item' : ''} ${disabled ? 'disabled' : ''}`}>
                    <div className="ygg-shop-item-top">
                      <div className="ygg-shop-item-icon">
                        {isCustom && item.image ? (
                          <img src={item.image} alt={item.name} className="ygg-custom-shop-img" />
                        ) : (
                          <img src={item.icon} alt={item.name} className="ygg-shop-item-img" />
                        )}
                      </div>
                      <div className="ygg-shop-item-info">
                        <div className="ygg-shop-item-name">{item.name}</div>
                        <div className="ygg-shop-item-desc">{item.description}</div>
                      </div>
                    </div>
                    
                    <div className="ygg-shop-item-footer">
                      <div className="ygg-shop-item-status" style={{ color: isCustom && item.stock <= 0 ? '#ef4444' : '' }}>
                        {status}
                      </div>
                      <button
                        className="ygg-shop-buy-btn"
                        disabled={disabled || purchasing === item.id}
                        onClick={() => handlePurchase(item.id)}
                      >
                        {purchasing === item.id ? '...' : (isCustom && item.stock <= 0) ? 'EMPTY' : cost !== null ? (
                          <div className="ygg-buy-btn-content">
                            <img 
                              src={isCustom && item.currency === 'redRunes' ? "/icons/minigames/yggdrasil/red_rune.png" : "/icons/minigames/yggdrasil/rune.png"} 
                              alt="rune" 
                              className="ygg-buy-rune-img" 
                            />
                            {cost}
                          </div>
                        ) : 'MAX'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="ygg-shop-sidebar">
            <div className="ygg-shop-section-title">💱 Rune Exchange</div>
            <div className="ygg-shop-exchange">
              <div className="ygg-exchange-header">Convert Runes</div>
              <div className="ygg-shop-exchange-row">
                <input
                  type="number"
                  className="ygg-shop-exchange-input"
                  placeholder="Amount"
                  value={exchangeAmount}
                  onChange={e => setExchangeAmount(e.target.value)}
                  min="1"
                />
                <span className="ygg-shop-exchange-arrow">→</span>
                <select
                  className="ygg-shop-exchange-select"
                  value={exchangeTarget}
                  onChange={e => setExchangeTarget(e.target.value)}
                >
                  <option value="Valcoins">Valcoins</option>
                </select>
              </div>
              <div className="ygg-shop-exchange-rate">
                {getExchangeRateDisplay()}
              </div>
              <button
                className="ygg-shop-exchange-btn"
                disabled={exchangeLoading || !exchangeAmount}
                onClick={handleExchange}
              >
                {exchangeLoading ? 'Exchanging...' : 'Confirm Exchange'}
              </button>
            </div>
          </div>
        </div>

        <div className="ygg-shop-footer">
          <button className="ygg-shop-close" onClick={onClose}>
            Close Shop
          </button>
        </div>
      </div>
    </div>
  );
};

export default RuneShop;
