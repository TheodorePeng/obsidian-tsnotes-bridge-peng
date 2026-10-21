import {build} from "esbuild";
await build({entryPoints:["src/main.ts"],bundle:true,format:"cjs",platform:"node",target:"es2022",external:["obsidian","electron"],outfile:"main.js",logLevel:"info"});
