export async function setup(ctx) {

  const { addThievingNPCs } = await ctx.loadModule('src/patches/skillPatches/thieving/addThievingNPCs.mjs');

  ctx.onModsLoaded(async (ctx) => {

    addThievingNPCs();
  });

  await ctx.patch(Skill, 'maxLevelCap').get(function () { return 200; });

  await ctx.onCharacterLoaded(async (ctx) => {
    mod.api.mythCombatSimulator?.registerNamespace('expandedAreas');
  });
}