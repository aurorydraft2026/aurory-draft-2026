import React, { useState, useEffect, useCallback } from 'react';
import { purchaseRuneShopItem, exchangeRunesService, getUserYggData } from '../../services/miniGameService';
import './RuneShop.css';

const SHOP_ITEMS = [
  {
    id: 'magnetism',
    name: 'Rune Magnetism',
    icon: '🧲',
    description: 'Runes fly toward you from a distance. Upgrades increase the range.',
    maxLevel: 3,
    type: 'upgrade',
    levelLabels: ['60px range', '100px range', '150px range'],
    defaultCosts: [50, 150, 400]
  },
  {
    id: 'extraTurbo',
    name: 'Extra Turbo',
    icon: '🚀',
    description: 'Start each run with +1 Turbo Boost charge.',
    type: 'consumable',
    defaultCost: 20
  },
  {
    id: 'extraJump',
    name: 'Extra High Jump',
    icon: '👟',
    description: 'Start each run with +1 Double Jump charge.',
    type: 'consumable',
    defaultCost: 15
  },
  {
    id: 'idunApple',
    name: "Iðunn's Apple",
    icon: '🍎',
    description: 'Auto-activates when you die. Get a 10s prompt to respawn at the highest platform. Max 1.',
    type: 'consumable',
    maxOwn: 1,
    defaultCost: 80
  }
];

const RuneShop = ({ user, onClose, onUpdate }) => {
  const [runeBalance, setRuneBalance] = useState(0);
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
      setMessage({ type: 'success', text: `Purchased ${itemId}!` });
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
    if (item.type === 'upgrade') {
      const level = upgrades.magnetismLevel || 0;
      return level >= item.maxLevel ? null : item.defaultCosts[level];
    }
    return item.defaultCost;
  };

  const getItemStatus = (item) => {
    if (item.id === 'magnetism') {
      const level = upgrades.magnetismLevel || 0;
      if (level >= item.maxLevel) return 'MAX';
      return `Lv.${level} → Lv.${level + 1}`;
    }
    if (item.id === 'extraTurbo') {
      return `Owned: ${upgrades.extraTurbo || 0}`;
    }
    if (item.id === 'extraJump') {
      return `Owned: ${upgrades.extraJump || 0}`;
    }
    if (item.id === 'idunApple') {
      return upgrades.hasIdunApple ? '🍎 In Inventory' : 'Not owned';
    }
    return '';
  };

  const isDisabled = (item) => {
    if (item.id === 'idunApple' && upgrades.hasIdunApple) return true;
    if (item.id === 'magnetism' && (upgrades.magnetismLevel || 0) >= item.maxLevel) return true;
    const cost = getItemCost(item);
    return cost === null || runeBalance < cost;
  };

  if (loading) {
    return (
      <div className="ygg-shop-overlay">
        <div className="ygg-shop-modal">
          <div className="ygg-shop-loading">
            <div className="viking-spinner" />
            <span>Loading Shop...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ygg-shop-overlay">
      <div className="ygg-shop-modal">
        <div className="ygg-shop-header">
          <h2 className="ygg-shop-title">ᚠ Rune Shop</h2>
          <div className="ygg-shop-balance">
            <span className="ygg-shop-rune-icon">ᚠ</span>
            <span className="ygg-shop-rune-count">{runeBalance.toLocaleString()}</span>
            <span className="ygg-shop-rune-label">Runes</span>
          </div>
        </div>

        {message && (
          <div className={`ygg-shop-message ${message.type}`}>
            {message.text}
          </div>
        )}

        <div className="ygg-shop-scroll custom-scrollbar">
          {/* Items */}
          <div className="ygg-shop-section-title">⚡ Upgrades & Consumables</div>
          <div className="ygg-shop-items">
            {SHOP_ITEMS.map(item => {
              const cost = getItemCost(item);
              const status = getItemStatus(item);
              const disabled = isDisabled(item);

              return (
                <div key={item.id} className={`ygg-shop-item ${disabled ? 'disabled' : ''}`}>
                  <div className="ygg-shop-item-icon">{item.icon}</div>
                  <div className="ygg-shop-item-info">
                    <div className="ygg-shop-item-name">{item.name}</div>
                    <div className="ygg-shop-item-desc">{item.description}</div>
                    <div className="ygg-shop-item-status">{status}</div>
                  </div>
                  <button
                    className="ygg-shop-buy-btn"
                    disabled={disabled || purchasing === item.id}
                    onClick={() => handlePurchase(item.id)}
                  >
                    {purchasing === item.id ? '...' : cost !== null ? `ᚠ ${cost}` : 'MAX'}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Exchange */}
          <div className="ygg-shop-section-title">💱 Rune Exchange</div>
          <div className="ygg-shop-exchange">
            <div className="ygg-shop-exchange-row">
              <input
                type="number"
                className="ygg-shop-exchange-input"
                placeholder="Rune amount"
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
              Rate: 500 Runes = 1 unit (admin configurable)
            </div>
            <button
              className="ygg-shop-exchange-btn"
              disabled={exchangeLoading || !exchangeAmount}
              onClick={handleExchange}
            >
              {exchangeLoading ? 'Exchanging...' : 'Exchange'}
            </button>
          </div>
        </div>

        <button className="ygg-shop-close" onClick={onClose}>
          CLOSE
        </button>
      </div>
    </div>
  );
};

export default RuneShop;
