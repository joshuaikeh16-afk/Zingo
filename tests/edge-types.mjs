// Uses the TypeScript compiler bundled with the IDE. Runtime dependencies are
// resolved by Supabase's Deno deploy; those imports are deliberately not stubbed.
import {createRequire} from 'node:module';
import {readdirSync} from 'node:fs';
const require=createRequire(import.meta.url);
const ts=require('/usr/share/code/resources/app/extensions/node_modules/typescript/lib/typescript.js');
function scan(path){return readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?scan(path+'/'+entry.name):entry.name.endsWith('.ts')?[path+'/'+entry.name]:[]);}
const files=scan('supabase/functions');
const program=ts.createProgram(files,{noEmit:true,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,allowImportingTsExtensions:true,skipLibCheck:true,lib:['lib.esnext.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts']});
const runtime=[],errors=[];
for(const diagnostic of ts.getPreEmitDiagnostics(program)){
 const text=ts.flattenDiagnosticMessageText(diagnostic.messageText,'\n');
 if(diagnostic.code===2304&&text==="Cannot find name 'Deno'."||diagnostic.code===2307&&/Cannot find module '(npm:|https:)/.test(text))runtime.push(text);else errors.push(diagnostic);
}
if(errors.length){console.error(ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));process.exit(1);}
console.log(`Edge TypeScript semantic checks passed (${files.length} files). Deno globals and remote package declarations require the Deno runtime check.`);
