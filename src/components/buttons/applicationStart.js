'use strict';

const applicationService = require('../../services/applicationService');

/** Button "app:start:<typeId>" am Panel. */
module.exports = {
  prefix: 'app:start',
  async execute(interaction) {
    await applicationService.beginApplication(interaction, Number.parseInt(interaction.customId.split(':')[2], 10));
  },
};
