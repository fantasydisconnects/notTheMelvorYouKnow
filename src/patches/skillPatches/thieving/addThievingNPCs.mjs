export function addThievingNPCs() {

  const market = game.thieving.areas.getObjectByID("melvorF:FARMERS_MARKET");
  const tower = game.thieving.areas.getObjectByID("melvorF:WIZARD_TOWER");

  const gardener = game.thieving.actions.getObjectByID("expandedAreas:PETUNIA_MASTER_GARDENER");
  const alchemist = game.thieving.actions.getObjectByID("expandedAreas:ALCHEMIST");

  market.npcs.push(gardener);
}