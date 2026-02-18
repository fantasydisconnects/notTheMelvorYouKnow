export function patchSmithingOrder() {
  const catsReg = game.smithing.categories;
  const myCatID = 'ntmyk:SilverGear';
  const myCat = catsReg.getObjectByID(myCatID);
  const beforeID = 'melvorD:RuneGear';

  if (!myCat) return;

  // Check if already in the registeredObjects
  if (catsReg.registeredObjects.has(myCatID)) return;

  const newMap = new Map();
  let inserted = false;

  catsReg.registeredObjects.forEach((obj, id) => {
    newMap.set(id, obj);

    if (!inserted && id === beforeID) {
      newMap.set(myCatID, myCat);
      inserted = true;
    }
  });

  // Safety: if beforeID wasn’t found, append at the end
  if (!inserted) newMap.set(myCatID, myCat);

  catsReg.registeredObjects = newMap;
}
