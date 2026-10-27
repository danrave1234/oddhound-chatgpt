import {mkdir,readFile,writeFile,copyFile,lstat} from 'node:fs/promises';
import {resolve,relative,dirname,basename,sep} from 'node:path';
import {createHash} from 'node:crypto';

const root=process.cwd(),snapshot=JSON.parse(await readFile(resolve(root,'data/vercel-git-source.json'),'utf8')),head=snapshot.head;
if(!/^[a-f0-9]{40}$/.test(head)||!Array.isArray(snapshot.files)||snapshot.files.some(name=>typeof name!=='string'))throw new Error('invalid_git_source_snapshot');
const output=resolve(root,'data',`vercel-source-${head.slice(0,12)}`);
const inside=path=>{const part=relative(root,path);if(part.startsWith('..'+sep)||part==='..')throw new Error('source_path_escape');return path;};
const names=snapshot.files;
const files=[];
await mkdir(resolve(output,'source'),{recursive:true});
for(const name of names){
  if(/(^|\/)(data|node_modules|\.git|\.vercel)(\/|$)/.test(name)||basename(name).startsWith('.env'))continue;
  const source=inside(resolve(root,name));if(!(await lstat(source)).isFile())throw new Error('non_regular_deployment_source');
  const target=inside(resolve(output,'source',name));await mkdir(dirname(target),{recursive:true});await copyFile(source,target);
  files.push({path:`source/${name}`,sha256:createHash('sha256').update(await readFile(target)).digest('hex')});
}
const template=await readFile(resolve(root,'Dockerfile.vercel'),'utf8');
if(!template.includes('ARG SOURCE_ROOT=.'))throw new Error('container_source_argument_required');
await writeFile(resolve(output,'Dockerfile.vercel'),template.replace('ARG SOURCE_ROOT=.','ARG SOURCE_ROOT=source'));
await writeFile(resolve(output,'.vercelignore'),'.vercel\n.env*\nsource/data\nsource/node_modules\n');
await writeFile(resolve(output,'.dockerignore'),'.vercel\n.env*\n');
await mkdir(resolve(output,'.vercel'),{recursive:true});
await copyFile(resolve(root,'.vercel/project.json'),resolve(output,'.vercel/project.json'));
const dirty=snapshot.sourceHasLocalChanges===true;
await writeFile(resolve(root,'data/vercel-source-manifest.json'),JSON.stringify({head,sourceHasLocalChanges:dirty,files},null,2)+'\n');
console.log(JSON.stringify({directory:relative(root,output).split(sep).join('/'),head,sourceHasLocalChanges:dirty,files:files.length,rootPackageJson:false,sourceRuntime:'Node 26 pinned by Dockerfile and package engines'}));
