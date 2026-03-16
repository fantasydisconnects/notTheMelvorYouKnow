export function setup(ctx) {

  ctx.patch(Skill, 'maxLevelCap').get(function () { return 200; });
  if (cloudManager.hasAoDEntitlementAndIsEnabled) {
    ctx.patch(Archaeology, 'maxLevelCap').get(function () { return 200; });
    ctx.patch(Cartography, 'maxLevelCap').get(function () { return 200; });
  }
  if (cloudManager.hasItAEntitlementAndIsEnabled) {
    ctx.patch(Corruption, 'maxLevelCap').get(function () { return 200; });
    ctx.patch(Harvesting, 'maxLevelCap').get(function () { return 200; });
  }


}