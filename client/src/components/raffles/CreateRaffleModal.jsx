import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { createRaffle, updateRaffle } from '../../services/raffleService';
import './CreateRaffleModal.css';

const CreateRaffleModal = ({ isOpen, onClose, user, onRaffleCreated, editData }) => {
  const isEditMode = !!editData;

  const [itemType, setItemType] = useState('amiko');
  const [itemImage, setItemImage] = useState('');
  const [itemLink, setItemLink] = useState('');
  const [description, setDescription] = useState('');
  const [isFree, setIsFree] = useState(true);
  const [entryFee, setEntryFee] = useState(0);
  const [entryFeeCurrency, setEntryFeeCurrency] = useState('AURY');
  const [minParticipants, setMinParticipants] = useState(2);
  const [maxParticipants, setMaxParticipants] = useState(20);
  const [auryAmount, setAuryAmount] = useState(100);
  const [usdcAmount, setUsdcAmount] = useState(10);
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);

  // Populate fields when editing
  useEffect(() => {
    if (editData) {
      setItemType(editData.itemType || 'amiko');
      setItemImage(editData.itemImage || '');
      setItemLink(editData.itemLink || '');
      setDescription(editData.description || '');
      setIsFree(editData.isFree ?? true);
      setEntryFee(editData.entryFee || 0);
      setEntryFeeCurrency(editData.entryFeeCurrency || 'AURY');
      setMinParticipants(editData.minParticipants || 2);
      setMaxParticipants(editData.maxParticipants || 20);
      setAuryAmount(editData.auryAmount || 0);
      setUsdcAmount(editData.usdcAmount || 0);
      setEndDate(editData.endDate ? new Date(editData.endDate).toISOString().slice(0, 16) : '');
    }
  }, [editData]);

  if (!isOpen) return null;

  const isAury = itemType === 'aury';
  const isUsdc = itemType === 'usdc';
  const isCurrencyPrize = isAury || isUsdc;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) {
      alert('You must be logged in.');
      return;
    }
    setLoading(true);

    const raffleData = {
      itemType,
      itemImage: isCurrencyPrize ? '' : itemImage,
      itemLink: isCurrencyPrize ? '' : itemLink,
      description,
      isFree,
      entryFee: isFree ? 0 : parseFloat(entryFee),
      entryFeeCurrency,
      minParticipants: parseInt(minParticipants),
      maxParticipants: parseInt(maxParticipants),
      auryAmount: isAury ? parseFloat(auryAmount) : 0,
      usdcAmount: isUsdc ? parseFloat(usdcAmount) : 0,
      endDate: endDate ? new Date(endDate).toISOString() : null
    };

    if (isEditMode) {
      const result = await updateRaffle(editData.id, raffleData, user);
      if (result.success) {
        onClose();
      } else {
        alert('Error updating raffle: ' + result.error);
      }
    } else {
      const result = await createRaffle(raffleData, user);
      if (result.success) {
        if (onRaffleCreated) onRaffleCreated(result.id);
        onClose();
      } else {
        alert('Error creating raffle: ' + result.error);
      }
    }
    setLoading(false);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 1024 * 1024) {
        alert('Image too large. Please use an image under 1MB.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setItemImage(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  return ReactDOM.createPortal(
    <div className="modal-overlay">
      <div className="create-modal create-raffle-modal">
        <div className="modal-header">
          <h3>{isEditMode ? '✏️ Edit Raffle' : '➕ Create New Raffle'}</h3>
          <button className="close-modal" onClick={onClose}>✖</button>
        </div>

        <div className="modal-body">
          <form id="create-raffle-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label>🎁 Item Selection</label>
              <select className="form-input" value={itemType} onChange={(e) => setItemType(e.target.value)}>
                <option value="amiko">Amiko</option>
                <option value="eggs">Eggs</option>
                <option value="skins">Skins</option>
                <option value="aurorian">Aurorian</option>
                <option value="aury">AURY (Token)</option>
                <option value="usdc">USDC (Token)</option>
                <option value="other">Other</option>
              </select>
            </div>

            {isCurrencyPrize ? (
              <div className="form-group">
                <label>💰 {isAury ? 'AURY' : 'USDC'} Amount</label>
                <input 
                  type="number" 
                  className="form-input"
                  placeholder={`e.g. ${isAury ? '100' : '10'}`} 
                  value={isAury ? auryAmount : usdcAmount} 
                  onChange={(e) => isAury ? setAuryAmount(e.target.value) : setUsdcAmount(e.target.value)}
                  min="0.01"
                  step="0.01"
                  required
                />
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label>🖼 Item Image</label>
                  <div className="image-input-container">
                    <input 
                      type="text" 
                      className="form-input"
                      placeholder="Image URL" 
                      value={itemImage} 
                      onChange={(e) => setItemImage(e.target.value)} 
                    />
                    <div className="upload-divider">OR</div>
                    <input type="file" className="file-input" accept="image/*" onChange={handleImageUpload} />
                  </div>
                  {itemImage && (
                    <div className="raffle-image-preview">
                      <img src={itemImage} alt="Preview" />
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>🔗 Item Link</label>
                  <input 
                    type="url" 
                    className="form-input"
                    placeholder="https://aurory.io/..." 
                    value={itemLink} 
                    onChange={(e) => setItemLink(e.target.value)} 
                  />
                </div>
              </>
            )}

            <div className="form-group">
              <label>📝 Description</label>
              <textarea 
                className="form-textarea"
                placeholder="Describe the raffle item..." 
                value={description} 
                onChange={(e) => setDescription(e.target.value)}
                rows="3"
                required
              />
            </div>

            <div className="form-group entry-fee-group">
              <label className="checkbox-label">
                <input 
                  type="checkbox" 
                  checked={isFree} 
                  onChange={(e) => setIsFree(e.target.checked)} 
                />
                🆓 Free Entry?
              </label>
              {!isFree && (
                <div className="entry-fee-input-row">
                  <select 
                    className="form-input currency-select" 
                    value={entryFeeCurrency} 
                    onChange={(e) => setEntryFeeCurrency(e.target.value)}
                  >
                    <option value="AURY">AURY</option>
                    <option value="USDC">USDC</option>
                    <option value="Valcoins">Valcoins</option>
                  </select>
                  <input 
                    type="number" 
                    className="form-input"
                    step={entryFeeCurrency === 'Valcoins' ? '1' : '0.01'} 
                    value={entryFee} 
                    onChange={(e) => setEntryFee(e.target.value)} 
                    placeholder={`Fee in ${entryFeeCurrency}`}
                    required
                  />
                  <span className="fee-unit">{entryFeeCurrency === 'Valcoins' ? 'Valcoins' : entryFeeCurrency} per ticket</span>
                </div>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>👥 Min Participants</label>
                <input 
                  type="number" 
                  className="form-input"
                  value={minParticipants} 
                  onChange={(e) => setMinParticipants(e.target.value)} 
                  min="2"
                />
              </div>
              <div className="form-group">
                <label>👥 Max Participants</label>
                <input 
                  type="number" 
                  className="form-input"
                  value={maxParticipants} 
                  onChange={(e) => setMaxParticipants(e.target.value)} 
                  min={minParticipants}
                />
              </div>
            </div>

            <div className="form-group">
              <label>📅 Raffle End Date & Time</label>
              <input 
                type="datetime-local" 
                className="form-input"
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)} 
                required
              />
              <small className="form-help-text">Joining will be disabled after this time.</small>
            </div>
          </form>
        </div>

        <div className="modal-footer">
          <button type="button" className="cancel-btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button type="submit" form="create-raffle-form" className="create-btn" disabled={loading}>
            {loading ? (isEditMode ? 'Updating...' : 'Creating...') : (isEditMode ? '💾 Update Raffle' : '🚀 Create Raffle')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CreateRaffleModal;
