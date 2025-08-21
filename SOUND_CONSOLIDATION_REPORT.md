# Sound Consolidation Report

## Inventory Summary
- **Existing sounds (public/Sounds):** 15 files
- **New procedural sounds (assets/sounds):** 30 files
- **Unused sounds backup:** C:\Users\matth\OneDrive\Desktop\sluff-project\frontend\public\unused-sounds

## Conflict Resolution

### 26to49Points.mp3 vs round-end-win.mp3
- Existing size: 10.66 KB
- New size: 258.44 KB
- **Decision:** Keep new
- **Reason:** Procedural sounds provide consistent feedback patterns

### 50Points.mp3 vs game-victory.mp3
- Existing size: 16.78 KB
- New size: 430.71 KB
- **Decision:** Keep new
- **Reason:** Procedural sounds provide consistent feedback patterns

### card_dealing_10s_v3.mp3 vs card-draw.mp3
- Existing size: 78.59 KB
- New size: 25.88 KB
- **Decision:** Keep existing
- **Reason:** 10 second dealing sound more realistic than procedural

### card_play.mp3 vs card-play-valid.mp3
- Existing size: 1.45 KB
- New size: 43.11 KB
- **Decision:** Keep existing
- **Reason:** Original recorded sound likely higher quality than procedural

### GaptoDealChange.mp3 vs insurance-offer.mp3
- Existing size: 126.17 KB
- New size: 86.18 KB
- **Decision:** Keep new
- **Reason:** New procedural sound provides better game integration

### InsuranceDealExecuted.mp3 vs insurance-payout.mp3
- Existing size: 15.55 KB
- New size: 129.24 KB
- **Decision:** Keep new
- **Reason:** Procedural sounds provide consistent feedback patterns

### Negative49toNegative1.mp3 vs round-end-lose.mp3
- Existing size: 6.98 KB
- New size: 172.31 KB
- **Decision:** Keep new
- **Reason:** New procedural sound provides better game integration

### Negative50Points.mp3 vs game-defeat.mp3
- Existing size: 16.78 KB
- New size: 258.44 KB
- **Decision:** Keep new
- **Reason:** Procedural sounds provide consistent feedback patterns

### trick_win.mp3 vs trick-win.mp3
- Existing size: 5.12 KB
- New size: 103.40 KB
- **Decision:** Keep existing
- **Reason:** Original recorded sound likely higher quality than procedural

### TrumpPlayed.mp3 vs card-play-valid.mp3
- Existing size: 31.88 KB
- New size: 43.11 KB
- **Decision:** Keep new
- **Reason:** New procedural sound provides better game integration

### turn_alert.mp3 vs timer-warning.mp3
- Existing size: 4.92 KB
- New size: 43.11 KB
- **Decision:** Keep new
- **Reason:** New procedural sound provides better game integration

### Zeroto25Points.mp3 vs round-end-win.mp3
- Existing size: 19.23 KB
- New size: 258.44 KB
- **Decision:** Keep new
- **Reason:** Procedural sounds provide consistent feedback patterns


## Special Sounds Preserved
- 11L-Makeing_a_card_game.-1751698000285.mp3: Unique voice/special sound
- ElevenLabs_2025-07-05T06_47_43_Liam_pre_sp100_s50_sb75_v3.mp3: Unique voice/special sound
- no_peaking_cheater.mp3: Unique voice/special sound

## Recommended Sound Mapping

```javascript
// Updated sound mappings for the game
const soundMappings = {
  // Game events
  'card-draw': 'card-draw.mp3',           // Procedural whoosh
  'card-play-valid': 'card-play-valid.mp3', // Original click sound
  'card-play-invalid': 'card-play-invalid.mp3', // Procedural error
  'trick-win': 'trick-win.mp3',           // Original celebration
  'trick-lose': 'trick-lose.mp3',         // Procedural disappointment
  
  // Bidding
  'bid-placed': 'bid-placed.mp3',         // Procedural
  'bid-solo': 'bid-solo.mp3',             // Procedural fanfare
  'bid-frog': 'bid-frog.mp3',             // Procedural mystical
  'bid-heart-solo': 'bid-heart-solo.mp3', // Procedural epic
  'bid-pass': 'bid-pass.mp3',             // Procedural subtle
  
  // Insurance
  'insurance-offer': 'insurance-offer.mp3',     // Procedural
  'insurance-payout': 'insurance-payout.mp3',   // Original or procedural
  
  // Game states
  'game-start': 'game-start.mp3',         // Procedural anticipation
  'round-start': 'round-start.mp3',       // Procedural
  'round-end-win': 'round-end-win.mp3',   // Procedural victory
  'round-end-lose': 'round-end-lose.mp3', // Procedural defeat
  'game-victory': 'game-victory.mp3',     // Procedural triumph
  'game-defeat': 'game-defeat.mp3',       // Procedural loss
  
  // Timers
  'timer-warning': 'timer-warning.mp3',   // Procedural tick
  'timer-final': 'timer-final.mp3',       // Procedural urgent
  
  // UI
  'button-hover': 'button-hover.mp3',     // Procedural subtle
  'button-click': 'button-click.mp3',     // Procedural click
  
  // Special voice lines (optional)
  'no-peeking': 'no_peaking_cheater.mp3', // Voice line
  'game-intro': '11L-Makeing_a_card_game.-1751698000285.mp3' // Narration
};
```

## Actions Taken
- 📁 Moved 26to49Points.mp3 to unused (keeping procedural round-end-win.mp3)
- 📁 Moved 50Points.mp3 to unused (keeping procedural game-victory.mp3)
- ✅ Kept existing card_dealing_10s_v3.mp3 as card-draw.mp3 (procedural moved to unused)
- ✅ Kept existing card_play.mp3 as card-play-valid.mp3 (procedural moved to unused)
- 📁 Moved GaptoDealChange.mp3 to unused (keeping procedural insurance-offer.mp3)
- 📁 Moved InsuranceDealExecuted.mp3 to unused (keeping procedural insurance-payout.mp3)
- 📁 Moved Negative49toNegative1.mp3 to unused (keeping procedural round-end-lose.mp3)
- 📁 Moved Negative50Points.mp3 to unused (keeping procedural game-defeat.mp3)
- ✅ Kept existing trick_win.mp3 as trick-win.mp3 (procedural moved to unused)
- 📁 Moved TrumpPlayed.mp3 to unused (keeping procedural card-play-valid.mp3)
- 📁 Moved turn_alert.mp3 to unused (keeping procedural timer-warning.mp3)
- 📁 Moved Zeroto25Points.mp3 to unused (keeping procedural round-end-win.mp3)
- 🎤 Copied special sound: 11L-Makeing_a_card_game.-1751698000285.mp3
- 🎤 Copied special sound: ElevenLabs_2025-07-05T06_47_43_Liam_pre_sp100_s50_sb75_v3.mp3
- 🎤 Copied special sound: no_peaking_cheater.mp3

## Next Steps
1. Test all sounds in-game
2. Adjust volumes in SoundManager
3. Consider adding sound settings UI
4. A/B test with players
5. Unused sounds are backed up in: C:\Users\matth\OneDrive\Desktop\sluff-project\frontend\public\unused-sounds

---
*Generated by Sound Auditor*
