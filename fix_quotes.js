const fs = require('fs');
const path = require('path');

function walk(dir) {
  fs.readdirSync(dir).forEach(file => {
    const f = path.join(dir, file);
    if (fs.statSync(f).isDirectory()) {
      walk(f);
    } else if (f.endsWith('.ejs')) {
      let c = fs.readFileSync(f, 'utf8');
      if (c.includes("\\\\'")) {
        // Replace two backslashes and a quote with one backslash and a quote
        c = c.replace(/\\\\'/g, "\\'");
        fs.writeFileSync(f, c);
        console.log('Fixed ' + f);
      }
    }
  });
}
walk('views');
