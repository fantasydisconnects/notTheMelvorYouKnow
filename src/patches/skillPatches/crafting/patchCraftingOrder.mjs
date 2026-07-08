export function patchCraftingOrder() {
  const catsReg = game.crafting.categories;
  const myCatID = 'expandedAreas:StandardAccessories';
  const myCat = catsReg.getObjectByID(myCatID);
  if (myCat) {
    const oldMap = catsReg.registeredObjects;
    const newMap = new Map();

    let count = 0;
    for (const [id, obj] of oldMap) {
      newMap.set(id, obj);
      count++;
      if (count === 4) {
        newMap.set(myCatID, myCat);
      }
    }

    catsReg.registeredObjects = newMap;
  }
}