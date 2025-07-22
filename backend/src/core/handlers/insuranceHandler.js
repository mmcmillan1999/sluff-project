// backend/src/core/handlers/insuranceHandler.js

/**
 * Handler for insurance-related socket events.
 * Encapsulates logic for updating insurance settings in the game engine.
 */

module.exports = {
  /**
   * Updates the insurance setting for the bidding player or defenders.
   *
   * @param {import('../GameEngine')} engine - The game engine instance (Table)
   * @param {string} userId - The ID of the user updating their insurance setting
   * @param {'bidderRequirement'|'defenderOffer'} settingType - The type of insurance setting
   * @param {number} value - The new value for the insurance setting
   */
  updateInsuranceSetting(engine, userId, settingType, value) {
    // Forward to the engine's core logic
    engine.updateInsuranceSetting(userId, settingType, value);
  }
};
