export function addThievingNPCs() {

  const market = game.thieving.areas.getObjectByID("melvorF:FARMERS_MARKET");
  const port = game.thieving.areas.getObjectByID("melvorF:PORT_OF_LEMVOR");
  const tower = game.thieving.areas.getObjectByID("melvorF:WIZARD_TOWER");

  const gardener = game.thieving.actions.getObjectByID("expandedAreas:PETUNIA_MASTER_GARDENER");
  const retired_pirate = game.thieving.actions.getObjectByID("expandedAreas:RETIRED_PIRATE");
  const alchemist = game.thieving.actions.getObjectByID("expandedAreas:ALCHEMIST");

  market.npcs.push(gardener);
  port.npcs.push(retired_pirate);
  tower.npcs.push(alchemist);
}