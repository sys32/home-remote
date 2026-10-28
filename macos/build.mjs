import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.argv[2]||path.join(project,'..','Дома TV.app'));
const developer=process.env.DEVELOPER_DIR||'/Applications/Xcode.app/Contents/Developer';
const toolchain=path.join(developer,'Toolchains/XcodeDefault.xctoolchain/usr/bin');
const sdk=path.join(developer,'Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'doma-tv-build-'));
const resources=path.join(output,'Contents/Resources'),macos=path.join(output,'Contents/MacOS');
const run=(program,args)=>execFileSync(program,args,{stdio:'inherit'});
try{
  await fs.mkdir(macos,{recursive:true});await fs.mkdir(path.join(resources,'TVRemote/public'),{recursive:true});await fs.mkdir(path.join(resources,'runtime'),{recursive:true});
  run(path.join(toolchain,'swiftc'),[path.join(project,'macos/DomaTV.swift'),'-parse-as-library','-target','arm64-apple-macosx13.0','-sdk',sdk,'-module-cache-path',path.join(temporary,'modules'),'-framework','AppKit','-framework','WebKit','-O','-o',path.join(macos,'DomaTV')]);
  run(path.join(toolchain,'swiftc'),[path.join(project,'macos/MakeIcon.swift'),'-sdk',sdk,'-module-cache-path',path.join(temporary,'modules'),'-framework','AppKit','-O','-o',path.join(temporary,'make-icon')]);
  const iconset=path.join(temporary,'AppIcon.iconset');run(path.join(temporary,'make-icon'),[iconset]);
  run('/usr/bin/iconutil',['-c','icns',iconset,'-o',path.join(resources,'AppIcon.icns')]);
  await fs.copyFile(path.join(project,'macos/Info.plist'),path.join(output,'Contents/Info.plist'));
  for(const name of ['server.mjs','devices.mjs','protocol.mjs','sleep.mjs','package.json'])await fs.copyFile(path.join(project,name),path.join(resources,'TVRemote',name));
  for(const name of ['index.html','app.js','style.css'])await fs.copyFile(path.join(project,'public',name),path.join(resources,'TVRemote/public',name));
  // Keep the runtime's upstream license and all bundled third-party notices.
  const license=await fs.readFile(path.join(project,'macos/Node-LICENSE.txt'),'utf8');
  await fs.writeFile(path.join(resources,'runtime/LICENSE.txt'),license);
  run(path.join(toolchain,'lipo'),[process.execPath,'-thin','arm64','-output',path.join(resources,'runtime/node')]);
  await fs.chmod(path.join(resources,'runtime/node'),0o755);
  run('/usr/bin/codesign',['--force','--sign','-',path.join(resources,'runtime/node')]);
  run('/usr/bin/codesign',['--force','--sign','-',output]);
  run('/usr/bin/codesign',['--verify','--deep','--strict',output]);
  console.log(`Built ${output}`);
}finally{await fs.rm(temporary,{recursive:true,force:true});}
