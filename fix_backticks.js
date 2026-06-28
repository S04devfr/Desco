const fs = require('fs');
const path = require('path');

function walk(dir) {
  fs.readdirSync(dir).forEach(file => {
    const f = path.join(dir, file);
    if (fs.statSync(f).isDirectory()) {
      walk(f);
    } else if (f.endsWith('.ejs')) {
      let c = fs.readFileSync(f, 'utf8');
      let changed = false;
      if (c.includes('\\`')) {
        c = c.replace(/\\`/g, '`');
        changed = true;
      }
      if (c.includes('\\${')) {
        c = c.replace(/\\\$\{/g, '${');
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(f, c);
        console.log('Fixed ' + f);
      }
    }
  });
}
walk('views');
