export function addThievingNPCs() {

  const market = game.thieving.areas.getObjectByID("melvorF:FARMERS_MARKET");

  const gardener = game.thieving.actions.getObjectByID("expandedAreas:PETUNIA_MASTER_GARDENER");

  market.npcs.push(gardener);
}