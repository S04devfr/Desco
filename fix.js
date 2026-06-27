const fs = require('fs');
const path = require('path');

function walk(dir) {
  fs.readdirSync(dir).forEach(file => {
    const f = path.join(dir, file);
    if (fs.statSync(f).isDirectory()) {
      walk(f);
    } else if (f.endsWith('.ejs') && !f.includes('layouts')) {
      let c = fs.readFileSync(f, 'utf8');
      const match = c.match(/<%- include\(['"]\.\.\/layouts\/base['"],\s*\{([\s\S]*?),\s*body:\s*`/);
      if (match) {
        const props = match[1];
        const replacement = `<%- include('../layouts/header', {${props}}) %>\n`;
        c = c.replace(match[0], replacement);
        c = c.replace(/`\s*}\)\s*%>/g, '<%- include(\'../layouts/footer\') %>');
        fs.writeFileSync(f, c);
        console.log('Updated ' + f);
      }
    }
  });
}
walk('views');
