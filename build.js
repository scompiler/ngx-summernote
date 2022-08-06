const execSync = require('child_process').execSync;
const fs = require('fs');

const output = execSync('ng build --configuration production ngx-summernote');

console.log(output.toString());

fs.copyFileSync('README.md', 'dist/ngx-summernote/README.md');
fs.copyFileSync('LICENSE', 'dist/ngx-summernote/LICENSE');
