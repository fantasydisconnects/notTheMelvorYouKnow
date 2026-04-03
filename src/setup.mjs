export function setup(ctx) {

  ctx.patch(Skill, 'maxLevelCap').get(function () { return 200; });

  ctx.onCharacterLoaded(async (ctx) => {
    mod.api.mythCombatSimulator?.registerNamespace('expandedAreas');
  });

}