# I'm basically writing a shader which is math oriented

## And good god do I hate math (computers do it for me)

This program isn't really the most intuitive thing, but I sure did spend an ungodly amount of time and brain power figuring this all out.
This is a standalone program meant to bake excess 3D engine shader properties to an atlas.

One good example of this is the poiyomi shader for Unity3D has a lot of configurability, but when converting this to a mobile platform, your shader of choice may not have all of the slots it offers. e.g. poiyomi can have multiple emission slots each with their own mask, color, tint, tiling, and offsets.

Good luck manually doing all of that conversion in an image editor. Though the tradeoff with this approach is that of normal atlases - higher vram/ram usage and reduced image quality when viewed at close distances.

You could theoretically skip out on the whole "atlasing" thing of this program and just define the materials as taking the whole atlas.

Atlases are made per set for each property. A set can comprise of one or many materials each with their own properties.

You'd define these materials in either the material-list.json or the shared-materials.json. The shared-materials are shared between sets and an empty json object can be used safely if you have none. Shared materials are cached in memory based off their size in the atlas which you'd define in the atlas-description.json memory usage of this program will vary based off this and your overall atlas size.

### On the note of performance
node-canvas is really fast in testing and the main bottleneck is writing to the filesystem (8k atlases). Images take up quite a bit of memory and JS wasn't the most performant language to choose by a long shot, it's just what I'm comfortable with. My memory usage never exceeded 600MB when working with 2 sets of 7 materials each and 4 shared materials (again, 8k atlases)

## Why did you torture yourself with this?
I like to spend a good chunk of time in VRChat and I wanted to convert a model meant for PC client users for the mobile platforms while looking good (VRChat limits what shaders can be used on mobile platforms and the shader I chose, Standard Lite, is close to the built in Unity Standard shader). Said avatar also happens to have a lot of texture sets I wanted to include which I did manage to include just fine manually, but it took me a lot longer to do all that than to write this program. That's not all; When I wanted to add more stuff, I decided to back track and found that I made a host of minor mistakes which all added up that I could have very easily avoided, but that's what you get for running on little sleep and trying to pay close attention to many details.

## Cool. I wanna use this... How do I do that?
Well, for starters, ensure NodeJS is installed. Use one that node-canvas supports as that's the back bone of the entire project and also the only dependency. If I was held at gunpoint to choose one and couldn't look at compatibility with node-canvas, I wouldn't go back any further than node 12. I don't use any new to node 14 syntax which was the biggest thing for a long time, but node 12 has faster async stuff if memory serves me right which this project uses a bit of.

`npm install` the deps or use `yarn install` if you have yarn. I like yarn.

Then rename the example jsons to not include the .example in them and configure to your liking.

In the material-list, the assets field is the root dir it'll pull textures from. From there, you can use relative paths.

All of the material properties need to be filled out or bad things may happen!
You can always use `/None` if you genuinely have nothing there. Can also set a custom tint as it will fill that `/None` with RGBA(255, 255, 255, 255) aka opaque white by default.

Then you just run the program with `node .` while cd'd into the folder of this program. Or just `node /path/to/index.js` if your current working directory is elsewhere and you want it to stay that way. Paths shouldn't break unless you configured something funky!

## Do you have a way to automate material properties to this format?
No I don't since this is kinda engine agonistic (kinda) and every shader has wildly different properties. I was gonna write one to export poiyomi to this format, but I can't figure out the Unity Asset DB without using a script in the editor and that's just too much work for me :| (The material files use Asset DB GUIDs to reference textures).

Making something that would work for any Unity shader would probably be impossible/impractical anyways.

## Default values for material slots
tint: RGB(255, 255, 255)

bump scale: (1)

tile/offset: (1, 1, 0, 0) which equates to the image taking up the full canvas as normal and not being offset in either the x or y axis

swizzle: {} Swizzle is for remapping channels to others. Swizzle works for all source textures. You can remap Green to the Red channel by putting {G:R} Unless channels are remapped, they'll keep their original values. Swizzle supports all channels on either side of the : even at the same time {RGBA:ABGR} works and would flip all of the channels.

## Texture packing
Metallic, Ambient Occlusion and Specular are packed post processing.

Metallic -> R

AO -> G

Specular -> A

B currently isn't used by me but is typically used for height maps. I can add it in if you ask me nicely.

You cannot swizzle the packed map in program. You'll have to do that yourself.

## You did something wrong!
Either make an issue or a PR and we'll work things out. I promise I'm trying my best here!
